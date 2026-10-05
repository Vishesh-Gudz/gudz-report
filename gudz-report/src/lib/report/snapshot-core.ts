import { reportingPeriodFromDays } from "../dates/reporting-period";
import type { ErpClient } from "../erp/client";
import { getCatalogSnapshot } from "../erp/catalog-cache";
import { normalizeGstin } from "../erp/gstin";
import { rowForRecord, type CompactSheet } from "./compact";
import {
  aggregateDispatch,
  emptyDispatchResult,
  type DispatchResult,
} from "./dispatch";
import { emptyGrnResult, fetchGrnFromSalesOrders, type GrnResult } from "./grn";
import { aggregateMonthly } from "./monthly";
import {
  CatalogIndex,
  ConfirmedMappingIndex,
  mapExcelRows,
  type ConfirmedMapping,
} from "./product-mapping";
import { fetchStockPositions, type StockSnapshot } from "./stock";
import { emptyStockSnapshot } from "./stock";

/**
 * Turning a reduced workbook into a saved report.
 *
 * This is the orchestration that used to live behind the upload API route, with
 * two things taken out of it: where the rows come from, and where the snapshot
 * is written. Both are now ports, because the work runs inside a Convex action
 * rather than a web request — the browser parses the workbook and sends the
 * reduction, and Convex does the mapping, the ERP reads and the write.
 *
 * Nothing about what the report MEANS moved. The same mapper, the same monthly
 * aggregate, the same GRN and dispatch modules, the same stock read, the same
 * data-quality sentences. The rows arrive pre-reduced instead of pre-parsed,
 * and `report/compact.ts` explains why that is the same answer.
 *
 * Each marketplace is independent. Its own period, its own confirmed mappings,
 * its own ERP counterpart if one is configured. A sheet that fails is recorded
 * as failed and the rest continue.
 *
 * Three ERP reads, each for a different question:
 *   - the catalogue, to turn a marketplace product into an ERP item (once);
 *   - customer GRN, for what the marketplace actually received;
 *   - the live stock position, for current SOH.
 * None of them is allowed to invent a number. A register that is empty reports
 * null, and the report renders an em dash.
 */

export interface SnapshotRowInput {
  marketplace: string;
  month: string;
  productName: string;
  sku: string;
  ean: string | null;
  marketplaceItemId: string | null;
  erpItemId: string | null;
  currentSoh: number | null;
  dispatch: number | null;
  grn: number | null;
  salesQuantity: number;
  salesValue: number;
  damage: number;
  returned: number;
  mappingStatus: string;
  mappingReason: string;
  sourceRows: number;
}

export interface MarketplaceStanding {
  marketplace: string;
  sheetName: string;
  status: "completed" | "failed";
  errorMessage: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  months: string[];
  sourceRows: number;
  products: number;
  salesQuantity: number;
  salesValue: number;
  erpState: string;
  erpMessage: string | null;
  grnState: string;
  grnMessage: string | null;
  mappedProducts: number;
  unresolvedProducts: number;
}

export interface DataQualityNote {
  state: "ok" | "warn" | "absent" | "bad";
  title: string;
  detail: string;
}

export interface SnapshotSummary {
  marketplaces: number;
  products: number;
  rows: number;
  salesQuantity: number;
  salesValue: number;
  currentSoh: number | null;
  grnQuantity: number | null;
  dispatchQuantity: number | null;
  mappedProducts: number;
  unresolvedProducts: number;
}

/**
 * Everything the orchestration needs from its host.
 *
 * Reads and writes rather than a database handle, so the same code runs against
 * a Convex action's `ctx` and against a test double that holds arrays.
 */
export interface SnapshotPorts {
  readonly addMarketplace: (standing: MarketplaceStanding) => Promise<void>;
  readonly clearMarketplaceRows: (marketplace: string) => Promise<void>;
  readonly addRows: (rows: SnapshotRowInput[]) => Promise<void>;
  readonly complete: (result: {
    marketplaces: string[];
    periodStart: string | null;
    periodEnd: string | null;
    periodsDiffer: boolean;
    summary: SnapshotSummary;
    dataQuality: DataQualityNote[];
  }) => Promise<void>;
  readonly fail: (errorMessage: string) => Promise<void>;
  readonly marketplaceConfig: (marketplace: string) => Promise<{
    customerGstins: string[];
    erpChannelProvider?: string | null;
  } | null>;
  readonly confirmedMappings: (marketplace: string) => Promise<ConfirmedMapping[]>;
  /** Progress, for a host that can surface it. Never load-bearing. */
  readonly progress?: (stage: string, detail: Record<string, unknown>) => void;
}

export interface BuildFromCompactOptions {
  readonly sheets: ReadonlyArray<CompactSheet>;
  readonly erp: ErpClient;
  readonly ports: SnapshotPorts;
}

export interface BuildResult {
  readonly completed: number;
  readonly failed: number;
}

const GRN_NOT_CONFIGURED =
  "No ERP customer is configured for this marketplace, so goods received cannot be attributed to it.";

/** Rows written per mutation. Keeps a single write well inside Convex's limits. */
const ROW_BATCH = 400;

export async function buildSnapshotFromCompact(
  options: BuildFromCompactOptions,
): Promise<BuildResult> {
  const { sheets, erp, ports } = options;
  const report = ports.progress ?? (() => {});

  // The catalogue is the same for every marketplace, so it is read once.
  let catalog: CatalogIndex | null = null;
  let catalogError: string | null = null;
  report("catalog", {});
  try {
    const snapshot = await getCatalogSnapshot(erp);
    catalog = new CatalogIndex(snapshot.items);
  } catch (cause) {
    catalogError =
      cause instanceof Error ? cause.message : "The ERP catalogue could not be read.";
  }

  const marketplaceNames: string[] = [];
  const periods: { from: string; to: string }[] = [];
  const notes: DataQualityNote[] = [];
  const erpItemIds = new Set<string>();

  let completed = 0;
  let failed = 0;
  let totalRows = 0;
  let totalProducts = 0;
  let totalSalesQuantity = 0;
  let totalSalesValue = 0;
  let totalMapped = 0;
  let totalUnresolved = 0;
  let anyGrn = false;
  let grnQuantity = 0;
  let anyDispatch = false;
  let dispatchQuantity = 0;

  // Rows are held until stock is read, because current SOH is a property of the
  // ERP item and only the full set of items is worth one request.
  const pending: {
    marketplace: string;
    rows: Omit<SnapshotRowInput, "currentSoh">[];
  }[] = [];

  const notConfigured: string[] = [];
  const reconciled: string[] = [];
  /** Marketplaces whose own products reach no ERP item at all. */
  const unmappable: string[] = [];

  for (const input of sheets) {
    const marketplace = input.marketplace;
    report("sheet", { sheet: input.sheet, marketplace, stage: "mapping" });

    try {
      const period =
        input.minDate && input.maxDate
          ? reportingPeriodFromDays(input.minDate, input.maxDate)
          : null;

      const config = await ports.marketplaceConfig(marketplace);
      const gstins = (config?.customerGstins ?? [])
        .map((value) => normalizeGstin(value))
        .filter((value): value is string => value !== null);

      const confirmed = await ports.confirmedMappings(marketplace);
      const confirmedSkus = new Set(
        confirmed.map((entry) => entry.erpSku.toUpperCase()),
      );

      // One row per compact record, carrying that record's own row count so the
      // aggregate keeps reporting spreadsheet rows rather than records.
      const rowsForMapping = input.records.map(rowForRecord);
      const sourceRowsByIndex = input.records.map((record) => record.sourceRows);
      const indexOfRow = new Map(rowsForMapping.map((row, index) => [row, index]));

      const mapped = catalog
        ? mapExcelRows(rowsForMapping, catalog, {
            channelProvider: config?.erpChannelProvider ?? null,
            confirmed: new ConfirmedMappingIndex(confirmed),
          })
        : null;

      const aggregate = aggregateMonthly(
        mapped?.rows ?? [],
        confirmedSkus,
        (entry) => sourceRowsByIndex[indexOfRow.get(entry.row) ?? -1] ?? 1,
      );

      // Not "some products are unresolved" — none of them reached an ERP item.
      // FirstClub is the real case: its FCN codes are absent from `Master`, so
      // the sheet has no route to an EAN and nothing can be reconciled.
      if (catalog && aggregate.distinctProducts > 0 && aggregate.mappedProducts === 0) {
        unmappable.push(marketplace);
      }

      // ── ERP: goods received for this marketplace, in its own window
      let erpState = "notConfigured";
      let erpMessage: string | null = GRN_NOT_CONFIGURED;
      let grn: GrnResult = emptyGrnResult();
      let grnState = "notConfigured";
      let grnMessage: string | null = GRN_NOT_CONFIGURED;
      let dispatch: DispatchResult = emptyDispatchResult();

      if (gstins.length > 0 && period && catalog) {
        report("sheet", { sheet: input.sheet, marketplace, stage: "erp" });
        grn = await fetchGrnFromSalesOrders(erp, { period, customerGstins: gstins });

        if (!grn.available) {
          erpState = "unavailable";
          erpMessage = grn.error;
          grnState = "unavailable";
          grnMessage = grn.error;
        } else {
          erpState = "reconciled";
          erpMessage = null;
          grnState = "available";
          grnMessage = null;
          anyGrn = anyGrn || grn.byItemMonth.size > 0;
          reconciled.push(marketplace);

          // Read off the lines GRN already fetched — a different field on the
          // same rows, never a second walk of the ERP. GRN is not touched.
          dispatch = aggregateDispatch(grn.sourceLines);
          anyDispatch = anyDispatch || dispatch.byItemMonth.size > 0;
        }
      } else if (gstins.length === 0) {
        notConfigured.push(marketplace);
      }

      const rows: Omit<SnapshotRowInput, "currentSoh">[] = aggregate.rows.map((entry) => {
        const month = entry.month ?? "undated";
        const received = entry.erpItemId
          ? grn.byItemMonth.get(`${entry.erpItemId}::${month}`)
          : undefined;
        const sent = entry.erpItemId
          ? dispatch.byItemMonth.get(`${entry.erpItemId}::${month}`)
          : undefined;

        if (entry.erpItemId) erpItemIds.add(entry.erpItemId);
        if (received) grnQuantity += received.quantity;
        if (sent) dispatchQuantity += sent.quantity;

        return {
          marketplace,
          month,
          productName: entry.productName,
          sku: entry.erpSku ?? entry.key,
          ean: entry.ean,
          marketplaceItemId: entry.marketplaceItemId,
          erpItemId: entry.erpItemId,
          // Null, never zero. A dash says nothing was dispatched for this
          // product that month; a zero would say a dispatch recorded none.
          dispatch: sent ? sent.quantity : null,
          // Null, never zero. A dash says nothing was received for this
          // product that month; a zero would say a receipt recorded none.
          grn: received ? received.quantity : null,
          salesQuantity: entry.salesQuantity,
          salesValue: entry.salesValue,
          // Columns the business asked for with no source behind them yet.
          damage: 0,
          returned: 0,
          mappingStatus: entry.mappingStatus,
          mappingReason: entry.mappingReason,
          sourceRows: entry.sourceRows,
        };
      });

      // Products invoiced to this marketplace that its report never lists.
      //
      // Without these the GRN total silently under-reports: the ERP shipped 41
      // SKUs to Blinkit and the sheet names 16, so two thirds of the goods
      // received would have no row to sit on.
      const claimed = new Set(
        aggregate.rows
          .filter((entry) => entry.erpItemId)
          .map((entry) => `${entry.erpItemId}::${entry.month ?? "undated"}`),
      );

      const grnOnly: Omit<SnapshotRowInput, "currentSoh">[] = [];
      for (const [key, entry] of grn.byItemMonth) {
        if (claimed.has(key)) continue;

        // Deliberately not added to `erpItemIds`, so these rows carry no stock
        // figure. Current SOH answers "what is on hand for the products this
        // marketplace sells", and a product the marketplace never listed is not
        // one of them.
        grnQuantity += entry.quantity;

        const sent = dispatch.byItemMonth.get(key);
        if (sent) dispatchQuantity += sent.quantity;

        const item = catalog?.itemForSku(entry.itemSku) ?? null;
        grnOnly.push({
          marketplace,
          month: entry.month,
          productName: item?.name ?? entry.itemSku,
          sku: entry.itemSku,
          ean: item?.barcode ?? null,
          marketplaceItemId: null,
          erpItemId: entry.itemId,
          dispatch: sent ? sent.quantity : null,
          grn: entry.quantity,
          salesQuantity: 0,
          salesValue: 0,
          damage: 0,
          returned: 0,
          mappingStatus: "matched",
          mappingReason:
            "Invoiced to this marketplace in this month. The marketplace report does not list it.",
          sourceRows: 0,
        });
      }

      pending.push({ marketplace, rows: [...rows, ...grnOnly] });

      await ports.addMarketplace({
        marketplace,
        sheetName: input.sheet,
        status: "completed",
        errorMessage: null,
        periodStart: period?.fromDay ?? null,
        periodEnd: period?.toDay ?? null,
        months: aggregate.months,
        sourceRows: input.sourceRowCount,
        products: aggregate.distinctProducts,
        salesQuantity: aggregate.salesQuantity,
        salesValue: aggregate.salesValue,
        erpState,
        erpMessage,
        grnState,
        grnMessage,
        mappedProducts: aggregate.mappedProducts,
        unresolvedProducts: aggregate.unresolvedProducts,
      });

      marketplaceNames.push(marketplace);
      if (period) periods.push({ from: period.fromDay, to: period.toDay });
      totalRows += rows.length + grnOnly.length;
      totalProducts += aggregate.distinctProducts;
      totalSalesQuantity += aggregate.salesQuantity;
      totalSalesValue += aggregate.salesValue;
      totalMapped += aggregate.mappedProducts;
      totalUnresolved += aggregate.unresolvedProducts;
      completed += 1;

      report("sheet", {
        sheet: input.sheet,
        marketplace,
        stage: "done",
        rows: input.sourceRowCount,
        productMonths: rows.length,
        months: aggregate.months,
        erpState,
        grnState,
      });
    } catch (cause) {
      failed += 1;
      const message =
        cause instanceof Error ? cause.message : "This sheet could not be read.";

      try {
        await ports.addMarketplace({
          marketplace: marketplace || input.sheet.toLowerCase(),
          sheetName: input.sheet,
          status: "failed",
          errorMessage: message,
          periodStart: null,
          periodEnd: null,
          months: [],
          sourceRows: 0,
          products: 0,
          salesQuantity: 0,
          salesValue: 0,
          erpState: "notConfigured",
          erpMessage: null,
          grnState: "notConfigured",
          grnMessage: null,
          mappedProducts: 0,
          unresolvedProducts: 0,
        });
      } catch {
        // The snapshot still records the failure through `failed` below.
      }

      report("sheet", { sheet: input.sheet, stage: "failed", error: message });
    }
  }

  // ── Current SOH, once, for every ERP item any marketplace named
  let stock: StockSnapshot = emptyStockSnapshot();
  if (catalog && erpItemIds.size > 0) {
    report("stock", { items: erpItemIds.size });
    stock = await fetchStockPositions(erp, [...erpItemIds]);
  }

  let currentSohTotal: number | null = null;
  if (stock.available && stock.itemsFound > 0) {
    currentSohTotal = [...stock.byItemId.values()].reduce(
      (total, position) => total + position.available,
      0,
    );
  }

  // ── Write the rows
  report("rows", { marketplaces: pending.length });
  for (const group of pending) {
    await ports.clearMarketplaceRows(group.marketplace);

    const withStock: SnapshotRowInput[] = group.rows.map((row) => ({
      ...row,
      // `sourceRows === 0` marks a supplementary GRN-only row: the product was
      // invoiced to this marketplace but its report never listed it. Those
      // carry no stock figure — see the note where they are built.
      currentSoh:
        row.erpItemId && row.sourceRows > 0
          ? (stock.byItemId.get(row.erpItemId)?.available ?? null)
          : null,
    }));

    for (let offset = 0; offset < withStock.length; offset += ROW_BATCH) {
      await ports.addRows(withStock.slice(offset, offset + ROW_BATCH));
    }
  }

  // ── Data quality, decided once and stored with the snapshot
  if (catalogError) {
    notes.push({
      state: "bad",
      title: "ERP catalogue unavailable",
      detail: `Products could not be matched to ERP items: ${catalogError}`,
    });
  }

  notes.push(
    totalUnresolved === 0
      ? {
          state: "ok",
          title: `${totalMapped} of ${totalMapped + totalUnresolved} products matched to an ERP product`,
          detail: "Every product in this upload reached an ERP product.",
        }
      : {
          state: "warn",
          title: `${totalMapped} of ${totalMapped + totalUnresolved} products matched to an ERP product`,
          detail: `${totalUnresolved} product${totalUnresolved === 1 ? "" : "s"} could not be matched automatically — usually several ERP records for the same item differing only by pack size. Their sales are still counted, but have no ERP counterpart.`,
        },
  );

  notes.push(
    anyGrn
      ? {
          state: "ok",
          title: `GRN read for ${reconciled.join(", ")}`,
          detail:
            "Goods received is the quantity invoiced to the marketplace in each month, from ERP B2B sales orders. Draft and cancelled orders are excluded.",
        }
      : {
          state: "warn",
          title: "GRN unavailable",
          detail:
            "No ERP customer is configured for the marketplaces in this report, so goods received cannot be attributed.",
        },
  );

  notes.push(
    currentSohTotal === null
      ? {
          state: "warn",
          title: "Current SOH unavailable",
          detail:
            stock.error ?? "The ERP stock position could not be read for these products.",
        }
      : {
          state: "ok",
          title: `Current SOH available for ${stock.itemsFound} products`,
          detail: `${currentSohTotal.toLocaleString("en-IN")} units available in Healthy Master's own locations, after deducting stock blocked by open orders. This is a live position, not the stock held at the end of any month.`,
        },
  );

  if (unmappable.length > 0) {
    notes.push({
      state: "bad",
      title: `No product in ${unmappable.join(", ")} could be matched to an ERP product`,
      detail:
        "This marketplace's report identifies products by a code that the Master sheet does not carry, so its rows have no route to an EAN and cannot be joined to an ERP item. Sales are counted from the marketplace report and goods received are counted from ERP invoices, but the two cannot be shown against the same product. Adding this marketplace's product codes to the Master sheet would resolve it.",
    });
  }

  if (notConfigured.length > 0) {
    notes.push({
      state: "absent",
      title: `ERP not configured for ${notConfigured.join(", ")}`,
      detail:
        "These reports are parsed and their sales counted, but no ERP customer is configured for them, so GRN cannot be attributed.",
    });
  }

  notes.push({
    state: "absent",
    title: "Historical monthly SOH unavailable",
    detail:
      "Stock held at the end of a past month would have to be replayed from the ERP stock ledger, which has a known sync backlog. Current SOH is shown instead, as a live figure.",
  });

  const periodsDiffer =
    periods.length > 1 &&
    periods.some(
      (period) => period.from !== periods[0]!.from || period.to !== periods[0]!.to,
    );

  if (completed === 0) {
    await ports.fail("No sheet in this workbook could be read.");
  } else {
    await ports.complete({
      marketplaces: marketplaceNames,
      periodStart: periodsDiffer ? null : (periods[0]?.from ?? null),
      periodEnd: periodsDiffer ? null : (periods[0]?.to ?? null),
      periodsDiffer,
      summary: {
        marketplaces: marketplaceNames.length,
        products: totalProducts,
        rows: totalRows,
        salesQuantity: totalSalesQuantity,
        salesValue: totalSalesValue,
        currentSoh: currentSohTotal,
        grnQuantity: anyGrn ? grnQuantity : null,
        dispatchQuantity: anyDispatch ? dispatchQuantity : null,
        mappedProducts: totalMapped,
        unresolvedProducts: totalUnresolved,
      },
      dataQuality: notes,
    });
  }

  return { completed, failed };
}

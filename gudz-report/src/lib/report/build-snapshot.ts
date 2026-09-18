import "server-only";

import { anyApi } from "convex/server";

import { getConvexClient } from "../convex/server";
import { reportingPeriodFromDays } from "../dates/reporting-period";
import { getErpClient } from "../erp";
import { getCatalogSnapshot } from "../erp/catalog-cache";
import { normalizeGstin } from "../erp/gstin";
import { importMarketplaceSheet } from "../excel/workbook";
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
 * Turning an uploaded workbook into a saved report.
 *
 * The shape is snapshot-first and that is the whole design. A workbook is
 * 203,000 rows across six marketplaces; the report those rows produce is a few
 * hundred. Everything here happens in memory — parse, aggregate, map, fetch —
 * and the database sees only the finished aggregate. Writing the raw rows first
 * and aggregating later cost hundreds of round trips for data nothing ever read
 * again.
 *
 * Each marketplace is independent. Its own sheet profile, its own reporting
 * period, its own confirmed mappings, its own ERP counterpart if one is
 * configured. A sheet that fails is recorded as failed and the rest continue.
 *
 * Three ERP reads, each for a different question:
 *   - the catalogue, to turn a marketplace product into an ERP item (once);
 *   - customer GRN, for what the marketplace actually received;
 *   - the live stock position, for current SOH.
 * None of them is allowed to invent a number. A register that is empty reports
 * null, and the report renders an em dash.
 */

export type ProgressEvent =
  | { type: "session"; snapshotId: string | null; sheets: string[] }
  | { type: "sheet"; sheet: string; stage: string; [key: string]: unknown }
  | { type: "fatal"; error: string }
  | { type: "done"; snapshotId: string | null; completed: number; failed: number };

export interface BuildOptions {
  readonly data: Uint8Array;
  readonly fileName: string;
  readonly sheets: string[];
  readonly year: number | null;
  readonly send: (event: ProgressEvent) => void;
}

interface DataQualityNote {
  state: "ok" | "warn" | "absent" | "bad";
  title: string;
  detail: string;
}

const GRN_NOT_CONFIGURED =
  "No ERP customer is configured for this marketplace, so goods received cannot be attributed to it.";

export async function buildSnapshot(options: BuildOptions): Promise<void> {
  const { data, fileName, sheets, year, send } = options;
  const convex = getConvexClient();

  let snapshotId: string | null = null;
  if (convex) {
    try {
      snapshotId = (await convex.mutation(anyApi.snapshots.create as never, {
        sourceFileName: fileName,
      } as never)) as string;
    } catch (cause) {
      send({
        type: "fatal",
        error: `The report could not be saved: ${
          cause instanceof Error ? cause.message : "unknown error"
        }`,
      });
      return;
    }
  }

  send({ type: "session", snapshotId, sheets });

  // The catalogue is the same for every marketplace, so it is read once.
  let catalog: CatalogIndex | null = null;
  let catalogError: string | null = null;
  try {
    const snapshot = await getCatalogSnapshot(getErpClient());
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

  for (const sheet of sheets) {
    send({ type: "sheet", sheet, stage: "parsing" });

    try {
      const parsed = importMarketplaceSheet(data, { sheet, year });
      const marketplace = parsed.marketplace;

      const period =
        parsed.statistics.minDate && parsed.statistics.maxDate
          ? reportingPeriodFromDays(parsed.statistics.minDate, parsed.statistics.maxDate)
          : null;

      const config = await readMarketplaceConfig(marketplace);
      const gstins = (config?.customerGstins ?? [])
        .map((value) => normalizeGstin(value))
        .filter((value): value is string => value !== null);

      const confirmed = await readConfirmedMappings(marketplace);
      const confirmedSkus = new Set(
        confirmed.map((entry) => entry.erpSku.toUpperCase()),
      );

      send({ type: "sheet", sheet, marketplace, stage: "mapping", rows: parsed.rows.length });

      const mapped = catalog
        ? mapExcelRows(parsed.rows, catalog, {
            channelProvider: config?.erpChannelProvider ?? null,
            confirmed: new ConfirmedMappingIndex(confirmed),
          })
        : null;

      const aggregate = aggregateMonthly(mapped?.rows ?? [], confirmedSkus);

      // Not "some products are unresolved" — none of them reached an ERP item.
      // FirstClub is the real case: its FCN codes are absent from `Master`, so
      // the sheet has no route to an EAN and nothing can be reconciled. Its
      // sales are still counted and its goods received still land on GRN-only
      // rows; what is missing is the join between the two, and a reader has to
      // be told that rather than left to infer it from a column of dashes.
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
        send({ type: "sheet", sheet, marketplace, stage: "erp" });
        grn = await fetchGrnFromSalesOrders(getErpClient(), {
          period,
          customerGstins: gstins,
        });

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
        const received =
          entry.erpItemId ? grn.byItemMonth.get(`${entry.erpItemId}::${month}`) : undefined;
        const sent =
          entry.erpItemId ? dispatch.byItemMonth.get(`${entry.erpItemId}::${month}`) : undefined;

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
          // Held in the row model so connecting one later changes a writer.
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
      // received would have no row to sit on. They carry no sales — the
      // marketplace reported none — and that zero is a real measurement rather
      // than a gap.
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
        // one of them — counting its warehouse stock here would inflate the
        // headline by every item ever invoiced. The row exists to account for
        // goods received, which is the one thing it does report.
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

      if (convex && snapshotId) {
        await convex.mutation(anyApi.snapshots.addMarketplace as never, {
          snapshotId,
          marketplace,
          sheetName: parsed.sheet,
          status: "completed",
          errorMessage: null,
          periodStart: period?.fromDay ?? null,
          periodEnd: period?.toDay ?? null,
          months: aggregate.months,
          sourceRows: parsed.rows.length,
          products: aggregate.distinctProducts,
          salesQuantity: aggregate.salesQuantity,
          salesValue: aggregate.salesValue,
          erpState,
          erpMessage,
          grnState,
          grnMessage,
          mappedProducts: aggregate.mappedProducts,
          unresolvedProducts: aggregate.unresolvedProducts,
        } as never);
      }

      marketplaceNames.push(marketplace);
      if (period) periods.push({ from: period.fromDay, to: period.toDay });
      totalRows += rows.length + grnOnly.length;
      totalProducts += aggregate.distinctProducts;
      totalSalesQuantity += aggregate.salesQuantity;
      totalSalesValue += aggregate.salesValue;
      totalMapped += aggregate.mappedProducts;
      totalUnresolved += aggregate.unresolvedProducts;
      completed += 1;

      send({
        type: "sheet",
        sheet,
        marketplace,
        stage: "done",
        rows: parsed.rows.length,
        productMonths: rows.length,
        months: aggregate.months,
        period: period ? { from: period.fromDay, to: period.toDay } : null,
        erpState,
        grnState,
      });
    } catch (cause) {
      failed += 1;
      const message =
        cause instanceof Error ? cause.message : "This sheet could not be read.";

      if (convex && snapshotId) {
        try {
          await convex.mutation(anyApi.snapshots.addMarketplace as never, {
            snapshotId,
            marketplace: sheet.toLowerCase(),
            sheetName: sheet,
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
          } as never);
        } catch {
          // The stream still reports it, which is what the screen shows.
        }
      }

      send({ type: "sheet", sheet, stage: "failed", error: message });
    }
  }

  // ── Current SOH, once, for every ERP item any marketplace named
  let stock: StockSnapshot = emptyStockSnapshot();
  if (catalog && erpItemIds.size > 0) {
    stock = await fetchStockPositions(getErpClient(), [...erpItemIds]);
  }

  let currentSohTotal: number | null = null;
  if (stock.available && stock.itemsFound > 0) {
    currentSohTotal = [...stock.byItemId.values()].reduce(
      (total, position) => total + position.available,
      0,
    );
  }

  // ── Write the rows
  if (convex && snapshotId) {
    for (const group of pending) {
      await convex.mutation(anyApi.snapshots.clearMarketplaceRows as never, {
        snapshotId,
        marketplace: group.marketplace,
      } as never);

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

      for (let offset = 0; offset < withStock.length; offset += 400) {
        await convex.mutation(anyApi.snapshots.addRows as never, {
          snapshotId,
          rows: withStock.slice(offset, offset + 400),
        } as never);
      }
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
            stock.error ??
            "The ERP stock position could not be read for these products.",
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

  if (convex && snapshotId) {
    if (completed === 0) {
      await convex.mutation(anyApi.snapshots.fail as never, {
        snapshotId,
        errorMessage: "No sheet in this workbook could be read.",
      } as never);
    } else {
      await convex.mutation(anyApi.snapshots.complete as never, {
        snapshotId,
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
      } as never);
    }
  }

  send({ type: "done", snapshotId, completed, failed });
}

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

async function readMarketplaceConfig(marketplace: string): Promise<{
  customerGstins: string[];
  erpChannelProvider?: string | null;
} | null> {
  const convex = getConvexClient();
  if (!convex) return null;
  try {
    const doc = (await convex.query(anyApi.marketplaces.getByName as never, {
      marketplace,
    } as never)) as { customerGstins: string[]; erpChannelProvider?: string | null } | null;
    return doc;
  } catch {
    return null;
  }
}

async function readConfirmedMappings(marketplace: string): Promise<ConfirmedMapping[]> {
  const convex = getConvexClient();
  if (!convex) return [];
  try {
    return (await convex.query(anyApi.productMappings.listForMarketplace as never, {
      marketplace,
    } as never)) as ConfirmedMapping[];
  } catch {
    return [];
  }
}

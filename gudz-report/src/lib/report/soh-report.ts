import "server-only";

import { anyApi } from "convex/server";

import { getConvexClient } from "../convex/server";
import {
  reportingPeriodFromDays,
  type ReportingPeriod,
} from "../dates/reporting-period";
import { getErpClient } from "../erp";
import { getCatalogSnapshot } from "../erp/catalog-cache";
import { normalizeGstin } from "../erp/gstin";
import type { SalesOrderLine } from "../../types/erp";
import type { NormalizedExcelRow } from "../../types/excel";
import { fetchReportLines } from "./erp-lines";
import { isReportableStatus } from "./policy";
import {
  CatalogIndex,
  ConfirmedMappingIndex,
  mapExcelRows,
  type ConfirmedMapping,
  type MappedExcelRow,
  type MappingStatistics,
} from "./product-mapping";
import { reconcileBySku, type SkuReconciliationRow } from "./sku-reconciliation";
import { emptyStockSnapshot, fetchStockPositions, type StockSnapshot } from "./stock";

/**
 * The SOH report across every marketplace in one upload.
 *
 * The shape follows the data rather than convenience: a marketplace is a
 * dimension, not a filter applied afterwards. Each sheet has its own period —
 * Blinkit runs June to August and Bigbasket to September in the same workbook —
 * its own parser profile, its own confirmed product mappings, and its own ERP
 * counterpart if one is configured. Merging them into a single dataset first and
 * splitting later would lose exactly the facts that make each one interpretable.
 *
 * So each marketplace is reconciled on its own and the results are stacked. The
 * same product legitimately appears once per marketplace, and the totals are
 * sums across marketplaces rather than a re-aggregation of pooled rows, which is
 * what keeps a product sold on three channels from being counted once.
 *
 * ERP reconciliation is optional per marketplace. Only Blinkit has a customer
 * GSTIN configured today; the rest parse, report their sell-out, and say plainly
 * that their ERP side is not configured. Inventing a sell-in figure for them
 * would be worse than an empty column, and failing the whole upload because five
 * of six marketplaces lack configuration would be worse still.
 */

export type MarketplaceErpState =
  /** A GSTIN is configured and ERP sell-in was read. */
  | "reconciled"
  /** No customer GSTIN configured for this marketplace. */
  | "notConfigured"
  /** Configured, but the ERP could not be reached. */
  | "unavailable";

/** One marketplace product that reached no ERP product, and why. */
export interface UnresolvedProduct {
  readonly sourceRow: number;
  readonly orderDate: string | null;
  readonly productName: string | null;
  readonly marketplaceItemId: string | null;
  readonly ean: string | null;
  readonly sku: string | null;
  readonly quantity: number | null;
  readonly amount: number | null;
  /** How many spreadsheet rows carry this product. */
  readonly rowCount: number;
  readonly status: "ambiguous" | "unmapped";
  readonly reason: string;
  readonly candidates: ReadonlyArray<{ itemId: string; sku: string; name: string }>;
}

export interface MarketplaceSection {
  readonly marketplace: string;
  readonly sheetName: string;
  readonly status: "completed" | "failed";
  readonly error: string | null;

  /** This marketplace's own reporting window, from its own sheet. */
  readonly period: ReportingPeriod | null;

  readonly rows: SkuReconciliationRow[];
  readonly mapping: MappingStatistics | null;

  readonly sheetRows: number;
  readonly sellOutQuantity: number;
  readonly sellOutRevenue: number;

  readonly erpState: MarketplaceErpState;
  readonly erpMessage: string | null;
  readonly erpOrders: number;
  readonly erpLines: number;
  readonly sellInQuantity: number;
  readonly sellInRevenue: number;
  readonly gstins: ReadonlyArray<string>;

  readonly unresolvedProducts: number;
  readonly mappedProducts: number;
  readonly totalProducts: number;
  /** The products a person has to decide on, grouped per distinct product. */
  readonly unresolvedRows: UnresolvedProduct[];
}

export interface SohReport {
  readonly importId: string | null;
  readonly fileName: string | null;
  readonly uploadedAt: number | null;

  readonly sections: MarketplaceSection[];
  /** Marketplaces that produced rows, in sheet order. */
  readonly marketplaces: string[];

  /**
   * The window the report covers.
   *
   * `null` when the sheets disagree — the UI says "multiple reporting periods"
   * rather than quietly picking the widest, which would imply every marketplace
   * reported across it.
   */
  readonly period: ReportingPeriod | null;
  readonly periodsDiffer: boolean;

  readonly stock: StockSnapshot;
  readonly stockAvailable: boolean;
  readonly stockError: string | null;

  readonly erpAvailable: boolean;
  readonly warnings: string[];
  readonly historyReason: string;
}

const HISTORY_REASON =
  "Opening and closing stock for a past period would have to be replayed from the ERP stock ledger, which has a known sync backlog. Rather than publish a figure that would look authoritative and be wrong, this report shows the live position only.";

interface ImportDoc {
  _id: string;
  fileName: string;
  uploadedAt: number;
  status: string;
  marketplace?: string | null;
  sheetName?: string | null;
  minDate: string | null;
  maxDate: string | null;
  totalRows: number;
}

interface SheetDoc {
  _id: string;
  marketplace: string;
  sheetName: string;
  status: "completed" | "failed";
  minDate: string | null;
  maxDate: string | null;
  totalRows: number;
  errorMessage: string | null;
}

interface MarketplaceConfigDoc {
  marketplace: string;
  customerGstins: string[];
  erpChannelProvider?: string | null;
  isActive?: boolean;
}

async function readConvex<T>(
  fn: unknown,
  args: Record<string, unknown>,
  fallback: T,
  warnings: string[],
  label: string,
): Promise<T> {
  const client = getConvexClient();
  if (!client) return fallback;
  try {
    return (await client.query(fn as never, args as never)) as T;
  } catch (cause) {
    warnings.push(
      `Could not read ${label}: ${cause instanceof Error ? cause.message : "unknown error"}`,
    );
    return fallback;
  }
}

/** Convex fails a query returning more than 8,192 items; a sheet exceeds that. */
const PAGE = 2000;
const MAX_PAGES = 100;

async function readSheetRows(
  importId: string,
  marketplace: string,
  warnings: string[],
): Promise<NormalizedExcelRow[]> {
  const client = getConvexClient();
  if (!client) return [];

  const rows: NormalizedExcelRow[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    let result: {
      page: NormalizedExcelRow[];
      isDone: boolean;
      continueCursor: string | null;
    };
    try {
      result = (await client.query(anyApi.imports.sheetRowsPage as never, {
        importId,
        marketplace,
        cursor,
        numItems: PAGE,
      } as never)) as typeof result;
    } catch (cause) {
      warnings.push(
        `Could not read ${marketplace} rows: ${cause instanceof Error ? cause.message : "unknown error"}`,
      );
      return rows;
    }

    rows.push(...result.page);
    if (result.isDone || !result.continueCursor) return rows;
    cursor = result.continueCursor;
  }

  warnings.push(
    `Stopped after ${MAX_PAGES} pages of ${marketplace} rows; the figures below cover only what was read.`,
  );
  return rows;
}

export interface SohReportRequest {
  readonly importId?: string | null;
}

export async function loadSohReport(request: SohReportRequest): Promise<SohReport> {
  const warnings: string[] = [];

  const imports = await readConvex<ImportDoc[]>(
    anyApi.imports.list,
    { limit: 25 },
    [],
    warnings,
    "uploads",
  );

  const selected =
    (request.importId ? imports.find((row) => row._id === request.importId) : null) ??
    imports.find((row) => row.status === "completed") ??
    null;

  if (!selected) return emptyReport(warnings);

  const configs = await readConvex<MarketplaceConfigDoc[]>(
    anyApi.marketplaces.list,
    { includeInactive: true },
    [],
    warnings,
    "marketplace configuration",
  );
  const configByName = new Map(configs.map((doc) => [doc.marketplace, doc]));

  let sheets = await readConvex<SheetDoc[]>(
    anyApi.imports.sheetsForImport,
    { importId: selected._id },
    [],
    warnings,
    "marketplace sheets",
  );

  // Uploads made before multi-sheet imports existed have no sheet records. They
  // are single-marketplace by construction, so one is synthesised from the
  // import itself rather than showing them as empty.
  if (sheets.length === 0 && selected.marketplace) {
    sheets = [
      {
        _id: `${selected._id}-legacy`,
        marketplace: selected.marketplace,
        sheetName: selected.sheetName ?? selected.marketplace,
        status: "completed",
        minDate: selected.minDate,
        maxDate: selected.maxDate,
        totalRows: selected.totalRows,
        errorMessage: null,
      },
    ];
  }

  // The catalogue is the same for every marketplace, so it is read once.
  let catalog: CatalogIndex | null = null;
  let erpAvailable = false;
  try {
    const snapshot = await getCatalogSnapshot(getErpClient());
    catalog = new CatalogIndex(snapshot.items);
    erpAvailable = true;
  } catch (cause) {
    warnings.push(
      `Could not read the ERP catalogue, so products could not be matched: ${
        cause instanceof Error ? cause.message : "unknown error"
      }`,
    );
  }

  const sections: MarketplaceSection[] = [];

  for (const sheet of sheets) {
    if (sheet.status === "failed") {
      sections.push(failedSection(sheet));
      continue;
    }

    const config = configByName.get(sheet.marketplace) ?? null;
    const gstins = (config?.customerGstins ?? [])
      .map((value) => normalizeGstin(value))
      .filter((value): value is string => value !== null);

    const period =
      sheet.minDate && sheet.maxDate
        ? reportingPeriodFromDays(sheet.minDate, sheet.maxDate)
        : null;

    const sheetRows = await readSheetRows(selected._id, sheet.marketplace, warnings);

    const confirmed = await readConvex<ConfirmedMapping[]>(
      anyApi.productMappings.listForMarketplace,
      { marketplace: sheet.marketplace },
      [],
      warnings,
      `${sheet.marketplace} product mappings`,
    );

    const mapped = catalog
      ? mapExcelRows(sheetRows, catalog, {
          channelProvider: config?.erpChannelProvider ?? null,
          confirmed: new ConfirmedMappingIndex(confirmed),
        })
      : null;

    // ERP sell-in, for this marketplace's own window only.
    let erpLines: SalesOrderLine[] = [];
    let erpState: MarketplaceErpState = "notConfigured";
    let erpMessage: string | null =
      "No ERP customer is configured for this marketplace, so there is no sell-in to compare against.";

    if (gstins.length > 0 && period && erpAvailable) {
      try {
        const byItemId = new Map<string, SalesOrderLine>();
        for (const gstin of gstins) {
          const result = await fetchReportLines(getErpClient(), {
            period,
            customerGstin: gstin,
          });
          // Merged on the line id so an order returned under two GSTINs is
          // counted once.
          for (const line of result.lines) byItemId.set(line.salesOrderItemId, line);
        }
        erpLines = [...byItemId.values()];
        erpState = "reconciled";
        erpMessage = null;
      } catch (cause) {
        erpState = "unavailable";
        erpMessage =
          cause instanceof Error
            ? cause.message
            : "The ERP could not be reached for this marketplace.";
        warnings.push(`${sheet.marketplace}: ${erpMessage}`);
      }
    } else if (gstins.length > 0 && !period) {
      erpState = "unavailable";
      erpMessage =
        "This sheet has no usable dates, so there is no window to query the ERP for.";
    }

    const reconciliation = reconcileBySku(
      (mapped?.rows ?? sheetRows) as MappedExcelRow[] | NormalizedExcelRow[],
      erpLines,
    );

    const reportable = erpLines.filter((line) => isReportableStatus(line.status));
    const unresolved = countUnresolvedProducts(mapped?.rows ?? []);
    const totalProducts = mapped?.statistics.distinctProducts ?? 0;

    sections.push({
      marketplace: sheet.marketplace,
      sheetName: sheet.sheetName,
      status: "completed",
      error: null,
      period,
      rows: reconciliation.rows,
      mapping: mapped?.statistics ?? null,
      sheetRows: sheetRows.length,
      sellOutQuantity: reconciliation.totals.excelQuantity,
      sellOutRevenue: reconciliation.totals.excelRevenue,
      erpState,
      erpMessage,
      erpOrders: new Set(reportable.map((line) => line.salesOrderId)).size,
      erpLines: reportable.length,
      sellInQuantity: reconciliation.totals.erpQuantity,
      sellInRevenue: reconciliation.totals.erpRevenue,
      gstins,
      unresolvedProducts: unresolved,
      mappedProducts: Math.max(0, totalProducts - unresolved),
      totalProducts,
      unresolvedRows: buildUnresolvedRows(mapped?.rows ?? []),
    });
  }

  // Stock is read once for every ERP item any marketplace named.
  const itemIds = sections
    .flatMap((section) => section.rows.map((row) => row.erpItemId))
    .filter((id): id is string => id !== null);

  let stock = emptyStockSnapshot();
  if (erpAvailable && itemIds.length > 0) {
    stock = await fetchStockPositions(getErpClient(), itemIds);
    if (!stock.available && stock.error) {
      warnings.push(`Could not read the current stock position: ${stock.error}`);
    }
  }

  const periods = sections
    .map((section) => section.period)
    .filter((period): period is ReportingPeriod => period !== null);

  const periodsDiffer =
    periods.length > 1 &&
    periods.some(
      (period) =>
        period.fromDay !== periods[0]!.fromDay || period.toDay !== periods[0]!.toDay,
    );

  return {
    importId: selected._id,
    fileName: selected.fileName,
    uploadedAt: selected.uploadedAt,
    sections,
    marketplaces: sections.map((section) => section.marketplace),
    period:
      periods.length === 0
        ? null
        : periodsDiffer
          ? null
          : reportingPeriodFromDays(periods[0]!.fromDay, periods[0]!.toDay),
    periodsDiffer,
    stock,
    stockAvailable: stock.available && stock.itemsFound > 0,
    stockError: stock.error,
    erpAvailable,
    warnings,
    historyReason: HISTORY_REASON,
  };
}

/**
 * Products that reached no ERP item, grouped per distinct product.
 *
 * Grouped rather than listed per row: the same unmapped EAN appears on a
 * thousand spreadsheet rows, and a review screen showing it a thousand times is
 * a review screen nobody finishes. Quantities are summed across every row; the
 * row number is the first occurrence so the file can be opened at it.
 */
function buildUnresolvedRows(
  rows: ReadonlyArray<MappedExcelRow>,
): UnresolvedProduct[] {
  const byProduct = new Map<string, UnresolvedProduct>();

  for (const entry of rows) {
    if (entry.mapping.status === "mapped") continue;
    const existing = byProduct.get(entry.key);

    if (existing) {
      byProduct.set(entry.key, {
        ...existing,
        rowCount: existing.rowCount + 1,
        quantity: (existing.quantity ?? 0) + (entry.row.quantity ?? 0),
        amount: (existing.amount ?? 0) + (entry.row.grossSales ?? 0),
      });
      continue;
    }

    byProduct.set(entry.key, {
      sourceRow: entry.row.sourceRow,
      orderDate: entry.row.orderDate,
      productName: entry.row.productName,
      marketplaceItemId: entry.row.marketplaceItemId,
      ean: entry.row.barcode ?? entry.row.sku,
      sku: entry.row.sku ?? entry.row.barcode,
      quantity: entry.row.quantity,
      amount: entry.row.grossSales,
      rowCount: 1,
      status: entry.mapping.status === "ambiguous" ? "ambiguous" : "unmapped",
      reason: entry.mapping.reason,
      candidates: entry.mapping.candidates.map((candidate) => ({
        itemId: candidate.itemId,
        sku: candidate.sku,
        name: candidate.name,
      })),
    });
  }

  return [...byProduct.values()].sort(
    (a, b) => (b.quantity ?? 0) - (a.quantity ?? 0),
  );
}

function countUnresolvedProducts(rows: ReadonlyArray<MappedExcelRow>): number {
  const keys = new Set<string>();
  for (const entry of rows) {
    if (entry.mapping.status === "mapped") continue;
    keys.add(entry.key);
  }
  return keys.size;
}

function failedSection(sheet: SheetDoc): MarketplaceSection {
  return {
    marketplace: sheet.marketplace,
    sheetName: sheet.sheetName,
    status: "failed",
    error: sheet.errorMessage ?? "This sheet could not be read.",
    period: null,
    rows: [],
    mapping: null,
    sheetRows: 0,
    sellOutQuantity: 0,
    sellOutRevenue: 0,
    erpState: "notConfigured",
    erpMessage: null,
    erpOrders: 0,
    erpLines: 0,
    sellInQuantity: 0,
    sellInRevenue: 0,
    gstins: [],
    unresolvedProducts: 0,
    mappedProducts: 0,
    totalProducts: 0,
    unresolvedRows: [],
  };
}

function emptyReport(warnings: string[]): SohReport {
  return {
    importId: null,
    fileName: null,
    uploadedAt: null,
    sections: [],
    marketplaces: [],
    period: null,
    periodsDiffer: false,
    stock: emptyStockSnapshot(),
    stockAvailable: false,
    stockError: null,
    erpAvailable: false,
    warnings,
    historyReason: HISTORY_REASON,
  };
}

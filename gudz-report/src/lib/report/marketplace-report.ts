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
import { isReportableStatus, reportedQuantity } from "./policy";
import {
  CatalogIndex,
  ConfirmedMappingIndex,
  mapExcelRows,
  type ConfirmedMapping,
  type MappedExcelRow,
  type MappingStatistics,
} from "./product-mapping";
import {
  reconcileBySku,
  type SkuReconciliationResult,
} from "./sku-reconciliation";

/**
 * The marketplace report, end to end.
 *
 * One marketplace, one period, both sides, in the order the client's question
 * actually runs:
 *
 *   import → period → configured GSTINs → ERP lines → catalogue → mapping →
 *   SKU reconciliation → the numbers on the page
 *
 * Nothing here knows what a Blinkit is. The marketplace is a key, its GSTINs
 * come from Convex configuration, and its ERP channel provider — if it has one —
 * comes from the same place. Adding Zepto is a configuration row plus the sheet
 * profile that already exists, not a change to this file.
 *
 * Degrades rather than fails. The ERP needs a key, Convex needs a deployment,
 * and a dashboard that refuses to render because one of them is unconfigured is
 * useless during exactly the period when you are configuring it. Every
 * degradation is reported as a warning — "no rows" and "could not read the rows"
 * look identical on screen and mean very different things.
 */

export interface MarketplaceConfig {
  readonly marketplace: string;
  readonly customerGstins: ReadonlyArray<string>;
  readonly knownChannelValues?: ReadonlyArray<string>;
  /** ERP `channelItemMappings.provider`, when this marketplace has one. */
  readonly erpChannelProvider?: string | null;
  readonly isActive?: boolean;
}

export interface ExcelSideSummary {
  readonly fileName: string | null;
  readonly sheet: string | null;
  readonly rows: number;
  readonly minDate: string | null;
  readonly maxDate: string | null;
  readonly quantity: number;
  readonly revenue: number;
  readonly mapping: MappingStatistics | null;
}

export interface ErpSideSummary {
  readonly orders: number;
  readonly lines: number;
  readonly skus: number;
  readonly customers: number;
  readonly quantity: number;
  readonly revenue: number;
  readonly pages: number;
  readonly gstins: ReadonlyArray<string>;
  /** ERP-computed totals for the filtered set, when the API returned them. */
  readonly erpReportedOrders: number | null;
  readonly erpReportedQuantity: number | null;
  readonly erpReportedRevenue: number | null;
}

export interface ReportKpis {
  readonly erpOrders: number;
  readonly erpCustomers: number;
  readonly erpUnits: number;
  readonly erpRevenue: number;
  readonly reportUnits: number;
  readonly reportRevenue: number;
  readonly skusMatched: number;
  readonly skusWithVariance: number;
  readonly skusErpOnly: number;
  readonly skusExcelOnly: number;
  readonly unmappedRows: number;
  readonly ambiguousRows: number;
}

/** One spreadsheet row that did not reach an ERP product, and why. */
export interface UnmappedReportRow {
  readonly sourceRow: number;
  readonly orderDate: string | null;
  readonly productName: string | null;
  readonly marketplaceItemId: string | null;
  /** The row's EAN, kept apart from `sku` because a confirmation keys on it. */
  readonly ean: string | null;
  readonly sku: string | null;
  readonly quantity: number | null;
  readonly amount: number | null;
  /** How many spreadsheet rows carry this product. */
  readonly rowCount: number;
  readonly status: "ambiguous" | "unmapped";
  readonly reason: string;
  readonly candidates: ReadonlyArray<{
    /** The ERP identity. Carried so a confirmation records an item, not a SKU. */
    itemId: string;
    sku: string;
    name: string;
  }>;
}

export interface MarketplaceReport {
  readonly marketplace: string | null;
  readonly period: ReportingPeriod;
  readonly excel: ExcelSideSummary;
  readonly erp: ErpSideSummary;
  readonly kpis: ReportKpis;
  readonly reconciliation: SkuReconciliationResult;
  readonly unmappedRows: UnmappedReportRow[];
  readonly catalog: {
    readonly items: number;
    readonly withBarcode: number;
    readonly withChannelMapping: number;
    readonly duplicateBarcodes: number;
    readonly fromCache: boolean;
  } | null;
  readonly availableMarketplaces: ReadonlyArray<MarketplaceConfig>;
  /** How many mappings a person has confirmed for this marketplace. */
  readonly confirmedMappingCount: number;
  readonly erpAvailable: boolean;
  readonly convexAvailable: boolean;
  readonly warnings: string[];
}

interface ImportDoc {
  _id: string;
  fileName: string;
  marketplace?: string | null;
  sheetName?: string | null;
  status: string;
  minDate: string | null;
  maxDate: string | null;
  totalRows: number;
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
      `Could not read ${label} from Convex: ${
        cause instanceof Error ? cause.message : "unknown error"
      }`,
    );
    return fallback;
  }
}

/** How many rows to pull per Convex page. Its hard ceiling is 8,192 per query. */
const EXCEL_PAGE_SIZE = 2000;
/** Runaway guard for the page walk: 200k rows is far past any real sheet. */
const EXCEL_MAX_PAGES = 100;

/**
 * Every row of an import, one Convex page at a time.
 *
 * Convex fails — not truncates — a query returning more than 8,192 items, and
 * the real Blinkit sheet is 8,451 rows. Asking for them all in one call made the
 * dashboard render an ERP-only report with a Convex error in place of the
 * spreadsheet, which is exactly the "looks like no data" failure the warnings
 * exist to prevent.
 */
async function readAllExcelRows(
  importId: string,
  warnings: string[],
): Promise<NormalizedExcelRow[]> {
  const client = getConvexClient();
  if (!client) return [];

  const rows: NormalizedExcelRow[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < EXCEL_MAX_PAGES; page += 1) {
    let result: {
      page: NormalizedExcelRow[];
      isDone: boolean;
      continueCursor: string | null;
    };

    try {
      result = (await client.query(anyApi.imports.rowsPage as never, {
        importId,
        cursor,
        numItems: EXCEL_PAGE_SIZE,
      } as never)) as typeof result;
    } catch (cause) {
      warnings.push(
        `Could not read spreadsheet rows from Convex: ${
          cause instanceof Error ? cause.message : "unknown error"
        }`,
      );
      return rows;
    }

    rows.push(...result.page);
    if (result.isDone || !result.continueCursor) return rows;
    cursor = result.continueCursor;
  }

  warnings.push(
    `Stopped after ${EXCEL_MAX_PAGES} pages of spreadsheet rows (${rows.length} read). The report below covers only what was read.`,
  );
  return rows;
}

/** Imports available to report on, most recent first. */
export async function listImports(limit = 25): Promise<ImportDoc[]> {
  return await readConvex<ImportDoc[]>(
    anyApi.imports.list,
    { limit },
    [],
    [],
    "imports",
  );
}

export interface MarketplaceReportRequest {
  /** Which import to report on. Null means the most recent usable one. */
  readonly importId?: string | null;
  /** Overrides the marketplace the import recorded. */
  readonly marketplace?: string | null;
  /** Overrides the period the import derived. Rarely wanted — see below. */
  readonly period?: ReportingPeriod | null;
}

/**
 * Fetches ERP lines for every GSTIN a marketplace trades under.
 *
 * One request per GSTIN rather than one per order: a marketplace's regional
 * entities register separately, and the ERP filters on a single GSTIN. Results
 * are merged on `salesOrderItemId` so an order that somehow came back under two
 * GSTINs is counted once.
 */
async function fetchErpLines(
  period: ReportingPeriod,
  gstins: ReadonlyArray<string>,
  warnings: string[],
): Promise<{
  lines: SalesOrderLine[];
  pages: number;
  summary: { orders: number; quantity: number; revenue: number } | null;
}> {
  const client = getErpClient();
  const byItemId = new Map<string, SalesOrderLine>();
  let pages = 0;
  let orders: number | null = null;
  let quantity: number | null = null;
  let revenue: number | null = null;

  // No configured GSTIN means no filter, which is every B2B customer rather
  // than this marketplace. Reported loudly — the numbers are real but they are
  // not the marketplace's.
  const targets = gstins.length > 0 ? gstins : [undefined];

  for (const gstin of targets) {
    const result = await fetchReportLines(client, { period, customerGstin: gstin });
    pages += result.pages;
    for (const line of result.lines) byItemId.set(line.salesOrderItemId, line);

    if (result.summary) {
      orders = (orders ?? 0) + result.summary.orders;
      quantity = (quantity ?? 0) + result.summary.totalQuantity;
      revenue = (revenue ?? 0) + result.summary.totalAmount;
    }
  }

  if (gstins.length === 0) {
    warnings.push(
      "No customer GSTIN is configured for this marketplace, so the ERP figures below cover every B2B customer, not just this one. Configure the marketplace's GSTIN to narrow them.",
    );
  }

  return {
    lines: [...byItemId.values()],
    pages,
    summary:
      orders === null || quantity === null || revenue === null
        ? null
        : { orders, quantity, revenue },
  };
}

export async function loadMarketplaceReport(
  request: MarketplaceReportRequest,
  fallbackPeriod: ReportingPeriod,
): Promise<MarketplaceReport> {
  const warnings: string[] = [];

  const marketplaceDocs = await readConvex<MarketplaceConfig[]>(
    anyApi.marketplaces.list,
    { includeInactive: true },
    [],
    warnings,
    "marketplace configuration",
  );

  const imports = await readConvex<ImportDoc[]>(
    anyApi.imports.list,
    { limit: 25 },
    [],
    warnings,
    "imports",
  );

  const usableImports = imports.filter(
    (row) => row.status === "completed" && row.minDate && row.maxDate,
  );

  const selectedImport =
    (request.importId
      ? imports.find((row) => row._id === request.importId)
      : undefined) ??
    (request.marketplace
      ? usableImports.find((row) => row.marketplace === request.marketplace)
      : undefined) ??
    usableImports[0] ??
    null;

  const marketplace =
    request.marketplace ?? selectedImport?.marketplace ?? null;

  // The period is the import's own, derived from the sheet's dates. An explicit
  // range is honoured but is not the normal path: the whole point is that the
  // file says what window it covers.
  const period =
    request.period ??
    (selectedImport?.minDate && selectedImport.maxDate
      ? reportingPeriodFromDays(selectedImport.minDate, selectedImport.maxDate)
      : fallbackPeriod);

  const config =
    marketplace === null
      ? null
      : (marketplaceDocs.find((doc) => doc.marketplace === marketplace) ?? null);

  if (marketplace && !config) {
    warnings.push(
      `No configuration exists for "${marketplace}". Add its customer GSTIN so the ERP side can be narrowed to this marketplace.`,
    );
  }

  const gstins = (config?.customerGstins ?? [])
    .map((value) => normalizeGstin(value))
    .filter((value): value is string => value !== null);

  const excelRows = selectedImport
    ? await readAllExcelRows(selectedImport._id, warnings)
    : [];

  let erpLines: SalesOrderLine[] = [];
  let erpPages = 0;
  let erpSummary: { orders: number; quantity: number; revenue: number } | null = null;
  let erpAvailable = false;

  try {
    const result = await fetchErpLines(period, gstins, warnings);
    erpLines = result.lines;
    erpPages = result.pages;
    erpSummary = result.summary;
    erpAvailable = true;
  } catch (cause) {
    warnings.push(
      `Could not read the ERP: ${cause instanceof Error ? cause.message : "unknown error"}`,
    );
  }

  let catalogIndex: CatalogIndex | null = null;
  let catalogFromCache = false;
  if (erpAvailable) {
    try {
      const snapshot = await getCatalogSnapshot(getErpClient());
      catalogIndex = new CatalogIndex(snapshot.items);
      catalogFromCache = snapshot.fromCache;
    } catch (cause) {
      warnings.push(
        `Could not read the ERP catalogue, so spreadsheet rows could not be mapped to ERP products: ${
          cause instanceof Error ? cause.message : "unknown error"
        }`,
      );
    }
  }

  // Read fresh every time rather than cached alongside the catalogue: a person
  // who has just confirmed a mapping expects the next render to reflect it.
  const confirmedDocs = marketplace
    ? await readConvex<ConfirmedMapping[]>(
        anyApi.productMappings.listForMarketplace,
        { marketplace },
        [],
        warnings,
        "confirmed product mappings",
      )
    : [];

  const mappingResult = catalogIndex
    ? mapExcelRows(excelRows, catalogIndex, {
        channelProvider: config?.erpChannelProvider ?? null,
        confirmed: new ConfirmedMappingIndex(confirmedDocs),
      })
    : null;

  const mappedRows: MappedExcelRow[] = mappingResult?.rows ?? [];

  const reconciliation = reconcileBySku(
    mappingResult ? mappedRows : excelRows,
    erpLines,
  );

  const reportable = erpLines.filter((line) => isReportableStatus(line.status));

  const erp: ErpSideSummary = {
    orders: new Set(reportable.map((line) => line.salesOrderId)).size,
    lines: reportable.length,
    skus: new Set(reportable.map((line) => line.sku)).size,
    customers: new Set(
      reportable.map(
        (line) => line.customerGstin ?? line.customerId ?? line.customerName,
      ),
    ).size,
    quantity: reportable.reduce((total, line) => total + reportedQuantity(line), 0),
    revenue: reportable.reduce((total, line) => total + line.lineTotal, 0),
    pages: erpPages,
    gstins,
    erpReportedOrders: erpSummary?.orders ?? null,
    erpReportedQuantity: erpSummary?.quantity ?? null,
    erpReportedRevenue: erpSummary?.revenue ?? null,
  };

  const excelQuantity = excelRows.reduce((total, row) => total + (row.quantity ?? 0), 0);
  const excelRevenue = excelRows.reduce((total, row) => total + (row.grossSales ?? 0), 0);

  const excel: ExcelSideSummary = {
    fileName: selectedImport?.fileName ?? null,
    sheet: selectedImport?.sheetName ?? null,
    rows: excelRows.length,
    minDate: selectedImport?.minDate ?? null,
    maxDate: selectedImport?.maxDate ?? null,
    quantity: excelQuantity,
    revenue: excelRevenue,
    mapping: mappingResult?.statistics ?? null,
  };

  return {
    marketplace,
    period,
    excel,
    erp,
    kpis: {
      erpOrders: erp.orders,
      erpCustomers: erp.customers,
      erpUnits: erp.quantity,
      erpRevenue: erp.revenue,
      reportUnits: excelQuantity,
      reportRevenue: excelRevenue,
      skusMatched: reconciliation.counts.skusMatched,
      skusWithVariance: reconciliation.counts.skusWithVariance,
      skusErpOnly: reconciliation.counts.skusErpOnly,
      skusExcelOnly: reconciliation.counts.skusExcelOnly,
      unmappedRows: mappingResult?.statistics.unmapped ?? 0,
      ambiguousRows: mappingResult?.statistics.ambiguous ?? 0,
    },
    reconciliation,
    unmappedRows: buildUnmappedRows(mappedRows),
    catalog: catalogIndex
      ? { ...catalogIndex.counts, fromCache: catalogFromCache }
      : null,
    availableMarketplaces: marketplaceDocs,
    confirmedMappingCount: confirmedDocs.length,
    erpAvailable,
    convexAvailable: getConvexClient() !== null,
    warnings,
  };
}

/**
 * Rows that did not reach an ERP product.
 *
 * Capped for the page, not for the counts: the KPI and mapping statistics are
 * exact, this is the listing a human reads. Grouped per distinct product so the
 * same unmapped EAN does not fill the table with twelve hundred identical rows.
 */
function buildUnmappedRows(rows: ReadonlyArray<MappedExcelRow>): UnmappedReportRow[] {
  const byProduct = new Map<string, UnmappedReportRow>();

  for (const entry of rows) {
    if (entry.mapping.status === "mapped") continue;
    const key = entry.key;
    const existing = byProduct.get(key);

    if (existing) {
      byProduct.set(key, {
        ...existing,
        rowCount: existing.rowCount + 1,
        quantity: (existing.quantity ?? 0) + (entry.row.quantity ?? 0),
        amount: (existing.amount ?? 0) + (entry.row.grossSales ?? 0),
      });
      continue;
    }

    byProduct.set(key, {
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

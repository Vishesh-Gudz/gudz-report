import type { SalesOrderLine } from "../../types/erp";
import type { NormalizedExcelRow } from "../../types/excel";
import type { ReportingPeriod } from "../dates/reporting-period";
import { MarketplaceIndex, type Attribution } from "./attribution";
import type { ReconciliationResult } from "./matching";
import { reconcileBySku, type SkuReconciliationResult } from "./sku-reconciliation";
import { isReportableStatus, reportedQuantity } from "./policy";

/**
 * Turning reconciled rows into the numbers on the page.
 *
 * Aggregated once, here, rather than recomputed inside components: a KPI card
 * and a table that each total the same rows independently will eventually
 * disagree, and the version a client happens to read first becomes the one they
 * quote back.
 *
 * Every total is built from ERP lines that pass the status policy. Drafts are
 * excluded before anything is summed, not filtered out of the display
 * afterwards.
 */

export interface ReportKpis {
  readonly orders: number;
  readonly customers: number;
  readonly unitsOrdered: number;
  readonly revenue: number;
  readonly matchedLines: number;
  readonly unmatchedLines: number;
  readonly ambiguousLines: number;
  readonly erpOnlyLines: number;
  /** ERP lines whose marketplace could not be established. Surfaced, not hidden. */
  readonly unattributedLines: number;
  readonly excelRows: number;
  readonly excelUnits: number;
  readonly excelRevenue: number;
}

/** One row of the main report table: an ERP line plus its reconciliation. */
export interface ReportLineRow {
  readonly key: string;
  readonly salesOrderId: string;
  readonly soNumber: string;
  readonly orderDate: string;
  readonly customerName: string;
  readonly customerGstin: string | null;
  readonly marketplace: string;
  readonly channel: string | null;
  readonly productName: string;
  readonly sku: string;
  readonly orderedQuantity: number;
  readonly shippedQuantity: number;
  readonly deliveredQuantity: number;
  readonly unitPrice: number;
  readonly lineTotal: number;
  readonly status: string;
  readonly matchStatus: "matched" | "unmatched" | "erpOnly" | "ambiguous";
  readonly excelQuantity: number | null;
  readonly excelAmount: number | null;
  readonly quantityVariance: number | null;
  readonly amountVariance: number | null;
}

/** One row of the product summary — the reconciliation view a client reads first. */
export interface ProductSummaryRow {
  readonly sku: string;
  readonly productName: string;
  readonly orders: number;
  readonly erpQuantity: number;
  readonly excelQuantity: number;
  readonly erpRevenue: number;
  readonly excelRevenue: number;
  readonly quantityVariance: number;
  readonly amountVariance: number;
  readonly matchedLines: number;
  readonly unmatchedLines: number;
}

export interface UnmatchedRow {
  readonly sourceRow: number;
  readonly orderDate: string | null;
  readonly marketplace: string;
  readonly sku: string | null;
  readonly productName: string | null;
  readonly quantity: number | null;
  readonly amount: number | null;
  readonly reason: string;
}

export interface ReportModel {
  readonly period: ReportingPeriod;
  readonly kpis: ReportKpis;
  readonly lines: ReportLineRow[];
  readonly products: ProductSummaryRow[];
  /**
   * The primary reconciliation. SKU-level, because a month of real data has the
   * same product on dozens of ERP lines and line-to-line matching can only
   * report ambiguity. See `sku-reconciliation.ts`.
   */
  readonly skuReconciliation: SkuReconciliationResult;
  readonly unmatched: UnmatchedRow[];
  readonly marketplaces: string[];
  readonly customers: string[];
  readonly statuses: string[];
}

/** Reason text a human can act on, rather than an enum name. */
const UNMATCHED_REASONS: Record<string, string> = {
  noIdentifier: "No SKU, barcode or marketplace item id on the row",
  noErpLine: "No ERP line in this period with that identifier",
  ambiguous: "Identifier matched more than one ERP line — needs a human",
  quantityOnly: "Quantity present but nothing to match it to",
};

function lineRowFromPair(
  pair: ReconciliationResult["pairs"][number],
): ReportLineRow | null {
  if (!pair.erpLine) return null;
  const line = pair.erpLine;
  return {
    key: line.salesOrderItemId,
    salesOrderId: line.salesOrderId,
    soNumber: line.soNumber,
    orderDate: line.orderDate,
    customerName: line.customerName,
    customerGstin: pair.attribution?.gstin ?? line.customerGstin,
    marketplace: pair.attribution?.marketplace ?? "Unattributed",
    channel: line.channel,
    productName: line.name,
    sku: line.sku,
    orderedQuantity: reportedQuantity(line),
    shippedQuantity: line.shippedQuantity,
    deliveredQuantity: line.deliveredQuantity,
    unitPrice: line.unitPrice,
    lineTotal: line.lineTotal,
    status: line.status,
    matchStatus: "matched",
    excelQuantity: pair.excelRow.quantity,
    excelAmount: pair.excelRow.grossSales,
    quantityVariance: pair.quantityVariance,
    amountVariance: pair.amountVariance,
  };
}

function lineRowFromErpOnly(entry: {
  line: SalesOrderLine;
  attribution: Attribution;
}): ReportLineRow {
  const { line, attribution } = entry;
  return {
    key: line.salesOrderItemId,
    salesOrderId: line.salesOrderId,
    soNumber: line.soNumber,
    orderDate: line.orderDate,
    customerName: line.customerName,
    customerGstin: attribution.gstin ?? line.customerGstin,
    marketplace: attribution.marketplace,
    channel: line.channel,
    productName: line.name,
    sku: line.sku,
    orderedQuantity: reportedQuantity(line),
    shippedQuantity: line.shippedQuantity,
    deliveredQuantity: line.deliveredQuantity,
    unitPrice: line.unitPrice,
    lineTotal: line.lineTotal,
    status: line.status,
    // Present in the ERP, absent from the spreadsheet. A different problem from
    // an unmatched Excel row, and kept distinct so it points at the right system.
    matchStatus: "erpOnly",
    excelQuantity: null,
    excelAmount: null,
    quantityVariance: null,
    amountVariance: null,
  };
}

/**
 * Builds the whole report model from reconciled data.
 *
 * `erpLines` is passed separately from the reconciliation so the ERP half can be
 * reported on its own — before any spreadsheet has been uploaded, the dashboard
 * still shows real orders, revenue and customers, with every row marked
 * `erpOnly`.
 */
export function buildReportModel(args: {
  period: ReportingPeriod;
  erpLines: ReadonlyArray<SalesOrderLine>;
  reconciliation: ReconciliationResult;
  marketplaces: MarketplaceIndex;
  excelRows?: ReadonlyArray<NormalizedExcelRow>;
}): ReportModel {
  const { period, erpLines, reconciliation, marketplaces } = args;
  // Falls back to the reconciled pairs so callers that already ran the
  // line-level pass do not have to hand the rows over twice.
  const allExcelRows =
    args.excelRows ?? reconciliation.pairs.map((pair) => pair.excelRow);

  const reportable = erpLines.filter((line) => isReportableStatus(line.status));

  const matchedRows = reconciliation.pairs
    .map(lineRowFromPair)
    .filter((row): row is ReportLineRow => row !== null);
  const erpOnlyRows = reconciliation.erpOnly.map(lineRowFromErpOnly);

  const lines = [...matchedRows, ...erpOnlyRows].sort((a, b) =>
    a.orderDate === b.orderDate
      ? a.soNumber.localeCompare(b.soNumber)
      : b.orderDate.localeCompare(a.orderDate),
  );

  // Orders and customers are counted from distinct ids, not from line counts —
  // a 17-line order is one order.
  const orderIds = new Set(reportable.map((line) => line.salesOrderId));
  const customerKeys = new Set(
    reportable.map(
      (line) => line.customerGstin ?? line.customerId ?? line.customerName,
    ),
  );

  const unitsOrdered = reportable.reduce(
    (total, line) => total + reportedQuantity(line),
    0,
  );
  const revenue = reportable.reduce((total, line) => total + line.lineTotal, 0);

  const unattributedLines = reportable.filter(
    (line) => !marketplaces.attribute({ customerGstin: line.customerGstin }).attributed,
  ).length;

  const excelRows = reconciliation.pairs.length;
  const excelUnits = reconciliation.pairs.reduce(
    (total, pair) => total + (pair.excelRow.quantity ?? 0),
    0,
  );
  const excelRevenue = reconciliation.pairs.reduce(
    (total, pair) => total + (pair.excelRow.grossSales ?? 0),
    0,
  );

  const kpis: ReportKpis = {
    orders: orderIds.size,
    customers: customerKeys.size,
    unitsOrdered,
    revenue,
    matchedLines: reconciliation.counts.matched,
    unmatchedLines: reconciliation.counts.unmatched,
    ambiguousLines: reconciliation.counts.ambiguous,
    erpOnlyLines: reconciliation.counts.erpOnly,
    unattributedLines,
    excelRows,
    excelUnits,
    excelRevenue,
  };

  return {
    period,
    kpis,
    lines,
    products: buildProductSummary(lines),
    skuReconciliation: reconcileBySku(allExcelRows, erpLines),
    unmatched: buildUnmatchedRows(reconciliation),
    marketplaces: [...new Set(lines.map((row) => row.marketplace))].sort(),
    customers: [...new Set(lines.map((row) => row.customerName))].sort(),
    statuses: [...new Set(lines.map((row) => row.status))].sort(),
  };
}

/**
 * Per-product reconciliation.
 *
 * Grouped by SKU rather than by product name: names drift between the
 * marketplace's spelling and the ERP's, and grouping on them would split one
 * product across several rows.
 */
export function buildProductSummary(
  lines: ReadonlyArray<ReportLineRow>,
): ProductSummaryRow[] {
  const bySku = new Map<
    string,
    {
      productName: string;
      orders: Set<string>;
      erpQuantity: number;
      excelQuantity: number;
      erpRevenue: number;
      excelRevenue: number;
      matched: number;
      unmatched: number;
    }
  >();

  for (const row of lines) {
    const entry = bySku.get(row.sku) ?? {
      productName: row.productName,
      orders: new Set<string>(),
      erpQuantity: 0,
      excelQuantity: 0,
      erpRevenue: 0,
      excelRevenue: 0,
      matched: 0,
      unmatched: 0,
    };

    entry.orders.add(row.salesOrderId);
    entry.erpQuantity += row.orderedQuantity;
    entry.erpRevenue += row.lineTotal;
    entry.excelQuantity += row.excelQuantity ?? 0;
    entry.excelRevenue += row.excelAmount ?? 0;
    if (row.matchStatus === "matched") entry.matched += 1;
    else entry.unmatched += 1;

    bySku.set(row.sku, entry);
  }

  return [...bySku.entries()]
    .map(([sku, entry]) => ({
      sku,
      productName: entry.productName,
      orders: entry.orders.size,
      erpQuantity: entry.erpQuantity,
      excelQuantity: entry.excelQuantity,
      erpRevenue: entry.erpRevenue,
      excelRevenue: entry.excelRevenue,
      quantityVariance: entry.excelQuantity - entry.erpQuantity,
      amountVariance: entry.excelRevenue - entry.erpRevenue,
      matchedLines: entry.matched,
      unmatchedLines: entry.unmatched,
    }))
    .sort((a, b) => b.erpRevenue - a.erpRevenue);
}

/** Spreadsheet rows that did not reconcile, with a reason a human can act on. */
export function buildUnmatchedRows(
  reconciliation: ReconciliationResult,
): UnmatchedRow[] {
  return reconciliation.pairs
    .filter((pair) => pair.status !== "matched")
    .map((pair) => ({
      sourceRow: pair.excelRow.sourceRow,
      orderDate: pair.excelRow.orderDate,
      marketplace: pair.attribution?.marketplace ?? "Unattributed",
      sku: pair.excelRow.sku,
      productName: pair.excelRow.productName,
      quantity: pair.excelRow.quantity,
      amount: pair.excelRow.grossSales,
      reason:
        (pair.reason && UNMATCHED_REASONS[pair.reason]) ??
        "Could not be reconciled",
    }))
    .sort((a, b) => a.sourceRow - b.sourceRow);
}

export interface ReportFilters {
  readonly marketplace?: string;
  readonly customer?: string;
  readonly sku?: string;
  readonly product?: string;
  readonly status?: string;
  readonly matchStatus?: ReportLineRow["matchStatus"];
}

/**
 * Applies the UI filters.
 *
 * Text filters are case-insensitive substring matches; the exact-match filters
 * (marketplace, status) are the ones driven by dropdowns built from the data, so
 * a typo there is impossible by construction.
 */
export function filterLines(
  lines: ReadonlyArray<ReportLineRow>,
  filters: ReportFilters,
): ReportLineRow[] {
  const contains = (haystack: string, needle: string) =>
    haystack.toLowerCase().includes(needle.trim().toLowerCase());

  return lines.filter((row) => {
    if (filters.marketplace && row.marketplace !== filters.marketplace) return false;
    if (filters.status && row.status !== filters.status) return false;
    if (filters.matchStatus && row.matchStatus !== filters.matchStatus) return false;
    if (filters.customer && !contains(row.customerName, filters.customer)) return false;
    if (filters.sku && !contains(row.sku, filters.sku)) return false;
    if (filters.product && !contains(row.productName, filters.product)) return false;
    return true;
  });
}

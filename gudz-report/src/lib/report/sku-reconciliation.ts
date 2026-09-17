import type { SalesOrderLine } from "../../types/erp";
import type { NormalizedExcelRow } from "../../types/excel";
import type { MappedExcelRow } from "./product-mapping";
import { isReportableStatus, reportedQuantity } from "./policy";

/**
 * SKU-level reconciliation — the primary mode.
 *
 * Line-level matching does not survive contact with a month of real data. A
 * product is sold repeatedly, so one marketplace line's SKU matches dozens of
 * ERP lines and the matcher can only report every row as ambiguous. Verified
 * against production: 4,357 ERP lines for August, and every SKU lookup was
 * multi-candidate.
 *
 * Nothing in that is a bug — refusing to pick one of dozens is correct. The
 * mistake would be forcing a line-to-line join the data cannot support. Both
 * sides are therefore aggregated by SKU and compared in totals, which is also
 * the question a client asks: "we sold 14,978 of this — does the ERP agree?"
 *
 * Line-level matching is kept as a secondary diagnostic (`matching.ts`), and its
 * ambiguity is reported rather than hidden.
 */

export type SkuMatchStatus =
  /** Present on both sides and in agreement. */
  | "matched"
  /** Present on both sides, but the numbers disagree. */
  | "variance"
  | "excelOnly"
  | "erpOnly";

/** One ERP order contributing to a SKU. Shown when a product is opened. */
export interface SkuErpOrderRef {
  readonly salesOrderId: string;
  readonly soNumber: string;
  readonly orderDate: string;
  readonly status: string;
  readonly quantity: number;
  readonly amount: number;
}

/** One spreadsheet row contributing to a SKU. */
export interface SkuExcelRowRef {
  readonly sourceRow: number;
  readonly orderDate: string | null;
  readonly productName: string | null;
  readonly quantity: number | null;
  readonly amount: number | null;
}

export interface SkuReconciliationRow {
  readonly sku: string;
  /**
   * The ERP item id behind this SKU, when one is known.
   *
   * Carried so the live stock position can be joined on it. The SKU is the
   * grouping key because it is what both sides share, but stock is keyed on the
   * item, and the ERP has more than one SKU record pointing at the same item.
   */
  readonly erpItemId: string | null;
  /**
   * The marketplace's identifiers for this product.
   *
   * Kept through the grouping because the report is read by people who have the
   * marketplace's own screens open next to it, and the EAN is how they find the
   * row. Null when only the ERP side contributed.
   */
  readonly ean: string | null;
  readonly marketplaceItemId: string | null;
  readonly productName: string;
  readonly status: SkuMatchStatus;
  readonly erpOrders: number;
  readonly erpLines: number;
  readonly erpQuantity: number;
  readonly erpRevenue: number;
  readonly excelRows: number;
  readonly excelQuantity: number;
  readonly excelRevenue: number;
  /** Excel minus ERP. Positive means the marketplace claims more than the ERP. */
  readonly quantityVariance: number;
  readonly amountVariance: number;
  /** Variance as a share of the ERP figure. Null when the ERP has nothing. */
  readonly quantityVariancePct: number | null;
  readonly amountVariancePct: number | null;
  /** Whether the Excel side reached this SKU through the ERP catalogue. */
  readonly mappedToErp: boolean;
  readonly erpOrderRefs: SkuErpOrderRef[];
  readonly excelRowRefs: SkuExcelRowRef[];
}

export interface SkuReconciliationResult {
  readonly rows: SkuReconciliationRow[];
  readonly counts: {
    readonly skusMatched: number;
    readonly skusWithVariance: number;
    readonly skusExcelOnly: number;
    readonly skusErpOnly: number;
  };
  readonly totals: {
    readonly erpQuantity: number;
    readonly excelQuantity: number;
    readonly erpRevenue: number;
    readonly excelRevenue: number;
    readonly quantityVariance: number;
    readonly amountVariance: number;
  };
}

/** Folds a SKU for comparison. Case and surrounding space are noise. */
function foldSku(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const folded = value.trim().toUpperCase();
  return folded || null;
}

interface Bucket {
  displayName: string;
  erpItemId: string | null;
  ean: string | null;
  marketplaceItemId: string | null;
  erpOrders: Map<string, SkuErpOrderRef>;
  erpLines: number;
  erpQuantity: number;
  erpRevenue: number;
  /** Capped listing for the detail panel. */
  excelRows: SkuExcelRowRef[];
  /** Every contributing row, including the ones the listing dropped. */
  excelRowCount: number;
  excelQuantity: number;
  excelRevenue: number;
  mappedToErp: boolean;
}

function emptyBucket(displayName: string): Bucket {
  return {
    displayName,
    erpItemId: null,
    ean: null,
    marketplaceItemId: null,
    erpOrders: new Map(),
    erpLines: 0,
    erpQuantity: 0,
    erpRevenue: 0,
    excelRows: [],
    excelRowCount: 0,
    excelQuantity: 0,
    excelRevenue: 0,
    mappedToErp: false,
  };
}

export interface SkuReconcileOptions {
  /** Only count ERP lines whose order status is business. On by default. */
  readonly reportableOnly?: boolean;
  /**
   * How many contributing rows to keep per SKU for the detail view.
   *
   * Capped because a month of Blinkit puts twelve hundred spreadsheet rows
   * behind a single product, and shipping all of them to the browser to render
   * a detail panel nobody scrolls to the end of is a megabyte for nothing. The
   * totals stay exact; only the listing is truncated.
   */
  readonly detailLimit?: number;
}

/** Either a plain row, or one already resolved to an ERP SKU. */
export type ReconcilableExcelRow = NormalizedExcelRow | MappedExcelRow;

function asMapped(entry: ReconcilableExcelRow): MappedExcelRow {
  if ("row" in entry && "mapping" in entry) return entry;
  const row = entry as NormalizedExcelRow;
  // No mapping pass was run, so the row's own identifier is the best key there
  // is. `keyIsErpSku` is false, which is what stops the report from claiming
  // the row reached the ERP catalogue when it never looked.
  const key = foldSku(row.sku) ?? foldSku(row.barcode) ?? null;
  return {
    row,
    mapping: {
      status: key ? "ambiguous" : "unmapped",
      route: null,
      item: null,
      candidates: [],
      reason: key
        ? "No catalogue mapping was attempted for this row."
        : "The row carries no identifier.",
    },
    key: key ?? "(unidentified)",
    keyIsErpSku: false,
  };
}

/**
 * Aggregates both sides by SKU and compares them.
 *
 * A SKU present on only one side is reported as `excelOnly` or `erpOnly` rather
 * than dropped — those are the two most actionable outcomes in the whole report,
 * since one means the ERP is missing sales and the other means the marketplace
 * file is.
 */
export function reconcileBySku(
  excelRows: ReadonlyArray<ReconcilableExcelRow>,
  erpLines: ReadonlyArray<SalesOrderLine>,
  options?: SkuReconcileOptions,
): SkuReconciliationResult {
  const reportableOnly = options?.reportableOnly ?? true;
  const detailLimit = options?.detailLimit ?? 50;
  const buckets = new Map<string, Bucket>();

  for (const line of erpLines) {
    if (reportableOnly && !isReportableStatus(line.status)) continue;
    const sku = foldSku(line.sku);
    if (!sku) continue;

    const bucket = buckets.get(sku) ?? emptyBucket(line.name);
    const quantity = reportedQuantity(line);

    const order = bucket.erpOrders.get(line.salesOrderId) ?? {
      salesOrderId: line.salesOrderId,
      soNumber: line.soNumber,
      orderDate: line.orderDate,
      status: line.status,
      quantity: 0,
      amount: 0,
    };
    bucket.erpOrders.set(line.salesOrderId, {
      ...order,
      quantity: order.quantity + quantity,
      amount: order.amount + line.lineTotal,
    });

    bucket.erpItemId = bucket.erpItemId ?? line.itemId;
    bucket.erpLines += 1;
    bucket.erpQuantity += quantity;
    bucket.erpRevenue += line.lineTotal;
    buckets.set(sku, bucket);
  }

  for (const entry of excelRows) {
    const mapped = asMapped(entry);
    const sku = foldSku(mapped.key);
    if (!sku || sku === "(UNIDENTIFIED)") continue;

    const bucket =
      buckets.get(sku) ?? emptyBucket(mapped.row.productName ?? mapped.mapping.item?.name ?? sku);

    if (bucket.excelRows.length < detailLimit) {
      bucket.excelRows.push({
        sourceRow: mapped.row.sourceRow,
        orderDate: mapped.row.orderDate,
        productName: mapped.row.productName,
        quantity: mapped.row.quantity,
        amount: mapped.row.grossSales,
      });
    }

    // An Excel-only SKU still has an item id when a confirmed or inferred
    // mapping produced it, which is what lets its stock position be shown.
    bucket.erpItemId = bucket.erpItemId ?? mapped.mapping.item?.itemId ?? null;
    bucket.ean = bucket.ean ?? mapped.row.barcode ?? null;
    bucket.marketplaceItemId =
      bucket.marketplaceItemId ?? mapped.row.marketplaceItemId ?? null;
    bucket.excelQuantity += mapped.row.quantity ?? 0;
    bucket.excelRevenue += mapped.row.grossSales ?? 0;
    // Tracked separately from the row count because the detail list is capped.
    bucket.excelRowCount += 1;
    if (mapped.keyIsErpSku) bucket.mappedToErp = true;
    buckets.set(sku, bucket);
  }

  const rows: SkuReconciliationRow[] = [...buckets.entries()].map(([sku, bucket]) => {
    const excelRowCount = bucket.excelRowCount;
    const quantityVariance = bucket.excelQuantity - bucket.erpQuantity;
    const amountVariance = bucket.excelRevenue - bucket.erpRevenue;

    const bothSides = bucket.erpLines > 0 && excelRowCount > 0;
    const status: SkuMatchStatus = bothSides
      ? quantityVariance === 0 && amountVariance === 0
        ? "matched"
        : "variance"
      : excelRowCount > 0
        ? "excelOnly"
        : "erpOnly";

    return {
      sku,
      erpItemId: bucket.erpItemId,
      ean: bucket.ean,
      marketplaceItemId: bucket.marketplaceItemId,
      productName: bucket.displayName,
      status,
      erpOrders: bucket.erpOrders.size,
      erpLines: bucket.erpLines,
      erpQuantity: bucket.erpQuantity,
      erpRevenue: bucket.erpRevenue,
      excelRows: excelRowCount,
      excelQuantity: bucket.excelQuantity,
      excelRevenue: bucket.excelRevenue,
      quantityVariance,
      amountVariance,
      // Null rather than Infinity when the ERP has nothing to compare against.
      quantityVariancePct:
        bucket.erpQuantity !== 0 ? quantityVariance / bucket.erpQuantity : null,
      amountVariancePct:
        bucket.erpRevenue !== 0 ? amountVariance / bucket.erpRevenue : null,
      mappedToErp: bucket.mappedToErp,
      erpOrderRefs: [...bucket.erpOrders.values()].sort((a, b) =>
        a.orderDate.localeCompare(b.orderDate),
      ),
      excelRowRefs: bucket.excelRows,
    };
  });

  // Largest absolute quantity variance first — the rows most worth explaining.
  rows.sort((a, b) => Math.abs(b.quantityVariance) - Math.abs(a.quantityVariance));

  const totals = rows.reduce(
    (acc, row) => ({
      erpQuantity: acc.erpQuantity + row.erpQuantity,
      excelQuantity: acc.excelQuantity + row.excelQuantity,
      erpRevenue: acc.erpRevenue + row.erpRevenue,
      excelRevenue: acc.excelRevenue + row.excelRevenue,
      quantityVariance: acc.quantityVariance + row.quantityVariance,
      amountVariance: acc.amountVariance + row.amountVariance,
    }),
    {
      erpQuantity: 0,
      excelQuantity: 0,
      erpRevenue: 0,
      excelRevenue: 0,
      quantityVariance: 0,
      amountVariance: 0,
    },
  );

  return {
    rows,
    counts: {
      skusMatched: rows.filter((row) => row.status === "matched").length,
      skusWithVariance: rows.filter((row) => row.status === "variance").length,
      skusExcelOnly: rows.filter((row) => row.status === "excelOnly").length,
      skusErpOnly: rows.filter((row) => row.status === "erpOnly").length,
    },
    totals,
  };
}

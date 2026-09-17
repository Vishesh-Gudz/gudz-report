import type { SalesOrderLine } from "../../types/erp";
import type { NormalizedExcelRow } from "../../types/excel";
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
 * mistake would be forcing a line-to-line join that the data cannot support.
 * Both sides are therefore aggregated by SKU and compared in totals, which is
 * also the question a client asks: "we sold 14,978 of this — does the ERP
 * agree?"
 *
 * Line-level matching is kept for the cases where it genuinely works (a shared
 * marketplace item id), and its ambiguity is reported rather than hidden.
 */

export type SkuMatchStatus =
  | "matched"
  | "excelOnly"
  | "erpOnly";

export interface SkuReconciliationRow {
  readonly sku: string;
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
  /** Variance as a share of the ERP quantity, for sorting by materiality. */
  readonly quantityVariancePct: number | null;
}

export interface SkuReconciliationResult {
  readonly rows: SkuReconciliationRow[];
  readonly counts: {
    readonly skusMatched: number;
    readonly skusExcelOnly: number;
    readonly skusErpOnly: number;
    readonly skusWithVariance: number;
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
  erpOrders: Set<string>;
  erpLines: number;
  erpQuantity: number;
  erpRevenue: number;
  excelRows: number;
  excelQuantity: number;
  excelRevenue: number;
}

function emptyBucket(displayName: string): Bucket {
  return {
    displayName,
    erpOrders: new Set(),
    erpLines: 0,
    erpQuantity: 0,
    erpRevenue: 0,
    excelRows: 0,
    excelQuantity: 0,
    excelRevenue: 0,
  };
}

export interface SkuReconcileOptions {
  /** Only count ERP lines whose order status is business. On by default. */
  readonly reportableOnly?: boolean;
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
  excelRows: ReadonlyArray<NormalizedExcelRow>,
  erpLines: ReadonlyArray<SalesOrderLine>,
  options?: SkuReconcileOptions,
): SkuReconciliationResult {
  const reportableOnly = options?.reportableOnly ?? true;
  const buckets = new Map<string, Bucket>();

  for (const line of erpLines) {
    if (reportableOnly && !isReportableStatus(line.status)) continue;
    const sku = foldSku(line.sku);
    if (!sku) continue;

    const bucket = buckets.get(sku) ?? emptyBucket(line.name);
    bucket.erpOrders.add(line.salesOrderId);
    bucket.erpLines += 1;
    bucket.erpQuantity += reportedQuantity(line);
    bucket.erpRevenue += line.lineTotal;
    buckets.set(sku, bucket);
  }

  for (const row of excelRows) {
    // Barcode is accepted as a fallback identifier because some marketplace
    // exports key on it rather than on a seller SKU.
    const sku = foldSku(row.sku) ?? foldSku(row.barcode);
    if (!sku) continue;

    const bucket =
      buckets.get(sku) ?? emptyBucket(row.productName ?? sku);
    bucket.excelRows += 1;
    bucket.excelQuantity += row.quantity ?? 0;
    bucket.excelRevenue += row.grossSales ?? 0;
    buckets.set(sku, bucket);
  }

  const rows: SkuReconciliationRow[] = [...buckets.entries()].map(([sku, bucket]) => {
    const status: SkuMatchStatus =
      bucket.erpLines > 0 && bucket.excelRows > 0
        ? "matched"
        : bucket.excelRows > 0
          ? "excelOnly"
          : "erpOnly";

    const quantityVariance = bucket.excelQuantity - bucket.erpQuantity;

    return {
      sku,
      productName: bucket.displayName,
      status,
      erpOrders: bucket.erpOrders.size,
      erpLines: bucket.erpLines,
      erpQuantity: bucket.erpQuantity,
      erpRevenue: bucket.erpRevenue,
      excelRows: bucket.excelRows,
      excelQuantity: bucket.excelQuantity,
      excelRevenue: bucket.excelRevenue,
      quantityVariance,
      amountVariance: bucket.excelRevenue - bucket.erpRevenue,
      // Undefined rather than Infinity when the ERP has nothing to compare to.
      quantityVariancePct:
        bucket.erpQuantity > 0 ? quantityVariance / bucket.erpQuantity : null,
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
      skusExcelOnly: rows.filter((row) => row.status === "excelOnly").length,
      skusErpOnly: rows.filter((row) => row.status === "erpOnly").length,
      skusWithVariance: rows.filter(
        (row) => row.quantityVariance !== 0 || row.amountVariance !== 0,
      ).length,
    },
    totals,
  };
}

import type { NormalizedExcelRow } from "../../types/excel";

/**
 * Collapsing a parsed sheet to the few thousand records worth transmitting.
 *
 * The workbook is ~203,000 rows and ten megabytes. Neither number can cross a
 * network boundary here: a Vercel function refuses a body over 4.5 MB, and a
 * Convex Node action runs out of its 512 MB ceiling parsing the file. So the
 * browser — the one machine in the chain with real memory and no request limit
 * — parses the workbook and reduces it, and only the reduction is sent.
 *
 * WHY THIS IS THE SAME ANSWER
 * ---------------------------
 * The reduction is not a summary. `mapExcelRows` already caches its result on
 * exactly `(barcode, sku, marketplaceItemId, productName)` — four fields it
 * treats as a product's whole identity — and `aggregateMonthly` then groups by
 * the mapping outcome and month, summing quantity and value. Grouping on those
 * same four fields plus the month is therefore the finest grouping either step
 * can distinguish. Mapping one record stands for mapping every row behind it,
 * and a sum of partial sums is the sum.
 *
 * What this is NOT is an aggregation by product. Two listings that resolve to
 * one ERP SKU stay separate here, because the resolution has not happened yet.
 * They merge downstream exactly as they always did.
 *
 * `sourceRows` carries the original row count through, so the report keeps
 * reporting how many spreadsheet rows a figure came from rather than how many
 * records survived the reduction.
 */

/** One marketplace product, in one month, as the sheet reported it. */
export interface CompactSalesRecord {
  /** `YYYY-MM`, or null for rows whose date could not be read. */
  readonly month: string | null;
  readonly barcode: string | null;
  readonly sku: string | null;
  readonly marketplaceItemId: string | null;
  readonly productName: string | null;
  readonly salesQuantity: number;
  readonly salesValue: number;
  /** Spreadsheet rows behind this record. Never the number of records. */
  readonly sourceRows: number;
}

/** A reduced sheet, plus the facts the report needs that survive reduction. */
export interface CompactSheet {
  readonly sheet: string;
  readonly marketplace: string;
  readonly records: CompactSalesRecord[];
  /** Rows the sheet actually had, before reduction. */
  readonly sourceRowCount: number;
  /** `YYYY-MM-DD`, from the sheet's own dates. Drives the ERP period. */
  readonly minDate: string | null;
  readonly maxDate: string | null;
}

function keyOf(row: NormalizedExcelRow, month: string | null): string {
  // The separator is a character no identifier uses, so two different products
  // cannot collide by concatenation.
  return [
    month ?? "",
    row.barcode ?? "",
    row.sku ?? "",
    row.marketplaceItemId ?? "",
    row.productName ?? "",
  ].join("\u0000");
}

function monthOf(orderDate: string | null): string | null {
  if (!orderDate || orderDate.length < 7) return null;
  return orderDate.slice(0, 7);
}

/**
 * Reduces normalised rows to one record per product-month.
 *
 * Status is deliberately not part of the key and not filtered on, because
 * `aggregateMonthly` does not filter on it either — every row counts toward the
 * marketplace's reported sales. Introducing a filter here would quietly change
 * what the report means.
 */
export function compactRows(
  rows: ReadonlyArray<NormalizedExcelRow>,
): CompactSalesRecord[] {
  const buckets = new Map<
    string,
    {
      month: string | null;
      barcode: string | null;
      sku: string | null;
      marketplaceItemId: string | null;
      productName: string | null;
      salesQuantity: number;
      salesValue: number;
      sourceRows: number;
    }
  >();

  for (const row of rows) {
    const month = monthOf(row.orderDate);
    const key = keyOf(row, month);
    const quantity = row.quantity ?? 0;
    const value = row.grossSales ?? 0;

    const existing = buckets.get(key);
    if (existing) {
      existing.salesQuantity += quantity;
      existing.salesValue += value;
      existing.sourceRows += 1;
      continue;
    }

    buckets.set(key, {
      month,
      barcode: row.barcode,
      sku: row.sku,
      marketplaceItemId: row.marketplaceItemId,
      productName: row.productName,
      salesQuantity: quantity,
      salesValue: value,
      sourceRows: 1,
    });
  }

  return [...buckets.values()];
}

/**
 * Rebuilds a row-shaped value for one compact record.
 *
 * `mapExcelRows` and `aggregateMonthly` both take normalised rows, and both are
 * business logic that should not be forked for a second caller. So the record is
 * presented back to them as a row: same identity fields, quantity and value
 * carrying the record's totals, and a date inside the record's month so the
 * month derives exactly as it did from the original row.
 *
 * `sourceRow` is 0 — these never point back at one spreadsheet line, and a
 * plausible-looking line number would be a lie. The honest count travels
 * separately in `sourceRows`.
 */
export function rowForRecord(record: CompactSalesRecord): NormalizedExcelRow {
  return {
    sourceRow: 1,
    orderDate: record.month ? `${record.month}-01` : null,
    marketplaceOrderId: null,
    marketplaceItemId: record.marketplaceItemId,
    sku: record.sku,
    barcode: record.barcode,
    productName: record.productName,
    quantity: record.salesQuantity,
    unitPrice: null,
    grossSales: record.salesValue,
    rawStatus: null,
    // Every row counted toward sales before the reduction, and the aggregate
    // does not read this field. `delivered` is the only value that does not
    // misdescribe a figure that is already a total.
    normalizedStatus: "delivered",
  };
}

/** Spreadsheet rows behind a reduced sheet, for reporting and for assertions. */
export function totalSourceRows(
  records: ReadonlyArray<CompactSalesRecord>,
): number {
  return records.reduce((total, record) => total + record.sourceRows, 0);
}

import {
  reportingPeriodFromDays,
  type ReportingPeriod,
} from "../dates/reporting-period";
import type {
  ColumnMapping,
  ExcelRowError,
  ImportStatistics,
  NormalizationResult,
  NormalizedExcelRow,
  ParsedWorkbook,
} from "../../types/excel";
import { suggestHeader } from "./parser";
import {
  normalizeStatus,
  toCalendarDate,
  toNumber,
  toText,
  validateMapping,
} from "./validation";

/**
 * Turns parsed cells into the normalized rows everything downstream reads.
 *
 * The parser knows about workbooks; this knows about the report. In between sits
 * a `ColumnMapping` the caller supplies, which is the only place a marketplace's
 * column names appear — so supporting a new file format is a new mapping, not a
 * new code path.
 *
 * A row that cannot be normalized is **reported, not dropped**. An import that
 * quietly discards a tenth of its rows still says "completed", and the missing
 * revenue surfaces later as an unexplained variance.
 */

export class ExcelNormalizationError extends Error {
  readonly problems: ReadonlyArray<{ field: string; message: string }>;

  constructor(message: string, problems: ReadonlyArray<{ field: string; message: string }>) {
    super(message);
    this.name = "ExcelNormalizationError";
    this.problems = problems;
  }
}

/**
 * Header names commonly used for each field, for the mapping screen to pre-fill.
 *
 * Suggestions only. The real Healthy Master / Blinkit workbook has not been
 * inspected, so nothing here is treated as known — a wrong guess that is
 * confirmed by a human is fine, a wrong guess applied silently is not.
 */
export const HEADER_CANDIDATES: Readonly<Record<keyof ColumnMapping, string[]>> = {
  orderDate: ["order date", "date", "order_date", "created at", "invoice date"],
  marketplaceOrderId: ["order id", "order_id", "order no", "order number"],
  marketplaceItemId: ["item id", "item_id", "line id", "listing id"],
  sku: ["sku", "seller sku", "sku code", "item sku", "product sku"],
  barcode: ["barcode", "ean", "upc", "gtin"],
  productName: ["product name", "item name", "product", "title", "description"],
  quantity: ["quantity", "qty", "units", "qty sold", "quantity sold"],
  unitPrice: ["unit price", "price", "rate", "mrp", "selling price"],
  grossSales: ["gross sales", "amount", "total", "line total", "net sales", "revenue"],
  status: ["status", "order status", "state", "fulfilment status", "fulfillment status"],
};

/** Best-effort mapping from a sheet's headers, for a human to confirm. */
export function suggestColumnMapping(headers: ReadonlyArray<string>): ColumnMapping {
  const mapping: Record<string, string | undefined> = {};
  for (const [field, candidates] of Object.entries(HEADER_CANDIDATES)) {
    const header = suggestHeader(headers, candidates);
    if (header) mapping[field] = header;
  }
  return mapping as ColumnMapping;
}

function readCell(row: Record<string, unknown>, header: string | undefined): unknown {
  if (!header) return null;
  return row[header] ?? null;
}

export interface NormalizeOptions {
  /**
   * Drop rows whose every mapped field is empty.
   *
   * Exports routinely carry trailing blank rows and totals separators; counting
   * those as invalid would make every import look broken. Genuinely malformed
   * rows are still reported.
   */
  readonly skipEmptyRows?: boolean;
}

/**
 * Normalizes a parsed workbook.
 *
 * Throws only when the *mapping* is unusable — a sheet that cannot produce a
 * date or a product identifier cannot produce a report, and failing at that
 * point is far cheaper than failing per row for every row.
 */
export function normalizeWorkbook(
  workbook: ParsedWorkbook,
  mapping: ColumnMapping,
  options?: NormalizeOptions,
): NormalizationResult {
  const problems = validateMapping(mapping, workbook.headers);
  if (problems.length > 0) {
    throw new ExcelNormalizationError(
      `Column mapping cannot be used: ${problems.map((p) => `${p.field} — ${p.message}`).join(" ")}`,
      problems,
    );
  }

  const skipEmpty = options?.skipEmptyRows ?? true;
  const rows: NormalizedExcelRow[] = [];
  const errors: ExcelRowError[] = [];
  const days: string[] = [];

  workbook.rows.forEach((raw, index) => {
    // +1 for the header, +1 to be 1-based: what the user sees in Excel.
    const sourceRow = index + 2;

    const orderDateCell = readCell(raw, mapping.orderDate);
    const skuCell = readCell(raw, mapping.sku);
    const barcodeCell = readCell(raw, mapping.barcode);
    const marketplaceItemIdCell = readCell(raw, mapping.marketplaceItemId);
    const quantityCell = readCell(raw, mapping.quantity);
    const grossSalesCell = readCell(raw, mapping.grossSales);

    const isEmpty =
      toText(orderDateCell) === null &&
      toText(skuCell) === null &&
      toText(barcodeCell) === null &&
      toText(marketplaceItemIdCell) === null &&
      toNumber(quantityCell) === null &&
      toNumber(grossSalesCell) === null;

    if (isEmpty) {
      if (!skipEmpty) {
        errors.push({ sourceRow, field: "(row)", message: "Row is empty." });
      }
      return;
    }

    const orderDate = toCalendarDate(orderDateCell);
    if (mapping.orderDate && orderDate === null) {
      errors.push({
        sourceRow,
        field: "orderDate",
        message:
          "Could not read a date. Accepted: a real Excel date cell, YYYY-MM-DD, or YYYY/MM/DD. " +
          "Ambiguous text like 03/04/2026 is refused rather than guessed.",
      });
    }

    const sku = toText(skuCell);
    const barcode = toText(barcodeCell);
    const marketplaceItemId = toText(marketplaceItemIdCell);
    if (!sku && !barcode && !marketplaceItemId) {
      errors.push({
        sourceRow,
        field: "sku",
        message: "No product identifier on this row — nothing to match an ERP line against.",
      });
    }

    const row: NormalizedExcelRow = {
      sourceRow,
      orderDate,
      marketplaceOrderId: toText(readCell(raw, mapping.marketplaceOrderId)),
      marketplaceItemId,
      sku,
      barcode,
      productName: toText(readCell(raw, mapping.productName)),
      quantity: toNumber(quantityCell),
      unitPrice: toNumber(readCell(raw, mapping.unitPrice)),
      grossSales: toNumber(grossSalesCell),
      rawStatus: toText(readCell(raw, mapping.status)),
      normalizedStatus: normalizeStatus(readCell(raw, mapping.status)),
    };

    rows.push(row);
    if (orderDate) days.push(orderDate);
  });

  days.sort();
  const invalidRowNumbers = new Set(errors.map((error) => error.sourceRow));

  const statistics: ImportStatistics = {
    totalRows: rows.length,
    validRows: rows.length - invalidRowNumbers.size,
    invalidRows: invalidRowNumbers.size,
    minDate: days[0] ?? null,
    maxDate: days[days.length - 1] ?? null,
  };

  return { rows, errors, statistics };
}

/**
 * The reporting period an import covers.
 *
 * Null when no row carried a usable date. That is a refusal, not a default: an
 * import with no period would otherwise be reconciled against an ERP window
 * somebody invented.
 */
export function periodFromStatistics(
  statistics: ImportStatistics,
): ReportingPeriod | null {
  if (!statistics.minDate || !statistics.maxDate) return null;
  return reportingPeriodFromDays(statistics.minDate, statistics.maxDate);
}

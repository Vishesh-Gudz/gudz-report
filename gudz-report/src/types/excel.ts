import { z } from "zod";

/**
 * The shape a marketplace spreadsheet is reduced to before anything else
 * touches it.
 *
 * The rule this file exists to enforce: **the raw workbook is never the data
 * model.** A marketplace export is wide, inconsistently named and changes
 * between releases. Persisting it verbatim would mean every consumer re-derives
 * meaning from column headers, and a header rename would break all of them at
 * once. Everything downstream reads this normalized row instead.
 *
 * Every field except the identity ones is nullable, because real files omit
 * them. A parser that demanded a barcode would reject files that are perfectly
 * reconcilable by SKU.
 */

/**
 * Whether a marketplace line counts toward the reconciliation.
 *
 * Marketplace files use dozens of status strings; they collapse to these three
 * questions: did it count as a sale, was it reversed, or do we not yet know.
 * `unknown` is deliberate — mapping an unrecognised status to `delivered` would
 * silently inflate reconciled revenue.
 */
export const NORMALIZED_ROW_STATUSES = [
  "delivered",
  "returned",
  "cancelled",
  "unknown",
] as const;
export type NormalizedRowStatus = (typeof NORMALIZED_ROW_STATUSES)[number];

export const normalizedExcelRowSchema = z.object({
  /** 1-based row number in the source sheet, for pointing a human back at it. */
  sourceRow: z.number().int().positive(),
  /** `YYYY-MM-DD`, UTC. The axis the ERP period is derived from. */
  orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  marketplaceOrderId: z.string().nullable(),
  marketplaceItemId: z.string().nullable(),
  sku: z.string().nullable(),
  barcode: z.string().nullable(),
  productName: z.string().nullable(),
  quantity: z.number().nullable(),
  unitPrice: z.number().nullable(),
  grossSales: z.number().nullable(),
  /** Exactly what the sheet said, kept so a mapping decision can be audited. */
  rawStatus: z.string().nullable(),
  normalizedStatus: z.enum(NORMALIZED_ROW_STATUSES),
});

export type NormalizedExcelRow = z.infer<typeof normalizedExcelRowSchema>;

/** A row that could not be normalized, and why. */
export interface ExcelRowError {
  readonly sourceRow: number;
  readonly field: string;
  readonly message: string;
}

export interface ParsedSheet {
  readonly name: string;
  readonly headers: string[];
  readonly rowCount: number;
}

/** What a parse produced, before normalization. */
export interface ParsedWorkbook {
  readonly sheetNames: string[];
  readonly selectedSheet: string;
  readonly headers: string[];
  /** Header-keyed cells. Values stay as SheetJS produced them. */
  readonly rows: ReadonlyArray<Record<string, unknown>>;
  readonly sheets: ParsedSheet[];
}

export interface ImportStatistics {
  readonly totalRows: number;
  readonly validRows: number;
  readonly invalidRows: number;
  /** Null when no row carried a usable date — the file cannot set a period. */
  readonly minDate: string | null;
  readonly maxDate: string | null;
}

export interface NormalizationResult {
  readonly rows: NormalizedExcelRow[];
  readonly errors: ExcelRowError[];
  readonly statistics: ImportStatistics;
}

/**
 * Maps sheet headers onto normalized fields.
 *
 * Left open on purpose. The real Healthy Master / Blinkit workbook has not been
 * inspected yet, and inventing its column names now would bake a guess into the
 * data model. A concrete mapping is supplied at parse time; this type is the
 * contract it has to satisfy.
 */
export interface ColumnMapping {
  readonly orderDate?: string;
  readonly marketplaceOrderId?: string;
  readonly marketplaceItemId?: string;
  readonly sku?: string;
  readonly barcode?: string;
  readonly productName?: string;
  readonly quantity?: string;
  readonly unitPrice?: string;
  readonly grossSales?: string;
  readonly status?: string;
}

export const IMPORT_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed",
] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

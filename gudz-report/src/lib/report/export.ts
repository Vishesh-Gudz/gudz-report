import type { SnapshotRow } from "./snapshot-model";
import {
  CURRENT_SOH,
  DAMAGE,
  DISPATCH,
  GRN,
  MAPPING_LABELS,
  RETURNED,
  SALES_QUANTITY,
} from "./vocabulary";

/**
 * The downloadable report.
 *
 * One definition, used by both formats. CSV and XLSX built separately would
 * drift — a column added to one, a rounding rule changed in the other — and the
 * two files would quietly disagree about the same report.
 *
 * Every value comes from the saved snapshot. The uploaded workbook is not read
 * again; it no longer exists by this point, which is the strongest possible
 * guarantee that an export matches what was on screen.
 *
 * A missing figure exports as an em dash for the same reason it displays as one.
 * A blank cell would read as zero in a spreadsheet, and zero is a claim: that
 * the register was checked and genuinely held nothing.
 */

export const EXPORT_COLUMNS = [
  "Marketplace",
  "Product",
  "SKU",
  "EAN",
  "Month",
  CURRENT_SOH.label,
  DISPATCH.label,
  GRN.label,
  SALES_QUANTITY.label,
  "Sales Value",
  DAMAGE.label,
  RETURNED.label,
  "Status",
] as const;

/** What an absent figure looks like in a downloaded file. */
export const ABSENT = "—";

export type ExportCell = string | number;

/** `2026-06` as `Jun 2026`, matching the screen rather than the storage key. */
function monthLabel(month: string): string {
  if (month === "undated") return "Undated";
  const date = new Date(`${month}-01T00:00:00.000Z`);
  return Number.isNaN(date.getTime())
    ? month
    : date.toLocaleDateString("en-GB", {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
}

export function exportRow(row: SnapshotRow): ExportCell[] {
  return [
    row.marketplace,
    row.productName,
    row.sku,
    row.ean ?? ABSENT,
    monthLabel(row.month),
    row.currentSoh ?? ABSENT,
    // Absent as well as null: a snapshot saved before Dispatch existed has no
    // field here, and it reads as a dash rather than as a zero.
    row.dispatch ?? ABSENT,
    // Null, not zero: no customer GRN has been raised for this product.
    row.grn ?? ABSENT,
    row.salesQuantity,
    Math.round(row.salesValue),
    row.damage,
    row.returned,
    MAPPING_LABELS[row.mappingStatus],
  ];
}

/** Header plus every row, in the order the table shows them. */
export function buildExport(rows: ReadonlyArray<SnapshotRow>): ExportCell[][] {
  return [[...EXPORT_COLUMNS], ...rows.map(exportRow)];
}

function csvCell(value: ExportCell): string {
  const text = String(value);
  // Quotes and separators inside a product name are what turn one column into
  // three; a leading `=` is what turns a name into a formula.
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(rows: ReadonlyArray<SnapshotRow>): string {
  return buildExport(rows)
    .map((line) => line.map(csvCell).join(","))
    .join("\r\n");
}

/** A file name that says what the report is without needing the page open. */
export function exportFileName(
  marketplaceLabel: string,
  periodStart: string | null,
  createdAt: number,
  extension: "csv" | "xlsx",
): string {
  const slug = marketplaceLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const when = periodStart ?? new Date(createdAt).toISOString().slice(0, 10);
  return `soh-report-${slug}-${when}.${extension}`;
}

import type { SnapshotRow, SnapshotView } from "./snapshot-model";
import { ABSENT, EXPORT_COLUMNS, exportRow } from "./export";
import { CURRENT_SOH, DISPATCH, GRN, SALES_QUANTITY } from "./vocabulary";

/**
 * The downloadable workbook.
 *
 * Three sheets, because a spreadsheet that leaves the building has to explain
 * itself: the report, the totals with a short note on what each column means,
 * and what the report could and could not establish. Somebody opening this in
 * Excel a month from now has no dashboard to consult.
 *
 * Every value comes from the saved snapshot — the same rows the table renders,
 * never recomputed. The uploaded workbook is long gone by this point, which is
 * the strongest guarantee that a download matches the screen.
 *
 * A note on formatting: SheetJS's community build writes column widths, frozen
 * panes, autofilters, merges and number formats, and silently drops cell styles
 * — bold, fills, borders. So the polish here is structural rather than
 * cosmetic. Claiming a styled header and shipping an unstyled one would be
 * worse than the plain version.
 */

/** Cells are values, or a dash where the source genuinely holds nothing. */
type Cell = string | number;

export type ExportScope = "current" | "full";

const QUANTITY_FORMAT = "#,##0";
/** Indian digit grouping, which is what every other figure in the app uses. */
const CURRENCY_FORMAT = '"₹"#,##,##0';

function dayLabel(day: string | null): string {
  if (!day) return ABSENT;
  const date = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(date.getTime())
    ? day
    : date.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
}

export function marketplaceLabel(snapshot: SnapshotView): string {
  if (snapshot.marketplaces.length === 1) return snapshot.marketplaces[0]!;
  return "All Marketplaces";
}

function periodLabel(snapshot: SnapshotView): string {
  if (snapshot.periodStart && snapshot.periodEnd) {
    return `${dayLabel(snapshot.periodStart)} – ${dayLabel(snapshot.periodEnd)}`;
  }
  return snapshot.periodsDiffer ? "Multiple reporting periods" : ABSENT;
}

/**
 * A professional file name: who, what, which marketplace, which months.
 *
 * Readable in a downloads folder six weeks later, which `export.xlsx` is not.
 */
export function workbookFileName(
  snapshot: SnapshotView,
  extension: "xlsx" | "csv",
  scope: ExportScope = "full",
): string {
  const parts = [
    "Healthy-Master-SOH",
    marketplaceLabel(snapshot).replace(/\s+/g, "-"),
  ];

  if (snapshot.periodStart && snapshot.periodEnd) {
    const from = new Date(`${snapshot.periodStart}T00:00:00.000Z`);
    const to = new Date(`${snapshot.periodEnd}T00:00:00.000Z`);
    const fmt = (date: Date) =>
      date.toLocaleDateString("en-GB", {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).replace(" ", "-");
    parts.push(fmt(from), fmt(to));
  } else {
    parts.push(new Date(snapshot.createdAt).toISOString().slice(0, 10));
  }

  if (scope === "current") parts.push("filtered");

  return `${parts.join("-")}.${extension}`;
}

/** The report table, with its title block above it. */
function reportSheetRows(
  snapshot: SnapshotView,
  rows: ReadonlyArray<SnapshotRow>,
  scope: ExportScope,
): Cell[][] {
  const generated = new Date(snapshot.createdAt).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const head: Cell[][] = [
    ["Healthy Master"],
    ["SOH Report"],
    [],
    ["Marketplace", marketplaceLabel(snapshot)],
    ["Reporting Period", periodLabel(snapshot)],
    ["Generated", generated],
    ["Source", snapshot.sourceFileName],
  ];

  if (scope === "current") {
    head.push(["Scope", "Filtered view — not the whole report"]);
  }

  head.push([], [...EXPORT_COLUMNS]);

  // Built by `exportRow`, the same function the CSV uses. This block used to
  // list the cells itself, which is how the workbook silently shipped a header
  // with a Dispatch column and rows without one — every figure after Current SOH
  // sat under the wrong heading.
  for (const row of rows) head.push(exportRow(row));

  return head;
}

/** Where the table's header sits, so the sheet can freeze and filter on it. */
function headerRowIndex(scope: ExportScope): number {
  return scope === "current" ? 9 : 8;
}

function summarySheetRows(
  snapshot: SnapshotView,
  rows: ReadonlyArray<SnapshotRow>,
): Cell[][] {
  // Totals are computed from the rows being exported, not from the snapshot's
  // stored summary, so a filtered export totals what it contains.
  const stockSeen = new Set<string>();
  const products = new Set<string>();
  let currentSoh: number | null = null;
  let dispatch: number | null = null;
  let grn: number | null = null;
  let salesQuantity = 0;
  let salesValue = 0;
  let damage = 0;
  let returned = 0;

  for (const row of rows) {
    products.add(`${row.marketplace}::${row.sku}`);
    if (row.erpItemId && row.currentSoh !== null && !stockSeen.has(row.erpItemId)) {
      stockSeen.add(row.erpItemId);
      currentSoh = (currentSoh ?? 0) + row.currentSoh;
    }
    if (row.dispatch !== null && row.dispatch !== undefined) {
      dispatch = (dispatch ?? 0) + row.dispatch;
    }
    if (row.grn !== null) grn = (grn ?? 0) + row.grn;
    salesQuantity += row.salesQuantity;
    salesValue += row.salesValue;
    damage += row.damage;
    returned += row.returned;
  }

  const out: Cell[][] = [
    ["Healthy Master"],
    ["SOH Report"],
    [],
    ["Marketplace", marketplaceLabel(snapshot)],
    ["Reporting Period", periodLabel(snapshot)],
    ["Report status", snapshot.status === "completed" ? "Completed" : snapshot.status],
    [
      "Generated",
      new Date(snapshot.createdAt).toLocaleDateString("en-GB", { dateStyle: "medium" }),
    ],
    [],
    ["Products", products.size],
    ["Rows", rows.length],
    [CURRENT_SOH.label, currentSoh ?? ABSENT],
    [DISPATCH.label, dispatch ?? ABSENT],
    [GRN.label, grn ?? ABSENT],
    [SALES_QUANTITY.label, salesQuantity],
    ["Sales Value", Math.round(salesValue)],
    ["Damage", damage],
    ["Returned", returned],
  ];

  // Per marketplace, but only when there is more than one to compare.
  const marketplaces = [...new Set(rows.map((row) => row.marketplace))];
  if (marketplaces.length > 1) {
    out.push([], ["By marketplace"]);
    out.push([
      "Marketplace",
      "Products",
      CURRENT_SOH.label,
      DISPATCH.label,
      GRN.label,
      SALES_QUANTITY.label,
    ]);

    for (const marketplace of marketplaces) {
      const own = rows.filter((row) => row.marketplace === marketplace);
      const seen = new Set<string>();
      let soh: number | null = null;
      let sent: number | null = null;
      let received: number | null = null;
      let sold = 0;

      for (const row of own) {
        if (row.erpItemId && row.currentSoh !== null && !seen.has(row.erpItemId)) {
          seen.add(row.erpItemId);
          soh = (soh ?? 0) + row.currentSoh;
        }
        if (row.dispatch !== null && row.dispatch !== undefined) {
          sent = (sent ?? 0) + row.dispatch;
        }
        if (row.grn !== null) received = (received ?? 0) + row.grn;
        sold += row.salesQuantity;
      }

      out.push([
        marketplace,
        new Set(own.map((row) => row.sku)).size,
        soh ?? ABSENT,
        sent ?? ABSENT,
        received ?? ABSENT,
        sold,
      ]);
    }
  }

  out.push(
    [],
    ["Notes"],
    [CURRENT_SOH.label, "Healthy Master's latest available ERP stock position."],
    [
      DISPATCH.label,
      "Quantity on ERP orders that reached completed in that month. The ERP holds no separate dispatch count, so this is a subset of GRN.",
    ],
    [GRN.label, "ERP quantity used for this report's GRN field, by month."],
    [SALES_QUANTITY.label, "Quantity reported by the uploaded marketplace report."],
    ["Damage", "Recorded as 0 for this report version."],
    ["Returned", "Recorded as 0 for this report version."],
    [ABSENT, "The value is unavailable. A zero means a recorded zero."],
  );

  return out;
}

function dataQualitySheetRows(snapshot: SnapshotView): Cell[][] {
  const out: Cell[][] = [
    ["Healthy Master"],
    ["SOH Report — Data Quality"],
    [],
    [
      "Marketplace",
      "Reporting Period",
      "Products",
      "Mapped",
      "Needs Review",
      "ERP Status",
      "GRN Status",
      "Import Status",
    ],
  ];

  const ERP_LABELS: Record<string, string> = {
    reconciled: "ERP connected",
    notConfigured: "ERP not configured",
    unavailable: "ERP unavailable",
  };
  const GRN_LABELS: Record<string, string> = {
    available: "GRN available",
    notConfigured: "ERP not configured",
    unavailable: "ERP unavailable",
  };

  for (const section of snapshot.sections) {
    out.push([
      section.marketplace,
      section.periodStart && section.periodEnd
        ? `${dayLabel(section.periodStart)} – ${dayLabel(section.periodEnd)}`
        : ABSENT,
      section.products,
      section.mappedProducts,
      section.unresolvedProducts,
      ERP_LABELS[section.erpState] ?? section.erpState,
      GRN_LABELS[section.grnState] ?? section.grnState,
      section.status === "completed" ? "Completed" : "Failed",
    ]);
  }

  if (snapshot.dataQuality.length > 0) {
    out.push([], ["Notes"]);
    for (const note of snapshot.dataQuality) out.push([note.title, note.detail]);
  }

  return out;
}

/**
 * Builds the workbook and returns it as bytes.
 *
 * SheetJS is imported here rather than at module scope so it is fetched only
 * when somebody exports — it is several hundred kilobytes and most readers
 * never do.
 */
export async function buildWorkbook(
  snapshot: SnapshotView,
  rows: ReadonlyArray<SnapshotRow>,
  scope: ExportScope,
): Promise<ArrayBuffer> {
  const XLSX = await import("xlsx");

  const report = XLSX.utils.aoa_to_sheet(reportSheetRows(snapshot, rows, scope));
  const headerRow = headerRowIndex(scope);
  const lastRow = headerRow + rows.length;
  const lastColumn = EXPORT_COLUMNS.length - 1;

  report["!cols"] = [
    { wch: 13 }, // Marketplace
    { wch: 46 }, // Product
    { wch: 26 }, // SKU
    { wch: 15 }, // EAN
    { wch: 10 }, // Month
    { wch: 12 }, // Current SOH
    { wch: 11 }, // Dispatch
    { wch: 10 }, // GRN
    { wch: 15 }, // Sales Quantity
    { wch: 14 }, // Sales Value
    { wch: 9 }, // Damage
    { wch: 10 }, // Returned
    { wch: 14 }, // Status
  ];

  // Freeze everything above and including the header, so scrolling a long
  // report keeps the column names in view.
  report["!freeze"] = { xSplit: 0, ySplit: headerRow + 1 };
  report["!autofilter"] = {
    ref: XLSX.utils.encode_range(
      { r: headerRow, c: 0 },
      { r: Math.max(headerRow, lastRow), c: lastColumn },
    ),
  };

  // Number formats on the numeric columns, so Excel itself renders the
  // grouping rather than the export baking in a string.
  // Looked up by name rather than written as literal indices: adding a column
  // to `EXPORT_COLUMNS` used to silently shift the formatting one cell right.
  const columnAt = (name: string) => EXPORT_COLUMNS.indexOf(name as never);
  const quantityColumns = [
    CURRENT_SOH.label,
    DISPATCH.label,
    GRN.label,
    SALES_QUANTITY.label,
    "Damage",
    "Returned",
  ].map(columnAt);
  const valueColumn = columnAt("Sales Value");

  for (let r = headerRow + 1; r <= lastRow; r += 1) {
    for (const c of quantityColumns) {
      const cell = report[XLSX.utils.encode_cell({ r, c })] as
        | { t?: string; z?: string }
        | undefined;
      if (cell && cell.t === "n") cell.z = QUANTITY_FORMAT;
    }
    const value = report[XLSX.utils.encode_cell({ r, c: valueColumn })] as
      | { t?: string; z?: string }
      | undefined;
    if (value && value.t === "n") value.z = CURRENCY_FORMAT;
  }

  const summary = XLSX.utils.aoa_to_sheet(summarySheetRows(snapshot, rows));
  summary["!cols"] = [
    { wch: 22 },
    { wch: 52 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 16 },
  ];

  const quality = XLSX.utils.aoa_to_sheet(dataQualitySheetRows(snapshot));
  quality["!cols"] = [
    { wch: 16 },
    { wch: 30 },
    { wch: 10 },
    { wch: 10 },
    { wch: 13 },
    { wch: 20 },
    { wch: 20 },
    { wch: 14 },
  ];

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, report, "SOH Report");
  XLSX.utils.book_append_sheet(book, summary, "Summary");
  XLSX.utils.book_append_sheet(book, quality, "Data Quality");

  return XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

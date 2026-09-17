import type {
  ExcelRowError,
  ImportStatistics,
  NormalizedExcelRow,
  ParsedSheet,
} from "../../types/excel";
import {
  reportingPeriodFromDays,
  type ReportingPeriod,
} from "../dates/reporting-period";
import {
  buildMasterIndex,
  eanForMarketplaceId,
  emptyMasterIndex,
  type MasterIndex,
} from "./master-sheet";
import {
  MASTER_SHEET,
  isMasterSheet,
  profileForSheet,
  salesSheetsIn,
  type MarketplaceProfile,
} from "./marketplace-profiles";
import { isValidEan } from "./ean";
import { ExcelParseError, inspectWorkbook, parseWorkbook } from "./parser";
import {
  normalizeStatus,
  toCalendarDateWithMode,
  toNumber,
  toText,
} from "./validation";

/**
 * Reading the real Healthy Master workbook.
 *
 * It is not a marketplace export — it is seven sheets: one `Master` product
 * mapping table and six marketplace sales sheets that share no schema. So a
 * sheet is never guessed at. Each is matched to a declared profile by name, and
 * a sheet with no profile is reported rather than parsed on hope.
 *
 * The `Master` sheet is read first because it is what lets a marketplace's
 * private product id become an EAN, and an EAN is what the ERP catalogue can
 * actually be matched on.
 */

export interface WorkbookOverview {
  readonly sheets: ParsedSheet[];
  readonly hasMasterSheet: boolean;
  readonly master: {
    readonly rows: number;
    readonly withEan: number;
    readonly active: number;
  } | null;
  readonly marketplaces: {
    readonly marketplace: string;
    readonly sheet: string;
    readonly rowCount: number;
    readonly caveats: ReadonlyArray<string>;
  }[];
  /** Sheets present in the file that no profile covers. */
  readonly unrecognisedSheets: string[];
}

/**
 * What is in the file, before committing to importing anything.
 *
 * The upload screen shows this so a human picks the sheet, rather than the
 * parser picking the first one with rows — which is how the first attempt landed
 * on `Master` and correctly reported that it had no dates.
 */
export function inspectMarketplaceWorkbook(
  data: ArrayBuffer | Uint8Array,
): WorkbookOverview {
  const sheets = inspectWorkbook(data);
  const names = sheets.map((sheet) => sheet.name);
  const profiles = salesSheetsIn(names);

  let master: WorkbookOverview["master"] = null;
  if (names.some((name) => isMasterSheet(name))) {
    try {
      const parsed = parseWorkbook(data, { sheetName: MASTER_SHEET });
      master = buildMasterIndex(parsed.rows).counts;
    } catch {
      // A malformed Master sheet is not fatal — the marketplace sheets that
      // carry an EAN of their own (Blinkit) still reconcile without it.
      master = null;
    }
  }

  return {
    sheets,
    hasMasterSheet: names.some((name) => isMasterSheet(name)),
    master,
    marketplaces: profiles.map((profile) => ({
      marketplace: profile.marketplace,
      sheet: profile.sheet,
      rowCount: sheets.find((sheet) => sheet.name === profile.sheet)?.rowCount ?? 0,
      caveats: profile.caveats ?? [],
    })),
    unrecognisedSheets: names.filter(
      (name) => !isMasterSheet(name) && !profileForSheet(name),
    ),
  };
}

export interface ImportSheetOptions {
  /** Which sheet to import. Must match a declared marketplace profile. */
  readonly sheet: string;
  /**
   * Reporting year, required only for sheets whose date column is a bare month
   * name (Flipkart). Without it those rows cannot be dated and are reported.
   */
  readonly year?: number | null;
}

export interface SheetImportResult {
  readonly marketplace: string;
  readonly sheet: string;
  readonly rows: NormalizedExcelRow[];
  readonly errors: ExcelRowError[];
  readonly statistics: ImportStatistics;
  readonly period: ReportingPeriod | null;
  readonly caveats: ReadonlyArray<string>;
  readonly master: MasterIndex["counts"] | null;
  /** How many rows reached an EAN, and how. */
  readonly identifiers: {
    readonly fromSheet: number;
    readonly fromMasterLookup: number;
    readonly unresolved: number;
  };
}

/**
 * Imports one marketplace sheet.
 *
 * Every row survives. A row that cannot be dated, or whose product id resolves
 * to no EAN, is normalized anyway and reported with its spreadsheet row number —
 * an import that silently discards a tenth of its rows still says "completed",
 * and the missing revenue surfaces later as an unexplained variance.
 */
export function importMarketplaceSheet(
  data: ArrayBuffer | Uint8Array,
  options: ImportSheetOptions,
): SheetImportResult {
  const profile = profileForSheet(options.sheet);
  if (!profile) {
    throw new ExcelParseError(
      `"${options.sheet}" is not a recognised marketplace sheet. ` +
        `Known sheets: ${salesSheetsIn([options.sheet, ...MARKETPLACE_SHEET_NAMES]).map((p) => p.sheet).join(", ") || MARKETPLACE_SHEET_NAMES.join(", ")}.`,
    );
  }

  const master = readMasterIndex(data);
  const workbook = parseWorkbook(data, { sheetName: profile.sheet });
  const { mapping, dateMode } = profile;

  const rows: NormalizedExcelRow[] = [];
  const errors: ExcelRowError[] = [];
  const days: string[] = [];
  let fromSheet = 0;
  let fromMasterLookup = 0;
  let unresolved = 0;

  workbook.rows.forEach((raw, index) => {
    // +1 for the header, +1 to be 1-based: the number shown in Excel.
    const sourceRow = index + 2;
    const cell = (header: string | undefined) =>
      header ? (raw[header] ?? null) : null;

    const quantity = toNumber(cell(mapping.quantity));
    const grossSales = toNumber(cell(mapping.grossSales));
    const marketplaceItemId = toText(cell(mapping.marketplaceItemId));
    const productName = toText(cell(mapping.productName));

    if (
      quantity === null &&
      grossSales === null &&
      !marketplaceItemId &&
      !productName
    ) {
      // Trailing blank rows and separators. Not an error, just not data.
      return;
    }

    const orderDate = toCalendarDateWithMode(cell(mapping.orderDate), dateMode, {
      year: options.year ?? null,
      textFormat: profile.textDateFormat,
      date1904: workbook.date1904,
    });

    if (orderDate === null) {
      errors.push({
        sourceRow,
        field: "orderDate",
        message:
          dateMode === "monthName"
            ? "This sheet dates rows by month name only, with no year. Supply a reporting year to import it."
            : "Could not read a date from this row.",
      });
    }

    // The sheet's own EAN wins — but only if it is actually an EAN. The real
    // Blinkit sheet puts the placeholder `8910000000000` in `UPC` on twelve
    // different products, and trusting it both blocked the Master lookup that
    // would have found their real barcode and collapsed twelve products onto
    // one key. Anything failing its check digit is treated as absent.
    const sheetEan = toText(cell(mapping.barcode));
    let barcode = isValidEan(sheetEan) ? sheetEan : null;
    if (barcode) {
      fromSheet += 1;
    } else {
      barcode = eanForMarketplaceId(master, profile, marketplaceItemId);
      if (barcode) fromMasterLookup += 1;
      else unresolved += 1;
    }

    if (!barcode && !marketplaceItemId) {
      errors.push({
        sourceRow,
        field: "sku",
        message: "No product identifier on this row — nothing to match an ERP line against.",
      });
    }

    rows.push({
      sourceRow,
      orderDate,
      marketplaceOrderId: toText(cell(mapping.marketplaceOrderId)),
      marketplaceItemId,
      // The ERP has no concept of a marketplace's private id, so the EAN is
      // carried as the SKU-equivalent identifier for matching.
      sku: barcode,
      barcode,
      productName,
      quantity,
      unitPrice: toNumber(cell(mapping.unitPrice)),
      grossSales,
      rawStatus: toText(cell(mapping.status)),
      normalizedStatus: mapping.status
        ? normalizeStatus(cell(mapping.status))
        : // Sheets with no status column are pre-aggregated sales: every row is
          // a completed sale, so calling them `unknown` would exclude the lot.
          "delivered",
    });

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

  return {
    marketplace: profile.marketplace,
    sheet: profile.sheet,
    rows,
    errors,
    statistics,
    period:
      statistics.minDate && statistics.maxDate
        ? reportingPeriodFromDays(statistics.minDate, statistics.maxDate)
        : null,
    caveats: profile.caveats ?? [],
    master: master.counts.rows > 0 ? master.counts : null,
    identifiers: { fromSheet, fromMasterLookup, unresolved },
  };
}

const MARKETPLACE_SHEET_NAMES = [
  "Blinkit",
  "Bigbasket",
  "Zepto",
  "Swiggy",
  "FirstClub",
  "Flipkart",
];

function readMasterIndex(data: ArrayBuffer | Uint8Array): MasterIndex {
  try {
    const parsed = parseWorkbook(data, { sheetName: MASTER_SHEET });
    return buildMasterIndex(parsed.rows);
  } catch {
    // No Master sheet, or it could not be read. Sheets carrying their own EAN
    // still work; the rest will report unresolved identifiers.
    return emptyMasterIndex();
  }
}

export type { MarketplaceProfile };

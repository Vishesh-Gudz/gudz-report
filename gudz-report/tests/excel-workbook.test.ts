import { describe, expect, test } from "vitest";
import * as XLSX from "xlsx";

import {
  MASTER_COLUMNS,
  profileForSheet,
  salesSheetsIn,
  MARKETPLACE_PROFILES,
} from "@/lib/excel/marketplace-profiles";
import { buildMasterIndex, eanForMarketplaceId } from "@/lib/excel/master-sheet";
import {
  excelSerialToCalendarDate,
  toCalendarDate,
  toCalendarDateWithMode,
} from "@/lib/excel/validation";
import {
  importMarketplaceSheet,
  inspectMarketplaceWorkbook,
} from "@/lib/excel/workbook";

/**
 * Reading the Healthy Master workbook.
 *
 * These tests exist because of two bugs found against the real file, both of
 * which produced plausible-looking output:
 *
 *  1. Every date was one day early. `cellDates: true` converts an Excel serial
 *     through the local timezone and lands ten seconds before midnight on the
 *     previous day, so serial 46174 — which Excel itself displays as 1/6/2026 —
 *     arrived as 31 May whether it was read in UTC or in local components.
 *  2. Sheet selection was inferred, so the parser chose `Master` and correctly
 *     reported that a product mapping table has no dates.
 *
 * The workbooks here are built in memory rather than loaded from disk: the real
 * file is 200k rows and not in the repository, and a fixture that is checked in
 * is a fixture that can be reasoned about.
 */

/** A workbook whose date cells are real Excel serials, as SheetJS reads them. */
function workbookWith(sheets: Record<string, unknown[][]>): Uint8Array {
  const book = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return new Uint8Array(
    XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer,
  );
}

/** Excel's serial for a calendar day, 1900 system. 46174 is 2026-06-01. */
function serial(year: number, month: number, day: number): number {
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000) + 25_569;
}

const MASTER_ROWS = [
  [
    MASTER_COLUMNS.productName,
    MASTER_COLUMNS.ean,
    MASTER_COLUMNS.status,
    MASTER_COLUMNS.blinkit,
    MASTER_COLUMNS.zepto,
    MASTER_COLUMNS.bigbasket,
    MASTER_COLUMNS.flipkart,
  ],
  ["Ragi Chips 30g", "8906165856310", "Active", "10180611", "zep-a", "40350653", "FSN1"],
  ["Palak Chips 30g", "8906165856341", "Inactive", "NA", "zep-b", "NA", "NA"],
];

describe("Excel date serials", () => {
  test("serial 46174 is 1 June 2026, the day Excel itself displays", () => {
    // The regression that mattered: read as a Date on an IST machine this cell
    // becomes 2026-05-31T18:29:50Z and every sheet shifted a day early.
    expect(excelSerialToCalendarDate(46174)).toBe("2026-06-01");
  });

  test("agrees with the serial for an arbitrary day", () => {
    expect(excelSerialToCalendarDate(serial(2026, 8, 31))).toBe("2026-08-31");
    expect(excelSerialToCalendarDate(serial(2026, 1, 1))).toBe("2026-01-01");
  });

  test("survives the 1900 leap-year quirk boundary", () => {
    // Serial 61 is 1 March 1900 in both Excel and reality; 60 is Excel's
    // non-existent 29 February. Getting this wrong shifts every earlier date.
    expect(excelSerialToCalendarDate(61)).toBe("1900-03-01");
  });

  test("shifts by 1,462 days under the 1904 date system", () => {
    expect(excelSerialToCalendarDate(46174, true)).toBe("2030-06-02");
  });

  test("refuses values that are not plausible dates", () => {
    expect(excelSerialToCalendarDate(0)).toBeNull();
    expect(excelSerialToCalendarDate(-5)).toBeNull();
    // A bare `20260609` written as a number is not a serial.
    expect(excelSerialToCalendarDate(20_260_609)).toBeNull();
    expect(excelSerialToCalendarDate(Number.NaN)).toBeNull();
  });

  test("reads a serial through toCalendarDate", () => {
    expect(toCalendarDate(46174)).toBe("2026-06-01");
  });
});

describe("declared date modes", () => {
  test("a Bigbasket range is dated by its start", () => {
    expect(toCalendarDateWithMode("20260609 - 20260609", "bigbasketRange")).toBe(
      "2026-06-09",
    );
  });

  test("a bare month name needs the year to be supplied", () => {
    expect(toCalendarDateWithMode("June", "monthName", { year: null })).toBeNull();
    expect(toCalendarDateWithMode("June", "monthName", { year: 2026 })).toBe(
      "2026-06-01",
    );
  });

  test("an abbreviated month is read, because the real sheet mixes both", () => {
    // Flipkart ships `June`, `July` and `Aug` in the same column.
    expect(toCalendarDateWithMode("Aug", "monthName", { year: 2026 })).toBe(
      "2026-08-01",
    );
    expect(toCalendarDateWithMode("Sept", "monthName", { year: 2026 })).toBe(
      "2026-09-01",
    );
  });

  test("an ambiguous month abbreviation is refused, not guessed", () => {
    // `Ma` could be March or May, and picking one moves sales two months.
    expect(toCalendarDateWithMode("Ma", "monthName", { year: 2026 })).toBeNull();
    expect(toCalendarDateWithMode("J", "monthName", { year: 2026 })).toBeNull();
    expect(toCalendarDateWithMode("Smarch", "monthName", { year: 2026 })).toBeNull();
  });

  test("day-first text is read only when the sheet declares the format", () => {
    // Zepto ships 49,759 rows like this alongside real date cells.
    expect(toCalendarDateWithMode("13-06-2026", "cell")).toBeNull();
    expect(
      toCalendarDateWithMode("13-06-2026", "cell", { textFormat: "DD-MM-YYYY" }),
    ).toBe("2026-06-13");
  });

  test("an ambiguous day/month is still refused without a declared format", () => {
    expect(toCalendarDateWithMode("05-01-2026", "cell")).toBeNull();
    expect(
      toCalendarDateWithMode("05-01-2026", "cell", { textFormat: "DD-MM-YYYY" }),
    ).toBe("2026-01-05");
    expect(
      toCalendarDateWithMode("05-01-2026", "cell", { textFormat: "MM-DD-YYYY" }),
    ).toBe("2026-05-01");
  });

  test("a declared format does not accept an impossible date", () => {
    expect(
      toCalendarDateWithMode("31-02-2026", "cell", { textFormat: "DD-MM-YYYY" }),
    ).toBeNull();
  });
});

describe("the Master sheet as a join table", () => {
  const rows = [
    Object.fromEntries(MASTER_ROWS[1]!.map((value, index) => [MASTER_ROWS[0]![index], value])),
    Object.fromEntries(MASTER_ROWS[2]!.map((value, index) => [MASTER_ROWS[0]![index], value])),
  ] as Record<string, unknown>[];

  test("maps a marketplace's own id to an EAN", () => {
    const index = buildMasterIndex(rows);
    const blinkit = profileForSheet("Blinkit")!;
    expect(eanForMarketplaceId(index, blinkit, "10180611")).toBe("8906165856310");
  });

  test("treats NA as absent rather than an id", () => {
    // Otherwise every unlisted product maps to whichever row came last.
    const index = buildMasterIndex(rows);
    const bigbasket = profileForSheet("Bigbasket")!;
    expect(eanForMarketplaceId(index, bigbasket, "NA")).toBeNull();
  });

  test("resolves nothing for a profile with no Master column", () => {
    const index = buildMasterIndex(rows);
    const firstclub = profileForSheet("FirstClub")!;
    expect(firstclub.masterIdColumn).toBeNull();
    expect(eanForMarketplaceId(index, firstclub, "FC251210015738")).toBeNull();
  });

  test("counts rows, EANs and active products", () => {
    expect(buildMasterIndex(rows).counts).toEqual({ rows: 2, withEan: 2, active: 1 });
  });
});

describe("marketplace profiles", () => {
  test("every profile names a distinct sheet", () => {
    const sheets = MARKETPLACE_PROFILES.map((profile) => profile.sheet.toLowerCase());
    expect(new Set(sheets).size).toBe(sheets.length);
  });

  test("a sheet is matched case-insensitively", () => {
    expect(profileForSheet("blinkit")?.marketplace).toBe("blinkit");
    expect(profileForSheet(" Zepto ")?.marketplace).toBe("zepto");
  });

  test("an unknown sheet has no profile", () => {
    expect(profileForSheet("Master")).toBeNull();
    expect(profileForSheet("Sheet1")).toBeNull();
  });

  test("only the sheets actually present are offered", () => {
    const found = salesSheetsIn(["Master", "Zepto", "Something Else"]);
    expect(found.map((profile) => profile.sheet)).toEqual(["Zepto"]);
  });
});

describe("importing a chosen sheet", () => {
  const data = workbookWith({
    Master: MASTER_ROWS,
    Blinkit: [
      ["Order Date", "Order Id", "Item Id", "UPC", "Product Name", "Quantity", "Selling Price (Rs)", "Total Gross Bill Amount", "Order Status"],
      [serial(2026, 6, 1), "2157824293", "10180611", "8906165856310", "Ragi Chips", 2, 150, 300, "DELIVERED"],
      [serial(2026, 6, 2), "2157824294", "10180611", "8906165856310", "Ragi Chips", 1, 150, 150, "CANCELLED"],
    ],
    Zepto: [
      ["Sales Date", "SKU ID", "SKU Name", "Quantity", "GMV"],
      [serial(2026, 6, 1), "zep-a", "Ragi Chips", 3, 450],
      ["13-06-2026", "zep-b", "Palak Chips", 4, 600],
      ["not a date", "zep-b", "Palak Chips", 1, 150],
    ],
    Flipkart: [
      ["Month", "product_id", "product_title", "Unit ", "GMV"],
      ["June", "FSN1", "Ragi Chips", 5, 750],
    ],
    Leftovers: [["a"], [1]],
  });

  test("describes the file without importing anything", () => {
    const overview = inspectMarketplaceWorkbook(data);
    expect(overview.hasMasterSheet).toBe(true);
    expect(overview.master).toEqual({ rows: 2, withEan: 2, active: 1 });
    expect(overview.marketplaces.map((entry) => entry.sheet)).toEqual([
      "Blinkit",
      "Zepto",
      "Flipkart",
    ]);
    // `Master` is not offered as a sales sheet — choosing it was the original bug.
    expect(overview.unrecognisedSheets).toEqual(["Leftovers"]);
  });

  test("dates a sheet by the day Excel shows, not a day early", () => {
    const result = importMarketplaceSheet(data, { sheet: "Blinkit" });
    expect(result.rows[0]?.orderDate).toBe("2026-06-01");
    expect(result.statistics.minDate).toBe("2026-06-01");
    expect(result.statistics.maxDate).toBe("2026-06-02");
  });

  test("uses the sheet's own EAN when it has one", () => {
    const result = importMarketplaceSheet(data, { sheet: "Blinkit" });
    expect(result.identifiers).toEqual({
      fromSheet: 2,
      fromMasterLookup: 0,
      unresolved: 0,
    });
    expect(result.rows[0]?.sku).toBe("8906165856310");
  });

  test("keeps a cancelled row rather than dropping it", () => {
    // Excluding it here would hide it; the status policy decides later.
    const result = importMarketplaceSheet(data, { sheet: "Blinkit" });
    expect(result.rows).toHaveLength(2);
    expect(result.rows[1]?.normalizedStatus).toBe("cancelled");
  });

  test("reads Zepto's mixed date cells and declared text dates alike", () => {
    const result = importMarketplaceSheet(data, { sheet: "Zepto" });
    expect(result.rows[0]?.orderDate).toBe("2026-06-01");
    expect(result.rows[1]?.orderDate).toBe("2026-06-13");
  });

  test("reports an unreadable date against its spreadsheet row", () => {
    const result = importMarketplaceSheet(data, { sheet: "Zepto" });
    const failed = result.errors.find((error) => error.field === "orderDate");
    // Header is row 1, so the third data row is spreadsheet row 4.
    expect(failed?.sourceRow).toBe(4);
    expect(result.rows[2]?.orderDate).toBeNull();
    // Still imported: a dropped row becomes an unexplained variance later.
    expect(result.rows).toHaveLength(3);
  });

  test("resolves a Zepto id to an EAN through Master", () => {
    const result = importMarketplaceSheet(data, { sheet: "Zepto" });
    expect(result.rows[0]?.barcode).toBe("8906165856310");
    expect(result.identifiers.fromMasterLookup).toBe(3);
  });

  test("a sheet with no status column counts as sold, not unknown", () => {
    // These sheets are pre-aggregated sales. `unknown` would exclude the lot.
    const result = importMarketplaceSheet(data, { sheet: "Zepto" });
    expect(result.rows[0]?.normalizedStatus).toBe("delivered");
  });

  test("a month-name sheet says what it needs instead of guessing a year", () => {
    const result = importMarketplaceSheet(data, { sheet: "Flipkart" });
    expect(result.statistics.invalidRows).toBe(1);
    expect(result.errors[0]?.message).toMatch(/reporting year/i);
    expect(result.period).toBeNull();
  });

  test("dates a month-name sheet once the year is supplied", () => {
    const result = importMarketplaceSheet(data, { sheet: "Flipkart", year: 2026 });
    expect(result.rows[0]?.orderDate).toBe("2026-06-01");
    // The trailing space in the real `Unit ` header is matched exactly.
    expect(result.rows[0]?.quantity).toBe(5);
  });

  test("refuses a sheet that is not a marketplace sheet", () => {
    expect(() => importMarketplaceSheet(data, { sheet: "Master" })).toThrow(
      /not a recognised marketplace sheet/i,
    );
  });
});

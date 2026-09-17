import { describe, expect, test } from "vitest";
import * as XLSX from "xlsx";

import { inspectWorkbook, parseWorkbook, suggestHeader } from "@/lib/excel/parser";
import {
  normalizeWorkbook,
  periodFromStatistics,
  suggestColumnMapping,
} from "@/lib/excel/normalizer";
import type { ColumnMapping } from "@/types/excel";

/**
 * Parser and normalizer, exercised against workbooks built in-memory.
 *
 * These fixtures are structural, not pretended-real: they exist to prove the
 * pipeline handles the *shapes* a marketplace export takes — a second sheet,
 * banner rows above the header, blank trailing rows, missing identifiers. The
 * real Healthy Master / Blinkit column names are not yet known and are
 * deliberately not invented here.
 */

function buildWorkbook(
  rows: unknown[][],
  options?: { sheetName?: string; extraSheet?: { name: string; rows: unknown[][] } },
): Uint8Array {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(rows),
    options?.sheetName ?? "Sheet1",
  );
  if (options?.extraSheet) {
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet(options.extraSheet.rows),
      options.extraSheet.name,
    );
  }
  return XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as Uint8Array;
}

const HEADERS = ["Order Date", "Order ID", "SKU", "Product Name", "Qty", "Amount", "Status"];

const SAMPLE = buildWorkbook([
  HEADERS,
  ["2026-08-01", "MP-1", "HM-KHK-100", "Quinoa Khakhra", 10, 420, "Delivered"],
  ["2026-08-14", "MP-2", "HM-NDL-200", "Ragi Noodles", 5, 400, "Returned"],
  ["2026-08-31", "MP-3", "HM-KHK-100", "Quinoa Khakhra", 2, 84, "Delivered"],
]);

const MAPPING: ColumnMapping = {
  orderDate: "Order Date",
  marketplaceOrderId: "Order ID",
  sku: "SKU",
  productName: "Product Name",
  quantity: "Qty",
  grossSales: "Amount",
  status: "Status",
};

describe("parsing", () => {
  test("reads headers and rows", () => {
    const workbook = parseWorkbook(SAMPLE);
    expect(workbook.selectedSheet).toBe("Sheet1");
    expect(workbook.headers).toEqual(HEADERS);
    expect(workbook.rows).toHaveLength(3);
  });

  test("lists every sheet so a human can choose", () => {
    const multi = buildWorkbook([HEADERS, ["2026-08-01", "MP-1", "S", "P", 1, 1, "Delivered"]], {
      extraSheet: { name: "Notes", rows: [["ignore me"]] },
    });
    const sheets = inspectWorkbook(multi);
    expect(sheets.map((sheet) => sheet.name)).toEqual(["Sheet1", "Notes"]);
  });

  test("skips banner rows above the header when told where it is", () => {
    const withBanner = buildWorkbook([
      ["Marketplace export — generated 2026-09-01"],
      [],
      HEADERS,
      ["2026-08-02", "MP-9", "HM-KHK-100", "Quinoa Khakhra", 3, 126, "Delivered"],
    ]);
    const workbook = parseWorkbook(withBanner, { headerRow: 3 });
    expect(workbook.headers).toEqual(HEADERS);
    expect(workbook.rows).toHaveLength(1);
  });

  test("fails loudly on an empty sheet rather than importing nothing", () => {
    // A silent zero-row import looks identical to a successful import of an
    // empty file, which is the one outcome nobody thinks to check.
    expect(() => parseWorkbook(buildWorkbook([HEADERS]))).toThrow(/no data rows/i);
  });

  test("names the sheets when asked for one that does not exist", () => {
    expect(() => parseWorkbook(SAMPLE, { sheetName: "Nope" })).toThrow(/Available: Sheet1/);
  });
});

describe("header suggestions", () => {
  test("matches ignoring case and punctuation", () => {
    expect(suggestHeader(["Order Date", "SKU"], ["order date"])).toBe("Order Date");
    expect(suggestHeader(["order_date"], ["Order Date"])).toBe("order_date");
  });

  test("prefers an exact match over a partial one", () => {
    // Otherwise "Parent SKU" wins over "SKU" and every row maps to the wrong id.
    expect(suggestHeader(["Parent SKU", "SKU"], ["sku"])).toBe("SKU");
  });

  test("returns null rather than a bad guess", () => {
    expect(suggestHeader(["Alpha", "Beta"], ["quantity"])).toBeNull();
  });

  test("suggests a whole mapping from real headers", () => {
    const mapping = suggestColumnMapping(HEADERS);
    expect(mapping.orderDate).toBe("Order Date");
    expect(mapping.sku).toBe("SKU");
    expect(mapping.quantity).toBe("Qty");
  });
});

describe("normalizing", () => {
  test("produces typed rows and the period they cover", () => {
    const result = normalizeWorkbook(parseWorkbook(SAMPLE), MAPPING);

    expect(result.rows).toHaveLength(3);
    expect(result.errors).toEqual([]);
    expect(result.statistics.minDate).toBe("2026-08-01");
    expect(result.statistics.maxDate).toBe("2026-08-31");
    expect(result.statistics.validRows).toBe(3);

    const period = periodFromStatistics(result.statistics);
    expect(period?.fromIso).toBe("2026-08-01T00:00:00.000Z");
    expect(period?.toIso).toBe("2026-08-31T23:59:59.999Z");
  });

  test("points errors back at the spreadsheet row number", () => {
    const rows = normalizeWorkbook(parseWorkbook(SAMPLE), MAPPING).rows;
    // Row 1 is the header, so the first data row is 2 — what Excel shows.
    expect(rows[0]?.sourceRow).toBe(2);
    expect(rows[2]?.sourceRow).toBe(4);
  });

  test("folds the marketplace's status vocabulary", () => {
    const rows = normalizeWorkbook(parseWorkbook(SAMPLE), MAPPING).rows;
    expect(rows.map((row) => row.normalizedStatus)).toEqual([
      "delivered",
      "returned",
      "delivered",
    ]);
    // The original is kept so a mapping decision can be audited later.
    expect(rows[1]?.rawStatus).toBe("Returned");
  });

  test("reports a bad row instead of dropping it", () => {
    const withBadDate = buildWorkbook([
      HEADERS,
      ["03/04/2026", "MP-1", "HM-KHK-100", "Quinoa Khakhra", 10, 420, "Delivered"],
    ]);
    const result = normalizeWorkbook(parseWorkbook(withBadDate), MAPPING);

    // The row survives — it is still counted and still visible.
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.orderDate).toBeNull();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.field).toBe("orderDate");
    expect(result.statistics.invalidRows).toBe(1);
  });

  test("reports a row with no product identifier", () => {
    const noSku = buildWorkbook([
      HEADERS,
      ["2026-08-01", "MP-1", "", "Quinoa Khakhra", 10, 420, "Delivered"],
    ]);
    const result = normalizeWorkbook(parseWorkbook(noSku), MAPPING);
    expect(result.errors.map((error) => error.field)).toContain("sku");
  });

  test("ignores trailing blank rows rather than calling them invalid", () => {
    const withBlanks = buildWorkbook([
      HEADERS,
      ["2026-08-01", "MP-1", "HM-KHK-100", "Quinoa Khakhra", 10, 420, "Delivered"],
      [null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null],
    ]);
    const result = normalizeWorkbook(parseWorkbook(withBlanks), MAPPING);
    expect(result.rows).toHaveLength(1);
    expect(result.statistics.invalidRows).toBe(0);
  });

  test("refuses a mapping that cannot produce a period", () => {
    expect(() =>
      normalizeWorkbook(parseWorkbook(SAMPLE), { sku: "SKU" }),
    ).toThrow(/orderDate/);
  });

  test("a file with no readable dates yields no period", () => {
    const undated = buildWorkbook([
      HEADERS,
      ["", "MP-1", "HM-KHK-100", "Quinoa Khakhra", 10, 420, "Delivered"],
    ]);
    const result = normalizeWorkbook(parseWorkbook(undated), MAPPING);
    expect(result.statistics.minDate).toBeNull();
    expect(periodFromStatistics(result.statistics)).toBeNull();
  });
});

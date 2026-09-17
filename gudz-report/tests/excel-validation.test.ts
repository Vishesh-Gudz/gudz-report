import { describe, expect, test } from "vitest";

import {
  normalizeStatus,
  toCalendarDate,
  toNumber,
  toText,
  validateMapping,
} from "@/lib/excel/validation";

/**
 * Cell coercion.
 *
 * The rule these tests defend: **absence stays absent.** A blank quantity must
 * not become 0 and an unrecognised status must not become "delivered", because
 * both turn a data gap into a confident wrong number that reconciles cleanly
 * and is therefore never questioned.
 */

describe("text", () => {
  test("trims, and treats blank as absent", () => {
    expect(toText("  HM-KHK-100  ")).toBe("HM-KHK-100");
    expect(toText("")).toBeNull();
    expect(toText("   ")).toBeNull();
    expect(toText(null)).toBeNull();
    expect(toText(undefined)).toBeNull();
  });

  test("treats Excel error cells as absent, not as content", () => {
    expect(toText("#N/A")).toBeNull();
    expect(toText("#VALUE!")).toBeNull();
    expect(toText("#REF!")).toBeNull();
  });

  test("stringifies numbers, because a SKU column can be numeric", () => {
    expect(toText(12345)).toBe("12345");
  });
});

describe("numbers", () => {
  test("reads plain and decimal values", () => {
    expect(toNumber(42)).toBe(42);
    expect(toNumber("42")).toBe(42);
    expect(toNumber("42.5")).toBe(42.5);
  });

  test("reads what marketplace exports actually contain", () => {
    expect(toNumber("1,234.56")).toBe(1234.56);
    expect(toNumber("₹1,234")).toBe(1234);
    expect(toNumber(" 99 ")).toBe(99);
  });

  test("reads accounting negatives", () => {
    expect(toNumber("(1,234.00)")).toBe(-1234);
    expect(toNumber("-50")).toBe(-50);
  });

  test("keeps zero, which is a real reported value", () => {
    expect(toNumber(0)).toBe(0);
    expect(toNumber("0")).toBe(0);
  });

  test("returns null rather than guessing", () => {
    expect(toNumber("")).toBeNull();
    expect(toNumber(null)).toBeNull();
    expect(toNumber("N/A")).toBeNull();
    expect(toNumber("twelve")).toBeNull();
    expect(toNumber(true)).toBeNull();
    expect(toNumber(Number.NaN)).toBeNull();
    expect(toNumber(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("dates", () => {
  test("reads a real Excel date cell", () => {
    expect(toCalendarDate(new Date("2026-08-14T00:00:00.000Z"))).toBe("2026-08-14");
  });

  test("reads unambiguous text dates", () => {
    expect(toCalendarDate("2026-08-14")).toBe("2026-08-14");
    expect(toCalendarDate("2026-08-14T09:30:00.000Z")).toBe("2026-08-14");
    expect(toCalendarDate("2026/08/14")).toBe("2026-08-14");
  });

  test("refuses ambiguous day/month text instead of picking one", () => {
    // 03/04/2026 is 3 April or 4 March depending on locale. Guessing moves
    // orders between months silently; refusing surfaces the row for a human.
    expect(toCalendarDate("03/04/2026")).toBeNull();
    expect(toCalendarDate("14-08-2026")).toBeNull();
  });

  test("returns null for blanks and nonsense", () => {
    expect(toCalendarDate("")).toBeNull();
    expect(toCalendarDate(null)).toBeNull();
    expect(toCalendarDate("not a date")).toBeNull();
    expect(toCalendarDate(new Date("invalid"))).toBeNull();
  });
});

describe("status folding", () => {
  test("recognises the delivered family", () => {
    for (const value of ["Delivered", "COMPLETED", "shipped", "Fulfilled"]) {
      expect(normalizeStatus(value), value).toBe("delivered");
    }
  });

  test("recognises returns and cancellations", () => {
    for (const value of ["Returned", "RTO", "refunded"]) {
      expect(normalizeStatus(value), value).toBe("returned");
    }
    for (const value of ["Cancelled", "CANCELED", "void"]) {
      expect(normalizeStatus(value), value).toBe("cancelled");
    }
  });

  test("an unrecognised status is unknown, never delivered", () => {
    // The asymmetry is the point: an unknown row is visible and can be mapped
    // later; a wrongly-delivered row silently inflates reconciled revenue.
    expect(normalizeStatus("Awaiting pickup")).toBe("unknown");
    expect(normalizeStatus("")).toBe("unknown");
    expect(normalizeStatus(null)).toBe("unknown");
  });
});

describe("mapping validation", () => {
  const headers = ["Order Date", "SKU", "Qty", "Amount"];

  test("accepts a mapping that points at real columns", () => {
    expect(
      validateMapping({ orderDate: "Order Date", sku: "SKU", quantity: "Qty" }, headers),
    ).toEqual([]);
  });

  test("reports a column the sheet does not have", () => {
    const problems = validateMapping(
      { orderDate: "Order Date", sku: "SKU", barcode: "EAN" },
      headers,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]?.field).toBe("barcode");
  });

  test("refuses a mapping with no date column", () => {
    // Without a date there is no reporting period, so there is no ERP window to
    // fetch and nothing to reconcile against.
    const problems = validateMapping({ sku: "SKU" }, headers);
    expect(problems.map((p) => p.field)).toContain("orderDate");
  });

  test("refuses a mapping with no product identifier", () => {
    const problems = validateMapping({ orderDate: "Order Date" }, headers);
    expect(problems.map((p) => p.field)).toContain("sku");
  });
});

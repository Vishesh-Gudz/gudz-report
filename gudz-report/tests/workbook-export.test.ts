import { describe, expect, test, vi } from "vitest";
import * as XLSX from "xlsx";

vi.mock("server-only", () => ({}));

import { ABSENT } from "@/lib/report/export";
import type { SnapshotRow, SnapshotView } from "@/lib/report/snapshot-model";
import { buildWorkbook, workbookFileName } from "@/lib/report/workbook";

/**
 * The exported workbook, opened and read back.
 *
 * Asserting the structures that were produced would only prove the builder
 * agrees with itself. These tests write real bytes and parse them the way Excel
 * would, because the failures worth catching — a sheet missing, a header
 * shifted by a row, a dash turned into a zero — all produce a file that opens
 * perfectly and says the wrong thing.
 */

function row(overrides: Partial<SnapshotRow> = {}): SnapshotRow {
  return {
    id: "row_1",
    marketplace: "blinkit",
    month: "2026-06",
    productName: "Ragi Chips - 100 gm",
    sku: "RAGI-100",
    ean: "8906165850653",
    marketplaceItemId: "10180611",
    erpItemId: "item_1",
    currentSoh: 7_918,
    grn: 4_403,
    salesQuantity: 8_776,
    salesValue: 1_448_819,
    damage: 0,
    returned: 0,
    mappingStatus: "confirmed",
    mappingReason: "Confirmed by a person.",
    sourceRows: 12,
    ...overrides,
  };
}

function snapshot(overrides: Partial<SnapshotView> = {}): SnapshotView {
  return {
    id: "snap_1",
    sourceFileName: "HM Sales Dump.xlsx",
    createdAt: Date.UTC(2026, 8, 18, 1, 30),
    status: "completed",
    marketplaces: ["blinkit"],
    periodStart: "2026-06-01",
    periodEnd: "2026-08-31",
    periodsDiffer: false,
    summary: {
      marketplaces: 1,
      products: 16,
      rows: 37,
      salesQuantity: 8_776,
      salesValue: 1_448_819,
      currentSoh: 7_918,
      grnQuantity: 4_403,
      mappedProducts: 12,
      unresolvedProducts: 4,
    },
    dataQuality: [
      { state: "ok", title: "GRN read for blinkit", detail: "From ERP B2B sales orders." },
    ],
    sections: [
      {
        marketplace: "blinkit",
        sheetName: "Blinkit",
        status: "completed",
        errorMessage: null,
        periodStart: "2026-06-01",
        periodEnd: "2026-08-31",
        months: ["2026-06", "2026-07", "2026-08"],
        sourceRows: 8_451,
        products: 16,
        salesQuantity: 8_776,
        salesValue: 1_448_819,
        erpState: "reconciled",
        erpMessage: null,
        grnState: "available",
        grnMessage: null,
        mappedProducts: 12,
        unresolvedProducts: 4,
      },
    ],
    rows: [row()],
    errorMessage: null,
    ...overrides,
  };
}

async function open(view: SnapshotView, rows: SnapshotRow[], scope: "current" | "full" = "full") {
  const bytes = await buildWorkbook(view, rows, scope);
  // `cellNF` so the number formats come back on read; without it SheetJS
  // parses the values and discards the formats it just wrote.
  return XLSX.read(new Uint8Array(bytes), { type: "array", cellNF: true });
}

/** The report sheet as a grid, so a header can be located rather than assumed. */
function grid(book: XLSX.WorkBook, sheet: string): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[sheet]!, {
    header: 1,
    defval: null,
    raw: true,
  });
}

describe("workbook structure", () => {
  test("has the three sheets, in order", async () => {
    const book = await open(snapshot(), [row()]);
    expect(book.SheetNames).toEqual(["SOH Report", "Summary", "Data Quality"]);
  });

  test("the report sheet opens with a title block, then the table", async () => {
    const book = await open(snapshot(), [row()]);
    const cells = grid(book, "SOH Report");

    expect(cells[0]![0]).toBe("Healthy Master");
    expect(cells[1]![0]).toBe("SOH Report");
    expect(cells.find((line) => line[0] === "Marketplace" && line[1] === "blinkit")).toBeDefined();
    expect(cells.find((line) => line[0] === "Reporting Period")).toBeDefined();
    expect(cells.find((line) => line[0] === "Generated")).toBeDefined();
  });

  test("the table header is the agreed columns", async () => {
    const book = await open(snapshot(), [row()]);
    const cells = grid(book, "SOH Report");
    const header = cells.find((line) => line[0] === "Marketplace" && line[1] === "Product");

    expect(header).toEqual([
      "Marketplace",
      "Product",
      "SKU",
      "EAN",
      "Month",
      "Current SOH",
      "GRN",
      "Sales Quantity",
      "Sales Value",
      "Damage",
      "Returned",
      "Status",
    ]);
  });

  test("the header row is frozen and filterable", async () => {
    const book = await open(snapshot(), [row()]);
    const sheet = book.Sheets["SOH Report"]!;
    expect(sheet["!autofilter"]).toBeDefined();
  });

  test("every data row lands under the header", async () => {
    const rows = Array.from({ length: 25 }, (_, index) =>
      row({ id: `r${index}`, sku: `SKU-${index}` }),
    );
    const cells = grid(await open(snapshot(), rows), "SOH Report");
    const headerAt = cells.findIndex((line) => line[0] === "Marketplace" && line[1] === "Product");

    expect(cells.length - headerAt - 1).toBe(25);
  });
});

describe("values match the dashboard", () => {
  test("numbers are written as numbers, not formatted strings", async () => {
    const cells = grid(await open(snapshot(), [row()]), "SOH Report");
    const headerAt = cells.findIndex((line) => line[0] === "Marketplace" && line[1] === "Product");
    const first = cells[headerAt + 1]!;

    expect(first[5]).toBe(7_918); // Current SOH
    expect(first[6]).toBe(4_403); // GRN
    expect(first[7]).toBe(8_776); // Sales Quantity
    expect(first[9]).toBe(0); // Damage
    expect(first[10]).toBe(0); // Returned
  });

  test("an absent figure stays a dash, and a real zero stays zero", async () => {
    const cells = grid(
      await open(snapshot(), [row({ grn: null, currentSoh: null, damage: 0 })]),
      "SOH Report",
    );
    const headerAt = cells.findIndex((line) => line[0] === "Marketplace" && line[1] === "Product");
    const first = cells[headerAt + 1]!;

    expect(first[5]).toBe(ABSENT);
    expect(first[6]).toBe(ABSENT);
    expect(first[9]).toBe(0);
  });

  test("status reads as words, not an enum", async () => {
    const cells = grid(await open(snapshot(), [row({ mappingStatus: "unresolved" })]), "SOH Report");
    const headerAt = cells.findIndex((line) => line[0] === "Marketplace" && line[1] === "Product");
    expect(cells[headerAt + 1]![11]).toBe("Needs Review");
  });

  test("quantities carry an Excel number format", async () => {
    const book = await open(snapshot(), [row()]);
    const sheet = book.Sheets["SOH Report"]!;
    const cells = grid(book, "SOH Report");
    const headerAt = cells.findIndex((line) => line[0] === "Marketplace" && line[1] === "Product");

    const soh = sheet[XLSX.utils.encode_cell({ r: headerAt + 1, c: 5 })] as { z?: string };
    const value = sheet[XLSX.utils.encode_cell({ r: headerAt + 1, c: 8 })] as { z?: string };

    expect(soh.z).toBe("#,##0");
    expect(value.z).toContain("₹");
  });
});

describe("summary sheet", () => {
  test("totals the rows it was given, and names the notes", async () => {
    const cells = grid(await open(snapshot(), [row()]), "Summary");
    const find = (label: string) => cells.find((line) => line[0] === label);

    expect(find("Marketplace")![1]).toBe("blinkit");
    expect(find("Current SOH")![1]).toBe(7_918);
    expect(find("GRN")![1]).toBe(4_403);
    expect(find("Sales Quantity")![1]).toBe(8_776);
    expect(find("Damage")![1]).toBe(0);
    expect(find("Returned")![1]).toBe(0);
    expect(find("Report status")![1]).toBe("Completed");
    expect(find("Notes")).toBeDefined();
  });

  test("a filtered export totals only what it contains", async () => {
    const view = snapshot({ rows: [row(), row({ id: "b", salesQuantity: 1_000 })] });
    const cells = grid(await open(view, [row()], "current"), "Summary");
    expect(cells.find((line) => line[0] === "Sales Quantity")![1]).toBe(8_776);
  });

  test("several marketplaces get a per-marketplace breakdown", async () => {
    const rows = [row({ marketplace: "blinkit" }), row({ id: "z", marketplace: "zepto" })];
    const view = snapshot({ marketplaces: ["blinkit", "zepto"], rows });
    const cells = grid(await open(view, rows), "Summary");

    expect(cells.find((line) => line[0] === "By marketplace")).toBeDefined();
    expect(cells.find((line) => line[0] === "zepto")).toBeDefined();
    expect(cells.find((line) => line[0] === "Marketplace" && line[1] === "All Marketplaces")).toBeDefined();
  });
});

describe("data quality sheet", () => {
  test("one line per marketplace with its real standing", async () => {
    const cells = grid(await open(snapshot(), [row()]), "Data Quality");
    const line = cells.find((entry) => entry[0] === "blinkit")!;

    expect(line[2]).toBe(16); // products
    expect(line[3]).toBe(12); // mapped
    expect(line[4]).toBe(4); // needs review
    expect(line[5]).toBe("ERP connected");
    expect(line[6]).toBe("GRN available");
    expect(line[7]).toBe("Completed");
  });
});

describe("file names", () => {
  test("say who, what and when", () => {
    expect(workbookFileName(snapshot(), "xlsx")).toBe(
      "Healthy-Master-SOH-blinkit-Jun-2026-Aug-2026.xlsx",
    );
  });

  test("mark a filtered export as filtered", () => {
    expect(workbookFileName(snapshot(), "xlsx", "current")).toContain("filtered");
  });

  test("name a multi-marketplace report for what it is", () => {
    const view = snapshot({ marketplaces: ["blinkit", "zepto"] });
    expect(workbookFileName(view, "xlsx")).toContain("All-Marketplaces");
  });
});

describe("terminology", () => {
  test("no sheet contains sell-in or sell-out", async () => {
    const book = await open(snapshot(), [row()]);
    for (const name of book.SheetNames) {
      const text = JSON.stringify(grid(book, name));
      expect(text).not.toMatch(/sell[\s-]?(in|out)/i);
    }
  });
});

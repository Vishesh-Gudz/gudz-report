import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { aggregateMonthly } from "@/lib/report/monthly";
import {
  ABSENT,
  EXPORT_COLUMNS,
  buildExport,
  exportFileName,
  exportRow,
  toCsv,
} from "@/lib/report/export";
import { totalsFor, type SnapshotRow } from "@/lib/report/snapshot-model";
import type { MappedExcelRow } from "@/lib/report/product-mapping";
import type { NormalizedExcelRow } from "@/types/excel";

/**
 * The report's contract with the business.
 *
 * These are the promises somebody will quote back: which columns exist, what a
 * missing figure looks like, and which words appear on screen. Each one is easy
 * to break by accident and impossible to notice afterwards — a column silently
 * dropped from an export, or a null rendered as a zero, both produce a file that
 * opens cleanly and says the wrong thing.
 */

function snapshotRow(overrides: Partial<SnapshotRow> = {}): SnapshotRow {
  return {
    id: "row_1",
    marketplace: "blinkit",
    month: "2026-06",
    productName: "Ragi Chips - 100 gm",
    sku: "RAGI-100",
    ean: "8906165850653",
    marketplaceItemId: "10180611",
    erpItemId: "item_1",
    currentSoh: 400,
    grn: null,
    salesQuantity: 120,
    salesValue: 12_000,
    damage: 0,
    returned: 0,
    mappingStatus: "matched",
    mappingReason: "Matched on barcode.",
    sourceRows: 9,
    ...overrides,
  };
}

function excelRow(overrides: Partial<NormalizedExcelRow> = {}): NormalizedExcelRow {
  return {
    sourceRow: 2,
    orderDate: "2026-06-15",
    marketplaceOrderId: null,
    marketplaceItemId: "10180611",
    sku: "8906165850653",
    barcode: "8906165850653",
    productName: "Ragi Chips",
    quantity: 10,
    unitPrice: 150,
    grossSales: 1500,
    rawStatus: null,
    normalizedStatus: "delivered",
    ...overrides,
  };
}

function mappedRow(row: NormalizedExcelRow, sku = "RAGI-100"): MappedExcelRow {
  return {
    row,
    mapping: {
      status: "mapped",
      route: "barcode",
      item: { itemId: "item_1", sku, name: "Ragi Chips - 100 gm", barcode: null },
      candidates: [],
      reason: "Matched on barcode.",
    },
    key: sku,
    keyIsErpSku: true,
  };
}

describe("Damage and Returned", () => {
  test("every export row carries both, at zero", () => {
    const cells = exportRow(snapshotRow());
    const damage = cells[EXPORT_COLUMNS.indexOf("Damage")];
    const returned = cells[EXPORT_COLUMNS.indexOf("Returned")];

    expect(damage).toBe(0);
    expect(returned).toBe(0);
  });

  test("they are carried, never derived from the other figures", () => {
    // A demo column that quietly started tracking sales would be worse than an
    // empty one: it would look like real data.
    const busy = snapshotRow({ salesQuantity: 9_999, currentSoh: 5_000, grn: 400 });
    const cells = exportRow(busy);

    expect(cells[EXPORT_COLUMNS.indexOf("Damage")]).toBe(0);
    expect(cells[EXPORT_COLUMNS.indexOf("Returned")]).toBe(0);
  });

  test("totals sum them without touching the stock figure", () => {
    const totals = totalsFor([snapshotRow(), snapshotRow({ id: "b", month: "2026-07" })]);

    expect(totals.damage).toBe(0);
    expect(totals.returned).toBe(0);
    // One product, one warehouse position, whatever the month count.
    expect(totals.currentSoh).toBe(400);
  });

  test("a non-zero value would survive, so the column is ready for a real source", () => {
    const totals = totalsFor([
      snapshotRow({ damage: 7, returned: 3 }),
      snapshotRow({ id: "b", damage: 2, returned: 1 }),
    ]);
    expect(totals.damage).toBe(9);
    expect(totals.returned).toBe(4);
  });
});

describe("the exported file", () => {
  test("has exactly the columns the business asked for, in order", () => {
    expect([...EXPORT_COLUMNS]).toEqual([
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

  test("every row has a cell for every column", () => {
    const table = buildExport([snapshotRow(), snapshotRow({ id: "b" })]);
    for (const line of table) expect(line).toHaveLength(EXPORT_COLUMNS.length);
  });

  test("an absent GRN exports as a dash, never as zero", () => {
    const cells = exportRow(snapshotRow({ grn: null }));
    expect(cells[EXPORT_COLUMNS.indexOf("GRN")]).toBe(ABSENT);
  });

  test("a recorded GRN of zero exports as zero", () => {
    // The distinction the dash exists to preserve.
    const cells = exportRow(snapshotRow({ grn: 0 }));
    expect(cells[EXPORT_COLUMNS.indexOf("GRN")]).toBe(0);
  });

  test("absent stock exports as a dash", () => {
    const cells = exportRow(snapshotRow({ currentSoh: null }));
    expect(cells[EXPORT_COLUMNS.indexOf("Current SOH")]).toBe(ABSENT);
  });

  test("exports the saved values, not recomputed ones", () => {
    const row = snapshotRow({ salesQuantity: 8_776, salesValue: 1_448_819.4 });
    const cells = exportRow(row);
    expect(cells[EXPORT_COLUMNS.indexOf("Sales Quantity")]).toBe(8_776);
    expect(cells[EXPORT_COLUMNS.indexOf("Sales Value")]).toBe(1_448_819);
  });

  test("a product name containing a comma stays one column", () => {
    const csv = toCsv([snapshotRow({ productName: 'Chips, "Masala" 100g' })]);
    const line = csv.split("\r\n")[1]!;
    expect(line).toContain('"Chips, ""Masala"" 100g"');
    // Header plus one row, and no stray line break from the quoting.
    expect(csv.split("\r\n")).toHaveLength(2);
  });

  test("names the file after the report rather than the download", () => {
    expect(exportFileName("Blinkit", "2026-06-01", 0, "csv")).toBe(
      "soh-report-blinkit-2026-06-01.csv",
    );
    expect(exportFileName("All (6)", "2026-06-01", 0, "xlsx")).toBe(
      "soh-report-all-6-2026-06-01.xlsx",
    );
  });
});

describe("monthly sales quantity", () => {
  test("splits a product's sales across the months it sold in", () => {
    const result = aggregateMonthly(
      [
        mappedRow(excelRow({ orderDate: "2026-06-05", quantity: 10, grossSales: 1_000 })),
        mappedRow(excelRow({ orderDate: "2026-07-11", quantity: 4, grossSales: 400 })),
        mappedRow(excelRow({ orderDate: "2026-07-29", quantity: 6, grossSales: 600 })),
      ],
      new Set(),
    );

    expect(result.months).toEqual(["2026-06", "2026-07"]);
    expect(result.rows.find((row) => row.month === "2026-07")!.salesQuantity).toBe(10);
  });

  test("counts each source row once", () => {
    const rows = Array.from({ length: 120 }, (_, index) =>
      mappedRow(excelRow({ sourceRow: index + 2, quantity: 1, grossSales: 10 })),
    );
    const result = aggregateMonthly(rows, new Set());
    expect(result.salesQuantity).toBe(120);
    expect(result.rows).toHaveLength(1);
  });
});

describe("marketplace rows stay distinct", () => {
  test("the same product on two marketplaces is two rows, counted once each", () => {
    const rows = [
      snapshotRow({ id: "a", marketplace: "blinkit", salesQuantity: 100 }),
      snapshotRow({ id: "b", marketplace: "zepto", salesQuantity: 40 }),
    ];
    const totals = totalsFor(rows);

    expect(totals.products).toBe(2);
    expect(totals.marketplaces).toBe(2);
    expect(totals.salesQuantity).toBe(140);
    // One ERP item behind both, so the warehouse is not doubled.
    expect(totals.currentSoh).toBe(400);
  });

  test("filtering to one marketplace totals only that marketplace", () => {
    const rows = [
      snapshotRow({ id: "a", marketplace: "blinkit", salesQuantity: 100 }),
      snapshotRow({ id: "b", marketplace: "zepto", salesQuantity: 40 }),
    ];
    const blinkit = rows.filter((row) => row.marketplace === "blinkit");

    expect(totalsFor(blinkit).salesQuantity).toBe(100);
    expect(totalsFor(blinkit).marketplaces).toBe(1);
    // Damage and Returned survive a filtered view.
    expect(totalsFor(blinkit).damage).toBe(0);
    expect(totalsFor(blinkit).returned).toBe(0);
  });
});

/**
 * Walks the shipped source for wording the mentor asked to be removed.
 *
 * A grep rather than a render test because the terms could reappear anywhere —
 * a filter label, an empty state, an error message — and the point is that none
 * of those places has them.
 */
function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(entry)) found.push(path);
  }
  return found;
}

describe("terminology", () => {
  test("no user-facing string says sell-in or sell-out", () => {
    // `selling price` is a real column in the marketplace exports, and the
    // vocabulary module explains in a comment why the terms were dropped.
    const offenders: string[] = [];

    for (const file of [...sourceFiles("src/app"), ...sourceFiles("src/components")]) {
      const contents = readFileSync(file, "utf8");
      for (const line of contents.split("\n")) {
        if (!/sell[\s-]?(in|out)/i.test(line)) continue;
        if (/selling price|reported selling/i.test(line)) continue;
        offenders.push(`${file}: ${line.trim()}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  test("the export headers use the business's words", () => {
    const header = buildExport([])[0]!.join(" ");
    expect(header).toContain("Current SOH");
    expect(header).toContain("GRN");
    expect(header).toContain("Sales Quantity");
    expect(header).toContain("Damage");
    expect(header).toContain("Returned");
    expect(header).not.toMatch(/sell[\s-]?(in|out)/i);
  });
});

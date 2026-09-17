import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { aggregateMonthly } from "@/lib/report/monthly";
import { totalsFor, type SnapshotRow } from "@/lib/report/snapshot-model";
import type { MappedExcelRow } from "@/lib/report/product-mapping";
import type { NormalizedExcelRow } from "@/types/excel";

/**
 * Monthly aggregation, and the arithmetic it must not get wrong.
 *
 * Two mistakes here are invisible on screen. Sales counted twice looks like a
 * good month; one product's stock added once per month looks like a full
 * warehouse. Both are plausible numbers, which is exactly why they are pinned.
 *
 * The third is semantic: a missing figure must stay null all the way to the
 * column. Collapsing null to zero turns "no goods receipt was raised" into "a
 * goods receipt was raised and recorded nothing".
 */

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

function mapped(
  row: NormalizedExcelRow,
  options: { sku?: string | null; itemId?: string; status?: "mapped" | "unmapped" } = {},
): MappedExcelRow {
  const isMapped = (options.status ?? "mapped") === "mapped";
  const sku = options.sku ?? "RAGI-100";
  return {
    row,
    mapping: {
      status: isMapped ? "mapped" : "unmapped",
      route: isMapped ? "barcode" : null,
      item: isMapped
        ? {
            itemId: options.itemId ?? "item_1",
            sku,
            name: "Ragi Chips - 100 gm",
            barcode: null,
          }
        : null,
      candidates: [],
      reason: isMapped ? "Matched on barcode." : "No identifier matched.",
    },
    key: isMapped ? sku : (row.barcode ?? "unknown"),
    keyIsErpSku: isMapped,
  };
}

const NO_CONFIRMATIONS = new Set<string>();

describe("monthly grouping", () => {
  test("splits one product's sales across the months it sold in", () => {
    const result = aggregateMonthly(
      [
        mapped(excelRow({ orderDate: "2026-06-05", quantity: 10, grossSales: 1000 })),
        mapped(excelRow({ orderDate: "2026-06-20", quantity: 5, grossSales: 500 })),
        mapped(excelRow({ orderDate: "2026-07-02", quantity: 8, grossSales: 800 })),
        mapped(excelRow({ orderDate: "2026-08-30", quantity: 2, grossSales: 200 })),
      ],
      NO_CONFIRMATIONS,
    );

    expect(result.months).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(result.rows).toHaveLength(3);

    const june = result.rows.find((row) => row.month === "2026-06")!;
    expect(june.salesQuantity).toBe(15);
    expect(june.salesValue).toBe(1500);
    expect(june.sourceRows).toBe(2);
  });

  test("counts every source row exactly once", () => {
    const rows = Array.from({ length: 250 }, (_, index) =>
      mapped(excelRow({ sourceRow: index + 2, quantity: 1, grossSales: 100 })),
    );
    const result = aggregateMonthly(rows, NO_CONFIRMATIONS);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.salesQuantity).toBe(250);
    expect(result.rows[0]!.sourceRows).toBe(250);
    expect(result.salesQuantity).toBe(250);
  });

  test("keeps two products apart in the same month", () => {
    const result = aggregateMonthly(
      [
        mapped(excelRow({ quantity: 10 })),
        mapped(excelRow({ quantity: 4, barcode: "8906165850677", sku: "8906165850677" }), {
          sku: "PALAK-100",
          itemId: "item_2",
        }),
      ],
      NO_CONFIRMATIONS,
    );

    expect(result.rows).toHaveLength(2);
    expect(result.distinctProducts).toBe(2);
  });

  test("a row with no readable date is reported, not folded into a month", () => {
    // A sheet with broken dates should look broken rather than lopsided.
    const result = aggregateMonthly(
      [mapped(excelRow({ orderDate: null, quantity: 7 }))],
      NO_CONFIRMATIONS,
    );

    expect(result.undatedRows).toBe(1);
    expect(result.months).toEqual([]);
    expect(result.rows[0]!.month).toBeNull();
    expect(result.rows[0]!.salesQuantity).toBe(7);
  });

  test("an unresolved product still contributes its sales", () => {
    const result = aggregateMonthly(
      [mapped(excelRow({ quantity: 9 }), { status: "unmapped" })],
      NO_CONFIRMATIONS,
    );

    expect(result.unresolvedProducts).toBe(1);
    expect(result.mappedProducts).toBe(0);
    expect(result.rows[0]!.mappingStatus).toBe("unresolved");
    expect(result.rows[0]!.salesQuantity).toBe(9);
  });

  test("a confirmed mapping is marked as confirmed, not merely matched", () => {
    const result = aggregateMonthly([mapped(excelRow())], new Set(["RAGI-100"]));
    expect(result.rows[0]!.mappingStatus).toBe("confirmed");
  });
});

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
    salesQuantity: 10,
    salesValue: 1000,
    damage: 0,
    returned: 0,
    mappingStatus: "matched",
    mappingReason: "Matched on barcode.",
    sourceRows: 3,
    ...overrides,
  };
}

describe("report totals", () => {
  test("one product's stock is counted once across its months", () => {
    // The trap: three months of one product, one warehouse position. A per-row
    // sum would treble the stock.
    const totals = totalsFor([
      snapshotRow({ id: "a", month: "2026-06", currentSoh: 400 }),
      snapshotRow({ id: "b", month: "2026-07", currentSoh: 400 }),
      snapshotRow({ id: "c", month: "2026-08", currentSoh: 400 }),
    ]);

    expect(totals.currentSoh).toBe(400);
    expect(totals.rows).toBe(3);
    expect(totals.products).toBe(1);
  });

  test("the same product on two marketplaces counts as two products", () => {
    const totals = totalsFor([
      snapshotRow({ id: "a", marketplace: "blinkit", salesQuantity: 10 }),
      snapshotRow({ id: "b", marketplace: "zepto", salesQuantity: 6 }),
    ]);

    expect(totals.products).toBe(2);
    expect(totals.marketplaces).toBe(2);
    expect(totals.salesQuantity).toBe(16);
    // One ERP item behind both, so one stock position.
    expect(totals.currentSoh).toBe(400);
  });

  test("sales quantity sums every row", () => {
    const totals = totalsFor([
      snapshotRow({ id: "a", salesQuantity: 10, salesValue: 1000 }),
      snapshotRow({ id: "b", month: "2026-07", salesQuantity: 5, salesValue: 500 }),
    ]);
    expect(totals.salesQuantity).toBe(15);
    expect(totals.salesValue).toBe(1500);
  });
});

describe("absent figures stay absent", () => {
  test("GRN totals null when no row carries one", () => {
    // Null renders as an em dash. Zero would claim a goods receipt was raised
    // and recorded nothing.
    const totals = totalsFor([snapshotRow({ grn: null }), snapshotRow({ id: "b", grn: null })]);
    expect(totals.grn).toBeNull();
  });

  test("GRN totals only the rows that actually have one", () => {
    const totals = totalsFor([
      snapshotRow({ id: "a", grn: 120 }),
      snapshotRow({ id: "b", grn: null }),
      snapshotRow({ id: "c", grn: 30 }),
    ]);
    expect(totals.grn).toBe(150);
  });

  test("a recorded zero is kept as zero, not turned into an absence", () => {
    const totals = totalsFor([snapshotRow({ grn: 0 })]);
    expect(totals.grn).toBe(0);
  });

  test("stock totals null when no product has a position", () => {
    const totals = totalsFor([snapshotRow({ currentSoh: null })]);
    expect(totals.currentSoh).toBeNull();
  });

  test("damage and returned are carried, not invented", () => {
    const totals = totalsFor([snapshotRow(), snapshotRow({ id: "b" })]);
    expect(totals.damage).toBe(0);
    expect(totals.returned).toBe(0);
  });
});

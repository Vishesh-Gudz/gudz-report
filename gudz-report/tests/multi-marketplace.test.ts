import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildSohRows, totalsFor, type SohProductRow } from "@/lib/report/soh-rows";
import type { MarketplaceSection, SohReport } from "@/lib/report/soh-report";
import type { SkuReconciliationRow } from "@/lib/report/sku-reconciliation";
import { emptyStockSnapshot } from "@/lib/report/stock";
import type { StockPosition } from "@/lib/report/stock";

/**
 * One upload, several marketplaces, counted exactly once each.
 *
 * The failure this file exists to prevent is silent arithmetic. A product sold
 * on Blinkit and on Zepto is two records with two sell-out figures; pooled on
 * SKU they would become one, and the report would describe a product that
 * exists nowhere. Its warehouse stock is the opposite problem — one position
 * behind both records, so summing it per row would treble the warehouse.
 *
 * Neither mistake shows on screen. Both are arithmetic that looks plausible.
 */

function skuRow(overrides: Partial<SkuReconciliationRow> = {}): SkuReconciliationRow {
  return {
    sku: "RAGI-100",
    erpItemId: "item_1",
    ean: "8906165850653",
    marketplaceItemId: "10180611",
    productName: "Ragi Chips 100 gm",
    status: "variance",
    erpOrders: 1,
    erpLines: 1,
    erpQuantity: 100,
    erpRevenue: 10_000,
    excelRows: 5,
    excelQuantity: 150,
    excelRevenue: 15_000,
    quantityVariance: 50,
    amountVariance: 5_000,
    quantityVariancePct: 0.5,
    amountVariancePct: 0.5,
    mappedToErp: true,
    erpOrderRefs: [],
    excelRowRefs: [],
    ...overrides,
  };
}

function section(overrides: Partial<MarketplaceSection> = {}): MarketplaceSection {
  return {
    marketplace: "blinkit",
    sheetName: "Blinkit",
    status: "completed",
    error: null,
    period: null,
    rows: [skuRow()],
    mapping: null,
    sheetRows: 5,
    sellOutQuantity: 150,
    sellOutRevenue: 15_000,
    erpState: "reconciled",
    erpMessage: null,
    erpOrders: 1,
    erpLines: 1,
    sellInQuantity: 100,
    sellInRevenue: 10_000,
    gstins: ["29AAFCG9846E1Z7"],
    unresolvedProducts: 0,
    mappedProducts: 1,
    totalProducts: 1,
    unresolvedRows: [],
    ...overrides,
  };
}

function position(overrides: Partial<StockPosition> = {}): StockPosition {
  return {
    itemId: "item_1",
    sku: "RAGI-100",
    name: "Ragi Chips 100 gm",
    onHand: 500,
    blocked: 100,
    available: 400,
    locations: [],
    updatedAt: null,
    ...overrides,
  };
}

function report(sections: MarketplaceSection[], stock?: Map<string, StockPosition>): SohReport {
  return {
    importId: "import_1",
    fileName: "HM Sales Dump.xlsx",
    uploadedAt: 0,
    sections,
    marketplaces: sections.map((entry) => entry.marketplace),
    period: null,
    periodsDiffer: sections.length > 1,
    stock: stock
      ? { ...emptyStockSnapshot(), byItemId: stock, itemsFound: stock.size, available: true }
      : emptyStockSnapshot(),
    stockAvailable: Boolean(stock),
    stockError: null,
    erpAvailable: true,
    warnings: [],
    historyReason: "unavailable",
  };
}

const NO_CONFIRMATIONS = new Map<string, Set<string>>();

describe("marketplace identity survives", () => {
  test("the same product on two marketplaces is two rows, not one", () => {
    const rows = buildSohRows(
      report([
        section({ marketplace: "blinkit" }),
        section({ marketplace: "zepto", rows: [skuRow({ excelQuantity: 70 })] }),
      ]),
      NO_CONFIRMATIONS,
    );

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.marketplace)).toEqual(["blinkit", "zepto"]);
    // Same SKU, different rows: the id is what keeps them apart.
    expect(rows[0]!.sku).toBe(rows[1]!.sku);
    expect(rows[0]!.id).not.toBe(rows[1]!.id);
  });

  test("each marketplace keeps its own period", () => {
    const rows = buildSohRows(
      report([
        section({
          marketplace: "blinkit",
          period: {
            fromDay: "2026-06-01",
            toDay: "2026-08-31",
            fromIso: "",
            toIso: "",
          },
        }),
        section({
          marketplace: "bigbasket",
          period: {
            fromDay: "2026-06-09",
            toDay: "2026-09-02",
            fromIso: "",
            toIso: "",
          },
        }),
      ]),
      NO_CONFIRMATIONS,
    );

    expect(rows[0]!.periodTo).toBe("2026-08-31");
    expect(rows[1]!.periodTo).toBe("2026-09-02");
  });

  test("a confirmation on one marketplace does not badge another", () => {
    // Confirmations are per marketplace because the same EAN means a different
    // pack on each channel.
    const confirmed = new Map<string, Set<string>>([["blinkit", new Set(["RAGI-100"])]]);
    const rows = buildSohRows(
      report([section({ marketplace: "blinkit" }), section({ marketplace: "zepto" })]),
      confirmed,
    );

    expect(rows[0]!.mapping).toBe("confirmed");
    expect(rows[1]!.mapping).toBe("matched");
  });

  test("a failed sheet contributes no rows but is kept in the report", () => {
    const failed = section({
      marketplace: "zepto",
      status: "failed",
      error: "Sheet \"Zepto\" has no data rows below header row 1.",
      rows: [],
    });
    const model = report([section({ marketplace: "blinkit" }), failed]);
    const rows = buildSohRows(model, NO_CONFIRMATIONS);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.marketplace).toBe("blinkit");
    // Reported rather than discarded: a sheet that silently vanished is
    // indistinguishable from one the workbook never had.
    expect(model.sections.find((entry) => entry.marketplace === "zepto")?.error).toMatch(
      /no data rows/,
    );
  });
});

describe("no double counting", () => {
  test("sell-out is summed once per marketplace record", () => {
    const totals = totalsFor(
      buildSohRows(
        report([
          section({ marketplace: "blinkit", rows: [skuRow({ excelQuantity: 150 })] }),
          section({ marketplace: "zepto", rows: [skuRow({ excelQuantity: 70 })] }),
        ]),
        NO_CONFIRMATIONS,
      ),
    );

    expect(totals.sellOut).toBe(220);
    expect(totals.products).toBe(2);
    expect(totals.marketplaces).toBe(2);
  });

  test("one product's stock is counted once however many marketplaces sell it", () => {
    // The trap: three marketplaces, one warehouse position, and a per-row sum
    // would report three times the stock that exists.
    const stock = new Map([["item_1", position({ available: 400 })]]);
    const totals = totalsFor(
      buildSohRows(
        report(
          [
            section({ marketplace: "blinkit" }),
            section({ marketplace: "zepto" }),
            section({ marketplace: "swiggy" }),
          ],
          stock,
        ),
        NO_CONFIRMATIONS,
      ),
    );

    expect(totals.stockAvailable).toBe(400);
    expect(totals.stockProducts).toBe(1);
  });

  test("distinct products each contribute their own stock", () => {
    const stock = new Map([
      ["item_1", position({ itemId: "item_1", available: 400 })],
      ["item_2", position({ itemId: "item_2", available: 250 })],
    ]);
    const totals = totalsFor(
      buildSohRows(
        report(
          [
            section({
              marketplace: "blinkit",
              rows: [skuRow(), skuRow({ sku: "PALAK-100", erpItemId: "item_2" })],
            }),
          ],
          stock,
        ),
        NO_CONFIRMATIONS,
      ),
    );

    expect(totals.stockAvailable).toBe(650);
    expect(totals.stockProducts).toBe(2);
  });

  test("totals of a filtered view describe only that view", () => {
    const rows = buildSohRows(
      report([
        section({ marketplace: "blinkit", rows: [skuRow({ excelQuantity: 150 })] }),
        section({ marketplace: "zepto", rows: [skuRow({ excelQuantity: 70 })] }),
      ]),
      NO_CONFIRMATIONS,
    );

    const blinkitOnly = rows.filter((row) => row.marketplace === "blinkit");
    expect(totalsFor(blinkitOnly).sellOut).toBe(150);
    expect(totalsFor(rows).sellOut).toBe(220);
  });
});

describe("marketplaces without ERP configuration", () => {
  const mixed = report([
    section({ marketplace: "blinkit", erpState: "reconciled" }),
    section({
      marketplace: "zepto",
      erpState: "notConfigured",
      erpMessage: "No ERP customer is configured for this marketplace.",
      sellInQuantity: 0,
      sellInRevenue: 0,
      rows: [skuRow({ erpQuantity: 0, erpRevenue: 0, excelQuantity: 70, status: "excelOnly" })],
    }),
  ]);

  test("sell-in is null, never zero, when no ERP customer is configured", () => {
    // Zero would read as "we invoiced nothing", which is a claim this report is
    // in no position to make.
    const rows = buildSohRows(mixed, NO_CONFIRMATIONS);
    const zepto = rows.find((row) => row.marketplace === "zepto")!;

    expect(zepto.sellIn).toBeNull();
    expect(zepto.sellInRevenue).toBeNull();
    expect(zepto.quantityVariance).toBeNull();
    expect(zepto.erpState).toBe("notConfigured");
  });

  test("its sell-out still counts toward the total", () => {
    const totals = totalsFor(buildSohRows(mixed, NO_CONFIRMATIONS));
    expect(totals.sellOut).toBe(220);
  });

  test("its absent sell-in does not drag the sell-in total down", () => {
    const totals = totalsFor(buildSohRows(mixed, NO_CONFIRMATIONS));
    expect(totals.sellIn).toBe(100);
    expect(totals.reconciledMarketplaces).toBe(1);
  });

  test("an unreachable ERP is reported differently from an unconfigured one", () => {
    const rows = buildSohRows(
      report([section({ marketplace: "swiggy", erpState: "unavailable" })]),
      NO_CONFIRMATIONS,
    );
    expect(rows[0]!.erpState).toBe("unavailable");
    expect(rows[0]!.sellIn).toBeNull();
  });
});

describe("row identity", () => {
  test("every row has a key unique across the whole report", () => {
    const rows: SohProductRow[] = buildSohRows(
      report([
        section({
          marketplace: "blinkit",
          rows: [skuRow(), skuRow({ sku: "PALAK-100" })],
        }),
        section({
          marketplace: "zepto",
          rows: [skuRow(), skuRow({ sku: "PALAK-100" })],
        }),
      ]),
      NO_CONFIRMATIONS,
    );

    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
  });
});

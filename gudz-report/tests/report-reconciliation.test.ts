import { describe, expect, test } from "vitest";

import { MarketplaceIndex } from "@/lib/report/attribution";
import { buildReportModel, filterLines } from "@/lib/report/aggregate";
import { reconcile } from "@/lib/report/matching";
import { monthPeriod } from "@/lib/dates/reporting-period";
import type { SalesOrderLine } from "@/types/erp";
import type { NormalizedExcelRow } from "@/types/excel";

/**
 * Excel ↔ ERP reconciliation and the numbers derived from it.
 *
 * The rule under test throughout: nothing is matched on a guess and nothing is
 * dropped. A reconciliation that quietly discards what it cannot explain
 * balances perfectly and is worthless.
 */

const PERIOD = monthPeriod("2026-08");
const BLINKIT = "29AABCB1234C1ZX";

const marketplaces = new MarketplaceIndex([
  { marketplace: "blinkit", customerGstins: [BLINKIT] },
]);

function erpLine(overrides: Partial<SalesOrderLine> = {}): SalesOrderLine {
  return {
    salesOrderId: "so_1",
    soNumber: "SO-1",
    referenceNumber: null,
    orderDate: "2026-08-14T00:00:00.000Z",
    dispatchedAt: null,
    deliveredAt: null,
    status: "approved",
    orderType: "product",
    channel: null,
    channelNormalized: null,
    customerId: "cust_1",
    customerName: "BLINK COMMERCE PRIVATE LIMITED",
    customerCode: "CUST-BLINKIT",
    customerType: "BUSINESS",
    customerGstin: BLINKIT,
    sourceHubId: "hub_1",
    salesOrderItemId: "soi_1",
    itemId: "item_1",
    sku: "HM-KHK-100",
    name: "Quinoa Khakhra 100g",
    unit: "pcs",
    hsnCode: null,
    orderedQuantity: 100,
    shippedQuantity: 0,
    deliveredQuantity: 0,
    unitPrice: 42,
    lineTotal: 4200,
    taxableValue: 4200,
    taxAmount: 210,
    fulfillmentSku: null,
    fulfillmentQuantity: null,
    ...overrides,
  };
}

function excelRow(overrides: Partial<NormalizedExcelRow> = {}): NormalizedExcelRow {
  return {
    sourceRow: 2,
    orderDate: "2026-08-14",
    marketplaceOrderId: "MP-1",
    marketplaceItemId: null,
    sku: "HM-KHK-100",
    barcode: null,
    productName: "Quinoa Khakhra",
    quantity: 100,
    unitPrice: 42,
    grossSales: 4200,
    rawStatus: "Delivered",
    normalizedStatus: "delivered",
    ...overrides,
  };
}

describe("matching", () => {
  test("matches on SKU and reports the strategy used", () => {
    const result = reconcile([excelRow()], [erpLine()], marketplaces);

    expect(result.counts.matched).toBe(1);
    expect(result.pairs[0]?.status).toBe("matched");
    expect(result.pairs[0]?.strategy).toBe("sku");
    expect(result.pairs[0]?.erpLine?.salesOrderItemId).toBe("soi_1");
  });

  test("folds case and whitespace on the identifier", () => {
    const result = reconcile(
      [excelRow({ sku: "  hm-khk-100 " })],
      [erpLine()],
      marketplaces,
    );
    expect(result.counts.matched).toBe(1);
  });

  test("prefers the marketplace item id over SKU when both are present", () => {
    const result = reconcile(
      [excelRow({ marketplaceItemId: "item_1" })],
      [erpLine()],
      marketplaces,
    );
    expect(result.pairs[0]?.strategy).toBe("marketplaceItemId");
  });

  test("reports ambiguity rather than picking one of several candidates", () => {
    // Which of two ERP lines a spreadsheet row belongs to is a question for a
    // human; picking the first would attribute revenue arbitrarily.
    const result = reconcile(
      [excelRow()],
      [erpLine(), erpLine({ salesOrderItemId: "soi_2", salesOrderId: "so_2" })],
      marketplaces,
    );

    expect(result.pairs[0]?.status).toBe("ambiguous");
    expect(result.pairs[0]?.candidateCount).toBe(2);
    expect(result.pairs[0]?.erpLine).toBeNull();
    expect(result.counts.ambiguous).toBe(1);
  });

  test("keeps an unmatched row and says why", () => {
    const noMatch = reconcile([excelRow({ sku: "UNKNOWN" })], [erpLine()], marketplaces);
    expect(noMatch.pairs[0]?.status).toBe("unmatched");
    expect(noMatch.pairs[0]?.reason).toBe("noErpLine");

    const noId = reconcile(
      [excelRow({ sku: null, barcode: null, marketplaceItemId: null })],
      [erpLine()],
      marketplaces,
    );
    expect(noId.pairs[0]?.reason).toBe("noIdentifier");
  });

  test("never drops a row — every Excel row appears in the result", () => {
    const rows = [
      excelRow({ sourceRow: 2 }),
      excelRow({ sourceRow: 3, sku: "UNKNOWN" }),
      excelRow({ sourceRow: 4, sku: null }),
    ];
    const result = reconcile(rows, [erpLine()], marketplaces);
    expect(result.pairs).toHaveLength(3);
    expect(result.counts.excelRows).toBe(3);
  });

  test("excludes draft ERP lines from matching", () => {
    // A draft is not business, so a spreadsheet row must not reconcile against
    // one and appear matched.
    const result = reconcile(
      [excelRow()],
      [erpLine({ status: "draft" })],
      marketplaces,
    );
    expect(result.counts.matched).toBe(0);
    expect(result.pairs[0]?.reason).toBe("noErpLine");
    expect(result.counts.erpOnly).toBe(0);
  });

  test("one SKU on two ERP lines is ambiguous, not silently assigned", () => {
    // The realistic version of this: the same product sold on two orders in the
    // period. Picking either would attribute the spreadsheet row arbitrarily.
    const result = reconcile(
      [excelRow()],
      [
        erpLine({ salesOrderItemId: "soi_1" }),
        erpLine({ salesOrderItemId: "soi_4", salesOrderId: "so_4", soNumber: "SO-4" }),
      ],
      marketplaces,
    );

    expect(result.counts.ambiguous).toBe(1);
    expect(result.counts.matched).toBe(0);
    // Neither candidate is consumed, so both still show as ERP-only.
    expect(result.counts.erpOnly).toBe(2);
  });

  test("an ERP line with no Excel row is reported separately", () => {
    // A different problem from an unmatched Excel row: it points at the other
    // system, so collapsing the two into one "variance" hides where to look.
    const result = reconcile([], [erpLine()], marketplaces);
    expect(result.counts.erpOnly).toBe(1);
    expect(result.erpOnly[0]?.attribution.marketplace).toBe("blinkit");
  });

  test("a matched ERP line is not also counted as ERP-only", () => {
    const result = reconcile([excelRow()], [erpLine()], marketplaces);
    expect(result.counts.matched).toBe(1);
    expect(result.counts.erpOnly).toBe(0);
  });
});

describe("variances", () => {
  test("quantity variance is Excel minus ERP ordered quantity", () => {
    const result = reconcile(
      [excelRow({ quantity: 110 })],
      [erpLine({ orderedQuantity: 100 })],
      marketplaces,
    );
    expect(result.pairs[0]?.quantityVariance).toBe(10);
  });

  test("uses orderedQuantity, not shipped or delivered", () => {
    // The ERP line below is approved with shipped/delivered at zero — the
    // production shape. Deriving from those would report a variance of +100.
    const result = reconcile(
      [excelRow({ quantity: 100 })],
      [erpLine({ orderedQuantity: 100, shippedQuantity: 0, deliveredQuantity: 0 })],
      marketplaces,
    );
    expect(result.pairs[0]?.quantityVariance).toBe(0);
  });

  test("amount variance is Excel gross sales minus ERP line total", () => {
    const result = reconcile(
      [excelRow({ grossSales: 4000 })],
      [erpLine({ lineTotal: 4200 })],
      marketplaces,
    );
    expect(result.pairs[0]?.amountVariance).toBe(-200);
  });

  test("a missing Excel number yields a null variance, not zero", () => {
    // Null means "the sheet did not say"; zero means "the sheet said they agree".
    const result = reconcile(
      [excelRow({ quantity: null, grossSales: null })],
      [erpLine()],
      marketplaces,
    );
    expect(result.pairs[0]?.quantityVariance).toBeNull();
    expect(result.pairs[0]?.amountVariance).toBeNull();
  });
});

describe("report model", () => {
  const erpLines = [
    erpLine({ salesOrderItemId: "soi_1", sku: "HM-KHK-100", orderedQuantity: 100, lineTotal: 4200 }),
    erpLine({
      salesOrderItemId: "soi_2",
      salesOrderId: "so_2",
      soNumber: "SO-2",
      sku: "HM-NDL-200",
      name: "Ragi Noodles 200g",
      orderedQuantity: 50,
      unitPrice: 80,
      lineTotal: 4000,
    }),
    // Draft: must not reach any total.
    erpLine({
      salesOrderItemId: "soi_3",
      salesOrderId: "so_3",
      soNumber: "SO-3",
      status: "draft",
      orderedQuantity: 999,
      lineTotal: 99_999,
    }),
    // No GSTIN: Unattributed, but still counted.
    erpLine({
      salesOrderItemId: "soi_4",
      salesOrderId: "so_4",
      soNumber: "SO-4",
      customerGstin: null,
      customerId: "cust_vending",
      customerName: "AGI Vending Machine",
      // A distinct SKU on purpose. Sharing HM-KHK-100 with soi_1 would make the
      // Excel row ambiguous — correctly, since the matcher refuses to choose
      // between two candidates — and that case is covered on its own below.
      sku: "HM-BAR-050",
      name: "Protein Bar 50g",
      orderedQuantity: 10,
      lineTotal: 420,
    }),
  ];

  const model = buildReportModel({
    period: PERIOD,
    erpLines,
    reconciliation: reconcile([excelRow({ quantity: 110, grossSales: 4600 })], erpLines, marketplaces),
    marketplaces,
  });

  test("KPI totals exclude drafts", () => {
    // Three reportable lines: 100 + 50 + 10 units, 4200 + 4000 + 420.
    expect(model.kpis.unitsOrdered).toBe(160);
    expect(model.kpis.revenue).toBe(8620);
    expect(model.kpis.orders).toBe(3);
  });

  test("counts orders and customers by identity, not by line", () => {
    // so_1 and so_4 are distinct orders; the draft so_3 is not counted at all.
    expect(model.kpis.orders).toBe(3);
    // The Blinkit GSTIN and the vending machine's customer id.
    expect(model.kpis.customers).toBe(2);
  });

  test("surfaces unattributed lines rather than hiding them", () => {
    expect(model.kpis.unattributedLines).toBe(1);
    expect(model.marketplaces).toContain("Unattributed");
    expect(model.marketplaces).toContain("blinkit");
  });

  test("reports matched and ERP-only lines separately", () => {
    expect(model.kpis.matchedLines).toBe(1);
    // soi_2 and soi_4 are reportable but have no Excel row.
    expect(model.kpis.erpOnlyLines).toBe(2);
    // The draft never appears in either bucket.
    expect(model.lines.some((row) => row.soNumber === "SO-3")).toBe(false);
  });

  test("product summary groups by SKU and totals both sides", () => {
    const khakhra = model.products.find((row) => row.sku === "HM-KHK-100");
    expect(khakhra).toBeDefined();
    // soi_1: ERP 100 @ 4200, matched against an Excel row claiming 110 @ 4600.
    expect(khakhra?.erpQuantity).toBe(100);
    expect(khakhra?.excelQuantity).toBe(110);
    expect(khakhra?.erpRevenue).toBe(4200);
    expect(khakhra?.excelRevenue).toBe(4600);
    expect(khakhra?.quantityVariance).toBe(10);
    expect(khakhra?.amountVariance).toBe(400);
    expect(khakhra?.orders).toBe(1);
  });

  test("orders products by ERP revenue so the biggest variance is visible first", () => {
    expect(model.products[0]?.erpRevenue).toBeGreaterThanOrEqual(
      model.products[1]?.erpRevenue ?? 0,
    );
  });

  test("an unmatched Excel row appears in the data-quality list with its row number", () => {
    const withUnmatched = buildReportModel({
      period: PERIOD,
      erpLines,
      reconciliation: reconcile(
        [excelRow({ sourceRow: 42, sku: "NOT-IN-ERP" })],
        erpLines,
        marketplaces,
      ),
      marketplaces,
    });

    expect(withUnmatched.unmatched).toHaveLength(1);
    expect(withUnmatched.unmatched[0]?.sourceRow).toBe(42);
    expect(withUnmatched.unmatched[0]?.reason).toMatch(/No ERP line/i);
  });

  test("with no Excel import every line is ERP-only and totals still hold", () => {
    const erpOnly = buildReportModel({
      period: PERIOD,
      erpLines,
      reconciliation: reconcile([], erpLines, marketplaces),
      marketplaces,
    });

    expect(erpOnly.kpis.revenue).toBe(8620);
    expect(erpOnly.kpis.matchedLines).toBe(0);
    expect(erpOnly.lines.every((row) => row.matchStatus === "erpOnly")).toBe(true);
  });
});

describe("filters", () => {
  const lines = buildReportModel({
    period: PERIOD,
    erpLines: [
      erpLine({ salesOrderItemId: "a", sku: "HM-KHK-100" }),
      erpLine({
        salesOrderItemId: "b",
        salesOrderId: "so_2",
        sku: "HM-NDL-200",
        name: "Ragi Noodles 200g",
        customerGstin: null,
        customerName: "AGI Vending Machine",
      }),
    ],
    reconciliation: reconcile(
      [],
      [
        erpLine({ salesOrderItemId: "a", sku: "HM-KHK-100" }),
        erpLine({
          salesOrderItemId: "b",
          salesOrderId: "so_2",
          sku: "HM-NDL-200",
          name: "Ragi Noodles 200g",
          customerGstin: null,
          customerName: "AGI Vending Machine",
        }),
      ],
      marketplaces,
    ),
    marketplaces,
  }).lines;

  test("filters by marketplace exactly", () => {
    expect(filterLines(lines, { marketplace: "blinkit" })).toHaveLength(1);
    expect(filterLines(lines, { marketplace: "Unattributed" })).toHaveLength(1);
  });

  test("filters by SKU, customer and product as case-insensitive substrings", () => {
    expect(filterLines(lines, { sku: "khk" })).toHaveLength(1);
    expect(filterLines(lines, { customer: "vending" })).toHaveLength(1);
    expect(filterLines(lines, { product: "noodles" })).toHaveLength(1);
  });

  test("combines filters with AND", () => {
    expect(filterLines(lines, { marketplace: "blinkit", sku: "NDL" })).toHaveLength(0);
  });

  test("no filters returns everything", () => {
    expect(filterLines(lines, {})).toHaveLength(2);
  });
});

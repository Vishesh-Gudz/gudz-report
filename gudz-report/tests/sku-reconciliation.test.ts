import { describe, expect, test } from "vitest";

import { reconcileBySku } from "@/lib/report/sku-reconciliation";
import type { SalesOrderLine } from "@/types/erp";
import type { NormalizedExcelRow } from "@/types/excel";

/**
 * SKU-level reconciliation — the primary mode.
 *
 * It exists because line-level matching does not survive a month of real data:
 * verified against production, all 4,357 August ERP lines produced multi-
 * candidate SKU lookups, so every spreadsheet row came back ambiguous. Totalling
 * per SKU is both what the data supports and what the client is asking.
 */

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
    customerName: "Buyer",
    customerCode: null,
    customerType: "BUSINESS",
    customerGstin: "29AABCB1234C1ZX",
    sourceHubId: null,
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

describe("aggregating both sides by SKU", () => {
  test("sums many ERP lines of one SKU instead of calling them ambiguous", () => {
    // The exact case line-level matching cannot handle: the same product sold
    // on three orders inside the period.
    const result = reconcileBySku(
      [excelRow({ quantity: 300, grossSales: 12_600 })],
      [
        erpLine({ salesOrderItemId: "a", salesOrderId: "so_1", orderedQuantity: 100, lineTotal: 4200 }),
        erpLine({ salesOrderItemId: "b", salesOrderId: "so_2", orderedQuantity: 100, lineTotal: 4200 }),
        erpLine({ salesOrderItemId: "c", salesOrderId: "so_3", orderedQuantity: 100, lineTotal: 4200 }),
      ],
    );

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0]!;
    expect(row.status).toBe("matched");
    expect(row.erpLines).toBe(3);
    expect(row.erpOrders).toBe(3);
    expect(row.erpQuantity).toBe(300);
    expect(row.excelQuantity).toBe(300);
    expect(row.quantityVariance).toBe(0);
    expect(row.amountVariance).toBe(0);
  });

  test("sums many Excel rows of one SKU", () => {
    const result = reconcileBySku(
      [
        excelRow({ sourceRow: 2, quantity: 60, grossSales: 2520 }),
        excelRow({ sourceRow: 3, quantity: 40, grossSales: 1680 }),
      ],
      [erpLine()],
    );

    expect(result.rows[0]?.excelRows).toBe(2);
    expect(result.rows[0]?.excelQuantity).toBe(100);
    expect(result.rows[0]?.quantityVariance).toBe(0);
  });

  test("folds SKU case and whitespace on both sides", () => {
    const result = reconcileBySku(
      [excelRow({ sku: "  hm-khk-100 " })],
      [erpLine({ sku: "HM-KHK-100" })],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.status).toBe("matched");
  });

  test("falls back to barcode when the sheet has no SKU", () => {
    const result = reconcileBySku(
      [excelRow({ sku: null, barcode: "HM-KHK-100" })],
      [erpLine()],
    );
    expect(result.rows[0]?.status).toBe("matched");
  });
});

describe("variances", () => {
  test("reports a quantity shortfall against the ERP", () => {
    const result = reconcileBySku(
      [excelRow({ quantity: 90, grossSales: 3780 })],
      [erpLine({ orderedQuantity: 100, lineTotal: 4200 })],
    );
    expect(result.rows[0]?.quantityVariance).toBe(-10);
    expect(result.rows[0]?.amountVariance).toBe(-420);
  });

  test("expresses variance as a share of the ERP quantity", () => {
    const result = reconcileBySku(
      [excelRow({ quantity: 110 })],
      [erpLine({ orderedQuantity: 100 })],
    );
    expect(result.rows[0]?.quantityVariancePct).toBeCloseTo(0.1, 6);
  });

  test("reports no percentage rather than Infinity when the ERP has nothing", () => {
    const result = reconcileBySku([excelRow({ sku: "EXCEL-ONLY" })], []);
    expect(result.rows[0]?.quantityVariancePct).toBeNull();
  });

  test("orders by the largest absolute variance first", () => {
    const result = reconcileBySku(
      [
        excelRow({ sku: "A", quantity: 101 }),
        excelRow({ sku: "B", quantity: 500 }),
      ],
      [
        erpLine({ sku: "A", orderedQuantity: 100 }),
        erpLine({ sku: "B", salesOrderItemId: "b", orderedQuantity: 100 }),
      ],
    );
    expect(result.rows[0]?.sku).toBe("B");
  });
});

describe("one-sided SKUs", () => {
  test("a SKU only in the spreadsheet is reported, not dropped", () => {
    // The ERP is missing sales the marketplace says happened — one of the two
    // most actionable outcomes in the report.
    const result = reconcileBySku([excelRow({ sku: "NOT-IN-ERP" })], [erpLine()]);
    const row = result.rows.find((entry) => entry.sku === "NOT-IN-ERP");
    expect(row?.status).toBe("excelOnly");
    expect(row?.erpQuantity).toBe(0);
    expect(result.counts.skusExcelOnly).toBe(1);
  });

  test("a SKU only in the ERP is reported too", () => {
    const result = reconcileBySku([], [erpLine()]);
    expect(result.rows[0]?.status).toBe("erpOnly");
    expect(result.counts.skusErpOnly).toBe(1);
  });

  test("a row with no identifier at all is skipped, not counted as a SKU", () => {
    const result = reconcileBySku(
      [excelRow({ sku: null, barcode: null })],
      [erpLine()],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.sku).toBe("HM-KHK-100");
    expect(result.rows[0]?.excelRows).toBe(0);
  });
});

describe("status policy", () => {
  test("drafts never reach a total", () => {
    const result = reconcileBySku(
      [excelRow({ quantity: 100 })],
      [
        erpLine({ orderedQuantity: 100, lineTotal: 4200 }),
        erpLine({ salesOrderItemId: "draft", status: "draft", orderedQuantity: 999, lineTotal: 99_999 }),
      ],
    );
    expect(result.rows[0]?.erpQuantity).toBe(100);
    expect(result.rows[0]?.quantityVariance).toBe(0);
  });

  test("cancellations are excluded as well", () => {
    const result = reconcileBySku(
      [],
      [erpLine({ status: "cancelled", orderedQuantity: 50 })],
    );
    expect(result.rows).toHaveLength(0);
  });

  test("can be told to include everything, for an audit view", () => {
    const result = reconcileBySku(
      [],
      [erpLine({ status: "draft", orderedQuantity: 50 })],
      { reportableOnly: false },
    );
    expect(result.rows[0]?.erpQuantity).toBe(50);
  });
});

describe("totals", () => {
  test("roll up across every SKU", () => {
    const result = reconcileBySku(
      [excelRow({ sku: "A", quantity: 10, grossSales: 100 })],
      [
        erpLine({ sku: "A", orderedQuantity: 12, lineTotal: 120 }),
        erpLine({ sku: "B", salesOrderItemId: "b", orderedQuantity: 5, lineTotal: 50 }),
      ],
    );

    expect(result.totals.erpQuantity).toBe(17);
    expect(result.totals.excelQuantity).toBe(10);
    expect(result.totals.erpRevenue).toBe(170);
    expect(result.totals.excelRevenue).toBe(100);
    expect(result.totals.quantityVariance).toBe(-7);
    expect(result.counts.skusWithVariance).toBe(2);
  });

  test("an empty reconciliation is all zeros, not NaN", () => {
    const result = reconcileBySku([], []);
    expect(result.rows).toEqual([]);
    expect(result.totals.erpQuantity).toBe(0);
    expect(result.totals.quantityVariance).toBe(0);
  });
});

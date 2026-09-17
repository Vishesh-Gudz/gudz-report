import { describe, expect, test } from "vitest";

import {
  CatalogIndex,
  ConfirmedMappingIndex,
  mapExcelRows,
  resolveProduct,
  type ConfirmedMapping,
} from "@/lib/report/product-mapping";
import { reconcileBySku } from "@/lib/report/sku-reconciliation";
import {
  SELL_IN,
  SELL_OUT,
  SKU_STATUS_HINTS,
  SKU_STATUS_LABELS,
} from "@/lib/report/vocabulary";
import type { CatalogItem, SalesOrderLine } from "@/types/erp";
import type { NormalizedExcelRow } from "@/types/excel";

/**
 * Confirmed mappings, and what they are allowed to override.
 *
 * A confirmation is the only route where a person actually knew, so it outranks
 * every identifier the report can match on its own. That also makes it the only
 * route that can be confidently wrong with nothing on screen to question it,
 * which is why its precedence is pinned here rather than left to the order of a
 * chain of `if`s.
 */

function item(overrides: Partial<CatalogItem> = {}): CatalogItem {
  return {
    itemId: "item_1",
    sku: "RAGI-CHIPS-100",
    name: "Ragi Chips - 100 gm",
    description: null,
    category: null,
    subCategory: null,
    brand: null,
    unitOfMeasure: null,
    barcode: "8906165850653",
    barcodeType: null,
    searchTags: [],
    hsnCode: null,
    gstRate: null,
    mrp: null,
    unitsPerCarton: null,
    itemType: "finished_good",
    inventoryType: "standard",
    trackBatches: false,
    shelfLifeDays: null,
    isActive: true,
    primaryImageUrl: null,
    customerItemIdentifiers: [],
    channelItemMappings: [],
    ...overrides,
  } as CatalogItem;
}

function excelRow(overrides: Partial<NormalizedExcelRow> = {}): NormalizedExcelRow {
  return {
    sourceRow: 2,
    orderDate: "2026-06-01",
    marketplaceOrderId: "MP-1",
    marketplaceItemId: "10180611",
    sku: "8906165850653",
    barcode: "8906165850653",
    productName: "Healthy Master Baked Ragi Chips",
    quantity: 10,
    unitPrice: 150,
    grossSales: 1500,
    rawStatus: "DELIVERED",
    normalizedStatus: "delivered",
    ...overrides,
  };
}

function erpLine(overrides: Partial<SalesOrderLine> = {}): SalesOrderLine {
  return {
    salesOrderId: "so_1",
    soNumber: "SO-1",
    referenceNumber: null,
    orderDate: "2026-06-01T00:00:00.000Z",
    dispatchedAt: null,
    deliveredAt: null,
    status: "approved",
    orderType: "product",
    channel: null,
    channelNormalized: null,
    customerId: "cust_1",
    customerName: "BLINK COMMERCE PRIVATE LIMITED",
    customerCode: null,
    customerType: "BUSINESS",
    customerGstin: "29AAFCG9846E1Z7",
    sourceHubId: null,
    salesOrderItemId: "soi_1",
    itemId: "item_9",
    sku: "CONFIRMED-SKU",
    name: "Confirmed product",
    unit: "pcs",
    hsnCode: null,
    orderedQuantity: 10,
    shippedQuantity: 0,
    deliveredQuantity: 0,
    unitPrice: 150,
    lineTotal: 1500,
    taxableValue: 1500,
    taxAmount: 0,
    fulfillmentSku: null,
    fulfillmentQuantity: null,
    ...overrides,
  };
}

const confirmed = (overrides: Partial<ConfirmedMapping> = {}): ConfirmedMapping => ({
  ean: "8906165850653",
  marketplaceItemId: null,
  erpItemId: "item_9",
  erpSku: "CONFIRMED-SKU",
  erpName: "Confirmed product",
  ...overrides,
});

describe("precedence", () => {
  test("a confirmation beats a barcode that would have matched something else", () => {
    // The barcode route would resolve to RAGI-CHIPS-100. A person said otherwise,
    // and a person looking at both products outranks a shared identifier.
    const catalog = new CatalogIndex([item()]);
    const result = resolveProduct(excelRow(), catalog, {
      confirmed: new ConfirmedMappingIndex([confirmed()]),
    });

    expect(result.status).toBe("mapped");
    expect(result.route).toBe("confirmed");
    expect(result.item?.sku).toBe("CONFIRMED-SKU");
  });

  test("a confirmation beats an ERP channel mapping too", () => {
    const catalog = new CatalogIndex([
      item({
        itemId: "chan",
        sku: "BY-CHANNEL",
        barcode: null,
        channelItemMappings: [
          {
            provider: "BLINKIT",
            integrationId: null,
            keyType: "sku",
            externalKey: "10180611",
            externalSku: null,
            externalTitle: null,
            unitsPerOrderedUnit: "1",
            action: "map",
            isActive: true,
          },
        ],
      }),
    ]);

    const result = resolveProduct(excelRow(), catalog, {
      channelProvider: "BLINKIT",
      confirmed: new ConfirmedMappingIndex([confirmed()]),
    });
    expect(result.route).toBe("confirmed");
  });

  test("a confirmation resolves a product that nothing else could", () => {
    // The real case this exists for: no catalogue item carries the EAN.
    const catalog = new CatalogIndex([item({ barcode: "9999999999999", name: "Other" })]);

    const without = resolveProduct(excelRow({ productName: "Nothing alike" }), catalog);
    expect(without.status).toBe("unmapped");

    const withConfirmation = resolveProduct(
      excelRow({ productName: "Nothing alike" }),
      catalog,
      { confirmed: new ConfirmedMappingIndex([confirmed()]) },
    );
    expect(withConfirmation.status).toBe("mapped");
    expect(withConfirmation.item?.sku).toBe("CONFIRMED-SKU");
  });

  test("resolves on the marketplace item id when the sheet has no EAN", () => {
    const catalog = new CatalogIndex([]);
    const result = resolveProduct(
      excelRow({ barcode: null, sku: null }),
      catalog,
      {
        confirmed: new ConfirmedMappingIndex([
          confirmed({ ean: null, marketplaceItemId: "10180611" }),
        ]),
      },
    );
    expect(result.route).toBe("confirmed");
  });

  test("a confirmation for a different product does not leak onto this one", () => {
    const catalog = new CatalogIndex([item()]);
    const result = resolveProduct(excelRow(), catalog, {
      confirmed: new ConfirmedMappingIndex([
        confirmed({ ean: "1111111111116", marketplaceItemId: "999" }),
      ]),
    });
    expect(result.route).toBe("barcode");
    expect(result.item?.sku).toBe("RAGI-CHIPS-100");
  });
});

describe("effect on the reconciliation", () => {
  const catalog = new CatalogIndex([item({ barcode: "9999999999999", name: "Other" })]);
  const rows = [excelRow({ quantity: 10, grossSales: 1500, productName: "Nothing alike" })];
  const erpLines = [erpLine()];

  test("an unresolved product reports as two one-sided SKUs", () => {
    const mapped = mapExcelRows(rows, catalog);
    const result = reconcileBySku(mapped.rows, erpLines);

    expect(result.counts.skusExcelOnly).toBe(1);
    expect(result.counts.skusErpOnly).toBe(1);
    expect(result.counts.skusMatched).toBe(0);
  });

  test("confirming it collapses them into one agreeing SKU", () => {
    // The point of the whole feature: one decision turns a pair of unexplained
    // one-sided gaps into a product that reconciles.
    const mapped = mapExcelRows(rows, catalog, {
      confirmed: new ConfirmedMappingIndex([confirmed()]),
    });
    const result = reconcileBySku(mapped.rows, erpLines);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.sku).toBe("CONFIRMED-SKU");
    expect(result.rows[0]?.status).toBe("matched");
    expect(result.rows[0]?.quantityVariance).toBe(0);
    expect(result.counts.skusExcelOnly).toBe(0);
    expect(result.counts.skusErpOnly).toBe(0);
  });

  test("the confirmed route is counted in the mapping statistics", () => {
    const mapped = mapExcelRows(rows, catalog, {
      confirmed: new ConfirmedMappingIndex([confirmed()]),
    });
    expect(mapped.statistics.byRoute.confirmed).toBe(1);
    expect(mapped.statistics.unmapped).toBe(0);
  });
});

describe("report vocabulary", () => {
  test("nothing user-facing calls this a stock report", () => {
    // The rename exists because "SOH" invited a reader to treat a timing
    // difference as missing inventory and go looking for it.
    const surfaces = [
      SELL_IN.label,
      SELL_IN.source,
      SELL_IN.description,
      SELL_OUT.label,
      SELL_OUT.source,
      SELL_OUT.description,
      ...Object.values(SKU_STATUS_LABELS),
      ...Object.values(SKU_STATUS_HINTS),
    ];

    for (const text of surfaces) {
      expect(text.toLowerCase()).not.toContain("stock on hand");
      expect(text).not.toMatch(/\bSOH\b/);
    }
  });

  test("every SKU status has a label and an explanation", () => {
    for (const status of ["matched", "variance", "erpOnly", "excelOnly"] as const) {
      expect(SKU_STATUS_LABELS[status]).toBeTruthy();
      expect(SKU_STATUS_HINTS[status].length).toBeGreaterThan(20);
    }
  });

  test("the one-sided statuses are named after the measurement, not the system", () => {
    // "ERP only" told a reader which database a row came from. "Sell-in only"
    // tells them what it means.
    expect(SKU_STATUS_LABELS.erpOnly).toBe(`${SELL_IN.label} only`);
    expect(SKU_STATUS_LABELS.excelOnly).toBe(`${SELL_OUT.label} only`);
  });
});

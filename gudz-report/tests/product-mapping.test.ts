import { describe, expect, test } from "vitest";

import {
  CatalogIndex,
  mapExcelRows,
  resolveProduct,
} from "@/lib/report/product-mapping";
import type { CatalogItem } from "@/types/erp";
import type { NormalizedExcelRow } from "@/types/excel";

/**
 * Mapping a marketplace product to an ERP product.
 *
 * The chain is `marketplace item id → (Master) → EAN → ERP barcode → ERP SKU`,
 * and the reason it needs this much care is what the real catalogue looks like:
 * 3,067 items, 446 with any barcode, 223 of those actually EAN-shaped, and 83
 * barcodes shared by more than one item. Every one of those numbers is a way for
 * a careless matcher to produce a confident wrong answer.
 */

function item(overrides: Partial<CatalogItem> = {}): CatalogItem {
  return {
    itemId: "item_1",
    sku: "RAGI-CHIPS-100",
    name: "Ragi Chips - Light and Crispy - 100 gm",
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
    productName: "Healthy Master Light & Crispy Baked Ragi Chips",
    quantity: 10,
    unitPrice: 150,
    grossSales: 1500,
    rawStatus: "DELIVERED",
    normalizedStatus: "delivered",
    ...overrides,
  };
}

describe("resolving one product", () => {
  test("an EAN matching a catalogue barcode maps", () => {
    const catalog = new CatalogIndex([item()]);
    const result = resolveProduct(excelRow(), catalog);

    expect(result.status).toBe("mapped");
    expect(result.route).toBe("barcode");
    expect(result.item?.sku).toBe("RAGI-CHIPS-100");
  });

  test("a barcode shared by two items is ambiguous, never picked", () => {
    // 83 barcodes in the real catalogue are shared. Choosing the first would
    // attribute a month of sales to whichever item happened to be indexed first.
    const catalog = new CatalogIndex([
      item({ itemId: "a", sku: "SKU-A" }),
      item({ itemId: "b", sku: "SKU-B" }),
    ]);
    const result = resolveProduct(excelRow(), catalog, { suggestByName: false });

    expect(result.status).toBe("ambiguous");
    expect(result.item).toBeNull();
    expect(result.candidates.map((candidate) => candidate.sku)).toEqual([
      "SKU-A",
      "SKU-B",
    ]);
    expect(result.reason).toMatch(/shared by 2 catalogue items/);
  });

  test("a recorded channel mapping beats the barcode", () => {
    // Someone stated the two are the same product. That outranks anything the
    // dashboard could infer.
    const catalog = new CatalogIndex([
      item({ itemId: "bar", sku: "BY-BARCODE" }),
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
    });
    expect(result.route).toBe("channelMapping");
    expect(result.item?.sku).toBe("BY-CHANNEL");
  });

  test("an inactive or ignored channel mapping is not used", () => {
    const catalog = new CatalogIndex([
      item({
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
            action: "ignore",
            isActive: true,
          },
        ],
      }),
    ]);
    const result = resolveProduct(excelRow(), catalog, {
      channelProvider: "BLINKIT",
      suggestByName: false,
    });
    expect(result.status).not.toBe("mapped");
  });

  test("a channel provider is only consulted for its own marketplace", () => {
    const catalog = new CatalogIndex([
      item({
        barcode: null,
        channelItemMappings: [
          {
            provider: "SHOPIFY",
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
      suggestByName: false,
    });
    expect(result.status).not.toBe("mapped");
  });

  test("a name match is offered as a candidate, never accepted", () => {
    // The rule the client asked for in so many words: never silently
    // auto-accept an uncertain match.
    const catalog = new CatalogIndex([
      item({ barcode: null, name: "Beetroot Chips - Chatpata Spice - 100 gm" }),
    ]);
    const result = resolveProduct(
      excelRow({
        barcode: null,
        sku: null,
        marketplaceItemId: null,
        productName: "Healthy Master Baked Beetroot Chips Chatpata 100g",
      }),
      catalog,
    );

    // `unmapped`, not `ambiguous`: a name guess is not a mapping. Counting it
    // as ambiguous would let the KPI read "0 unmapped" for a sheet where
    // nothing was actually resolved.
    expect(result.status).toBe("unmapped");
    expect(result.route).toBe("nameSuggestion");
    expect(result.item).toBeNull();
    expect(result.candidates).toHaveLength(1);
    expect(result.reason).toMatch(/confirmed by a human/);
  });

  test("an unrelated name produces no candidate at all", () => {
    const catalog = new CatalogIndex([item({ barcode: null, name: "Almond Butter 250 gm" })]);
    const result = resolveProduct(
      excelRow({ barcode: null, sku: null, marketplaceItemId: null }),
      catalog,
    );
    expect(result.status).toBe("unmapped");
  });

  test("an EAN absent from the catalogue is unmapped, with a reason", () => {
    // Eleven of the seventeen real Blinkit EANs land here.
    const catalog = new CatalogIndex([item({ barcode: "9999999999999", name: "Other" })]);
    const result = resolveProduct(
      excelRow({ productName: "Nothing like anything" }),
      catalog,
    );
    expect(result.status).toBe("unmapped");
    expect(result.reason).toMatch(/No catalogue item carries this EAN/);
  });

  test("a row with no identifier at all says so", () => {
    const catalog = new CatalogIndex([item()]);
    const result = resolveProduct(
      { barcode: null, sku: null, marketplaceItemId: null, productName: null },
      catalog,
    );
    expect(result.status).toBe("unmapped");
    expect(result.reason).toMatch(/nothing to match on/);
  });
});

describe("mapping a sheet", () => {
  const catalog = new CatalogIndex([
    item(),
    item({ itemId: "item_2", sku: "PALAK-200", barcode: "8906165850677", name: "Palak Chips 200 gm" }),
  ]);

  test("counts rows and distinct products separately", () => {
    // 8,451 rows over 17 products in the real sheet: the row count says how big
    // the file is, the product count says how much work a human has to do.
    const result = mapExcelRows(
      [
        excelRow({ sourceRow: 2 }),
        excelRow({ sourceRow: 3 }),
        excelRow({ sourceRow: 4, barcode: "8906165850677", sku: "8906165850677", productName: "Palak" }),
      ],
      catalog,
    );

    expect(result.statistics.rows).toBe(3);
    expect(result.statistics.mapped).toBe(3);
    expect(result.statistics.distinctProducts).toBe(2);
    expect(result.statistics.distinctMapped).toBe(2);
  });

  test("keys a mapped row on the ERP SKU, not the EAN", () => {
    // This is the whole point of the mapping pass: without it the Excel side is
    // keyed on an EAN and the ERP side on its own SKU, and nothing ever matches.
    const result = mapExcelRows([excelRow()], catalog);
    expect(result.rows[0]?.key).toBe("RAGI-CHIPS-100");
    expect(result.rows[0]?.keyIsErpSku).toBe(true);
  });

  test("keeps an unmapped row, keyed on its own identifier", () => {
    const result = mapExcelRows(
      [excelRow({ barcode: "0000000000000", sku: "0000000000000", productName: "Mystery" })],
      catalog,
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.key).toBe("0000000000000");
    expect(result.rows[0]?.keyIsErpSku).toBe(false);
    expect(result.statistics.unmapped).toBe(1);
  });

  test("reports the quantity and revenue that never reached the ERP", () => {
    // The cost of the gaps, in the units a client argues about.
    const result = mapExcelRows(
      [
        excelRow({ quantity: 10, grossSales: 1000 }),
        excelRow({
          barcode: "0000000000000",
          sku: "0000000000000",
          productName: "Mystery",
          quantity: 7,
          grossSales: 700,
        }),
      ],
      catalog,
    );
    expect(result.statistics.unmappedQuantity).toBe(7);
    expect(result.statistics.unmappedRevenue).toBe(700);
  });

  test("resolves each distinct product once, however many rows it has", () => {
    const rows = Array.from({ length: 500 }, (_, index) =>
      excelRow({ sourceRow: index + 2 }),
    );
    const result = mapExcelRows(rows, catalog);
    expect(result.rows).toHaveLength(500);
    expect(result.statistics.distinctProducts).toBe(1);
  });
});

describe("catalogue statistics", () => {
  test("counts duplicate barcodes, because they become ambiguous rows", () => {
    const catalog = new CatalogIndex([
      item({ itemId: "a", sku: "A" }),
      item({ itemId: "b", sku: "B" }),
      item({ itemId: "c", sku: "C", barcode: "111" }),
      item({ itemId: "d", sku: "D", barcode: null }),
    ]);
    expect(catalog.counts.items).toBe(4);
    expect(catalog.counts.withBarcode).toBe(2);
    expect(catalog.counts.duplicateBarcodes).toBe(1);
  });
});

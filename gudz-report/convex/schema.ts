import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Gudz Report data model.
 *
 * Three tables, one idea: **store the normalized shape, never the raw file.**
 * A marketplace export is wide, inconsistently named and changes between
 * releases. Persisting it as a blob would push meaning back onto column headers
 * for every consumer and make a header rename an outage. Rows here are already
 * interpreted, typed and addressable by index.
 *
 * The ERP is not mirrored. Sales orders are fetched per reporting period and
 * cached at most transiently: they change status after the fact, and a stale
 * local copy that disagrees with the ERP is worse than a slower query, because
 * someone will trust it.
 */

export default defineSchema({
  /**
   * One uploaded workbook and what became of it.
   *
   * `minDate` / `maxDate` are the reporting period the file itself implies —
   * the window the ERP is then asked for. Both are `YYYY-MM-DD`, nullable
   * because a file whose dates could not be read has no period, and inventing
   * one would reconcile against a window nobody chose.
   */
  imports: defineTable({
    fileName: v.string(),
    /**
     * Which marketplace sheet this import came from.
     *
     * One workbook holds six of them, so the file name alone does not identify
     * an import. Optional because imports created before sheet selection
     * existed have no answer, and inventing one would attribute their rows to a
     * marketplace nobody chose.
     */
    marketplace: v.optional(v.string()),
    sheetName: v.optional(v.string()),
    uploadedAt: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    minDate: v.union(v.string(), v.null()),
    maxDate: v.union(v.string(), v.null()),
    totalRows: v.number(),
    validRows: v.number(),
    invalidRows: v.number(),
    matchedRows: v.number(),
    unmatchedRows: v.number(),
    /** Set only when `status` is `failed`. Never contains a credential. */
    errorMessage: v.union(v.string(), v.null()),
  })
    .index("by_status", ["status"])
    .index("by_uploadedAt", ["uploadedAt"]),

  /**
   * Normalized marketplace lines.
   *
   * Every field but `importId` and `sourceRow` is nullable: real exports omit
   * them, and a schema that demanded a barcode would reject files that
   * reconcile perfectly by SKU. `sourceRow` points back at the spreadsheet so a
   * human can be shown the row that failed.
   */
  excelRows: defineTable({
    importId: v.id("imports"),
    sourceRow: v.number(),
    /** `YYYY-MM-DD`, UTC. The axis the reporting period is derived from. */
    orderDate: v.union(v.string(), v.null()),
    marketplaceOrderId: v.union(v.string(), v.null()),
    marketplaceItemId: v.union(v.string(), v.null()),
    sku: v.union(v.string(), v.null()),
    barcode: v.union(v.string(), v.null()),
    productName: v.union(v.string(), v.null()),
    quantity: v.union(v.number(), v.null()),
    unitPrice: v.union(v.number(), v.null()),
    grossSales: v.union(v.number(), v.null()),
    /** Verbatim from the sheet, so a mapping decision can be audited. */
    rawStatus: v.union(v.string(), v.null()),
    normalizedStatus: v.union(
      v.literal("delivered"),
      v.literal("returned"),
      v.literal("cancelled"),
      v.literal("unknown"),
    ),
  })
    .index("by_importId", ["importId"])
    // Compound rather than bare: every read of a row is scoped to its import,
    // so a lone `orderDate` index would scan across every file ever uploaded.
    .index("by_importId_orderDate", ["importId", "orderDate"])
    .index("by_importId_sku", ["importId", "sku"])
    .index("by_importId_marketplaceOrderId", ["importId", "marketplaceOrderId"])
    .index("by_importId_marketplaceItemId", ["importId", "marketplaceItemId"])
    // Cross-import lookups, for "where else has this SKU appeared".
    .index("by_sku", ["sku"])
    .index("by_orderDate", ["orderDate"]),

  /**
   * Which customer GSTINs belong to which marketplace.
   *
   * Configuration, not ERP data. "GSTIN 29… is Blinkit" is a fact about this
   * business, so it lives here where it can be edited, rather than compiled into
   * a generic ERP query that would then serve exactly one customer.
   *
   * It is keyed on GSTIN because production proved nothing else is stable:
   * `channel` is null on about half of orders and sometimes names a marketplace
   * on an order raised to a different party entirely, and the same buyer appears
   * under several customer records and spellings.
   *
   * One marketplace holds several GSTINs — regional entities register separately.
   */
  marketplaces: defineTable({
    marketplace: v.string(),
    customerGstins: v.array(v.string()),
    /** Channel strings seen on these orders. Provenance for humans, never identity. */
    knownChannelValues: v.optional(v.array(v.string())),
    /**
     * The ERP `channelItemMappings.provider` this marketplace trades under.
     *
     * Optional because most marketplaces have no recorded channel mappings in
     * the ERP. When one does, it is the most authoritative route from a
     * marketplace's product id to an ERP item — someone stated the two are the
     * same, rather than the dashboard inferring it from a barcode.
     */
    erpChannelProvider: v.optional(v.union(v.string(), v.null())),
    isActive: v.boolean(),
    updatedAt: v.number(),
  }).index("by_marketplace", ["marketplace"]),

  /**
   * A human's decision that one marketplace product IS one ERP item.
   *
   * The dashboard can infer a mapping from an EAN or a channel mapping, and
   * where it can, it does. This table is for everything it cannot: the real
   * Healthy Master catalogue carries a barcode on 446 of 3,067 items, and 83 of
   * those barcodes are shared, so a large share of any marketplace sheet reaches
   * no ERP product at all. Guessing by product name would close the gap and
   * quietly invent revenue; recording what a person confirmed closes it honestly.
   *
   * Keyed per marketplace, because the same EAN can be listed by several of them
   * and the same marketplace item id means nothing outside its own channel. One
   * of `ean` / `marketplaceItemId` identifies the product; both are stored when
   * both are known so a sheet that later drops one still resolves.
   *
   * `erpSku` and `erpName` are copies taken at confirmation time. They are not
   * the identity — `erpItemId` is — but a mapping whose product was since
   * renamed should still say which product a person was looking at when they
   * confirmed it.
   */
  productMappings: defineTable({
    marketplace: v.string(),
    /** Normalised upper-case. Null when the sheet gave no usable EAN. */
    ean: v.union(v.string(), v.null()),
    /** The marketplace's own product id, upper-cased. */
    marketplaceItemId: v.union(v.string(), v.null()),
    erpItemId: v.string(),
    erpSku: v.string(),
    /** The ERP product name as it read when this was confirmed. */
    erpName: v.string(),
    /** Free text: why this pairing, for whoever reads it in six months. */
    note: v.union(v.string(), v.null()),
    confirmedAt: v.number(),
    confirmedBy: v.union(v.string(), v.null()),
  })
    .index("by_marketplace", ["marketplace"])
    .index("by_marketplace_ean", ["marketplace", "ean"])
    .index("by_marketplace_itemId", ["marketplace", "marketplaceItemId"]),

  /**
   * The outcome of matching one spreadsheet line to one ERP sales-order line.
   *
   * `salesOrderId` / `salesOrderItemId` are ERP ids held as plain strings, not
   * Convex references — the ERP owns those records and this table only points
   * at them. `matchType` records *how* the match was made (sku, barcode,
   * channel mapping, manual) so a questionable reconciliation can be traced to
   * the rule that produced it rather than argued about.
   */
  reconciliation: defineTable({
    importId: v.id("imports"),
    excelRowId: v.id("excelRows"),
    salesOrderId: v.union(v.string(), v.null()),
    salesOrderItemId: v.union(v.string(), v.null()),
    matchType: v.union(
      v.literal("sku"),
      v.literal("barcode"),
      v.literal("channelMapping"),
      v.literal("customerIdentifier"),
      v.literal("manual"),
      v.literal("none"),
    ),
    status: v.union(
      v.literal("matched"),
      v.literal("unmatched"),
      v.literal("ambiguous"),
      v.literal("ignored"),
    ),
    /** Excel quantity minus ERP quantity. Positive means the sheet claims more. */
    quantityDifference: v.union(v.number(), v.null()),
    amountDifference: v.union(v.number(), v.null()),
    createdAt: v.number(),
  })
    .index("by_importId", ["importId"])
    .index("by_importId_status", ["importId", "status"])
    .index("by_excelRowId", ["excelRowId"])
    .index("by_salesOrderId", ["salesOrderId"]),
});

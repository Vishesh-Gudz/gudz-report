import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Gudz Report data model.
 *
 * Four tables, one idea: **the finished report is the permanent record.**
 *
 * An uploaded workbook is processing input — 203,000 rows across six
 * marketplaces, read once and never queried as rows again. What anyone actually
 * asks of it is the aggregate: marketplace by product by month, a few hundred
 * rows. So the aggregate is stored and the raw dump is not kept at all. An
 * earlier version wrote every row; it was slower to save than to compute and
 * nothing ever read it back.
 *
 * The ERP is not mirrored either. Sell-through figures, stock and goods
 * receipts are read live while a report is being built and then frozen into the
 * snapshot. A local copy that drifts out of step with the ERP is worse than a
 * slower read, because somebody will trust it.
 *
 * Product mappings and marketplace configuration are the exceptions: they are
 * decisions, not data, and they are reused by every report that follows.
 */

export default defineSchema({
  /**
   * A finished SOH report, saved so it can be reopened without the workbook.
   *
   * This is the permanent record. The uploaded spreadsheet is processing input:
   * 203,000 raw rows across six marketplaces, written once and never read as
   * rows again. What a reader actually needs is the aggregate — marketplace by
   * product by month — which is a few hundred rows. Storing the aggregate and
   * discarding the raw dump is both faster to write and the only version anyone
   * queries.
   *
   * A snapshot is immutable by intent. Opening one next month must show the same
   * numbers it showed today, so nothing recomputes it in place; a refreshed view
   * is a new snapshot.
   */
  reportSnapshots: defineTable({
    sourceFileName: v.string(),
    createdAt: v.number(),
    status: v.union(
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    /** Marketplaces that produced rows, in sheet order. */
    marketplaces: v.array(v.string()),
    /** Null when the sheets cover different windows. */
    periodStart: v.union(v.string(), v.null()),
    periodEnd: v.union(v.string(), v.null()),
    periodsDiffer: v.boolean(),
    /** Headline figures, computed once so every reader sees the same ones. */
    summary: v.object({
      marketplaces: v.number(),
      products: v.number(),
      rows: v.number(),
      salesQuantity: v.number(),
      salesValue: v.number(),
      currentSoh: v.union(v.number(), v.null()),
      grnQuantity: v.union(v.number(), v.null()),
      /** Optional: snapshots saved before Dispatch existed carry no total. */
      dispatchQuantity: v.optional(v.union(v.number(), v.null())),
      mappedProducts: v.number(),
      unresolvedProducts: v.number(),
    }),
    /** What the report could and could not establish, in plain sentences. */
    dataQuality: v.array(
      v.object({
        state: v.union(
          v.literal("ok"),
          v.literal("warn"),
          v.literal("absent"),
          v.literal("bad"),
        ),
        title: v.string(),
        detail: v.string(),
      }),
    ),
    errorMessage: v.union(v.string(), v.null()),
  })
    .index("by_createdAt", ["createdAt"])
    .index("by_status", ["status"]),

  /**
   * One marketplace's standing within a snapshot.
   *
   * Held apart from the rows because a marketplace has facts of its own — its
   * period, whether its ERP side was configured, whether its sheet parsed at
   * all — and a failed sheet has no rows to carry them on.
   */
  snapshotMarketplaces: defineTable({
    snapshotId: v.id("reportSnapshots"),
    marketplace: v.string(),
    sheetName: v.string(),
    status: v.union(v.literal("completed"), v.literal("failed")),
    errorMessage: v.union(v.string(), v.null()),
    periodStart: v.union(v.string(), v.null()),
    periodEnd: v.union(v.string(), v.null()),
    months: v.array(v.string()),
    sourceRows: v.number(),
    products: v.number(),
    salesQuantity: v.number(),
    salesValue: v.number(),
    /** `reconciled` | `notConfigured` | `unavailable`. */
    erpState: v.string(),
    erpMessage: v.union(v.string(), v.null()),
    grnState: v.string(),
    grnMessage: v.union(v.string(), v.null()),
    mappedProducts: v.number(),
    unresolvedProducts: v.number(),
  })
    .index("by_snapshotId", ["snapshotId"])
    .index("by_snapshotId_marketplace", ["snapshotId", "marketplace"]),

  /**
   * The report itself: one row per marketplace, product and month.
   *
   * `currentSoh` and `grn` are nullable and that nullability is the point. Null
   * means the figure does not exist — no live position for this product, or no
   * customer GRN raised — and renders as an em dash. Zero would claim the
   * opposite: that the register was read and genuinely held nothing.
   *
   * `damage` and `returned` are carried at zero. They are columns the business
   * asked for and no source feeds them yet; keeping them in the row model means
   * connecting a real source later changes a writer, not the schema.
   */
  snapshotRows: defineTable({
    snapshotId: v.id("reportSnapshots"),
    marketplace: v.string(),
    /** `YYYY-MM`, from the marketplace report's own dates. */
    month: v.string(),
    productName: v.string(),
    sku: v.string(),
    ean: v.union(v.string(), v.null()),
    marketplaceItemId: v.union(v.string(), v.null()),
    erpItemId: v.union(v.string(), v.null()),
    /** Live ERP position at the time the snapshot was built. Not historical. */
    currentSoh: v.union(v.number(), v.null()),
    /**
     * Goods sent. Optional because snapshots written before this column existed
     * do not carry it, and they stay readable — a missing value renders as an
     * em dash, exactly like a null one.
     */
    dispatch: v.optional(v.union(v.number(), v.null())),
    /** From customer_grn. Null means no GRN was raised, not a recorded zero. */
    grn: v.union(v.number(), v.null()),
    salesQuantity: v.number(),
    salesValue: v.number(),
    damage: v.number(),
    returned: v.number(),
    /** `confirmed` | `matched` | `unresolved`. */
    mappingStatus: v.string(),
    mappingReason: v.string(),
    /** How many spreadsheet rows this figure was aggregated from. */
    sourceRows: v.number(),
  })
    .index("by_snapshotId", ["snapshotId"])
    .index("by_snapshotId_marketplace", ["snapshotId", "marketplace"]),

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
});

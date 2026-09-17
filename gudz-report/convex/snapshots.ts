import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * Saved SOH reports.
 *
 * A snapshot is what a reader opens next month. It is written once, at the end
 * of processing, and never recomputed in place — opening an old report must
 * show the numbers it showed the day it was made, not today's ERP position
 * quietly substituted underneath. A refreshed view is a new snapshot.
 *
 * The uploaded workbook is not stored. Its 203,000 rows are processing input;
 * the aggregate they produce is a few hundred rows, and that is what gets saved.
 */

const ROW_LIMIT = 4000;

/** Creates the snapshot shell. Rows follow in batches; status follows last. */
export const create = mutation({
  args: { sourceFileName: v.string() },
  returns: v.id("reportSnapshots"),
  handler: async (ctx, args): Promise<Id<"reportSnapshots">> => {
    return await ctx.db.insert("reportSnapshots", {
      sourceFileName: args.sourceFileName,
      createdAt: Date.now(),
      status: "processing",
      marketplaces: [],
      periodStart: null,
      periodEnd: null,
      periodsDiffer: false,
      summary: {
        marketplaces: 0,
        products: 0,
        rows: 0,
        salesQuantity: 0,
        salesValue: 0,
        currentSoh: null,
        grnQuantity: null,
        mappedProducts: 0,
        unresolvedProducts: 0,
      },
      dataQuality: [],
      errorMessage: null,
    });
  },
});

export const addMarketplace = mutation({
  args: {
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
    erpState: v.string(),
    erpMessage: v.union(v.string(), v.null()),
    grnState: v.string(),
    grnMessage: v.union(v.string(), v.null()),
    mappedProducts: v.number(),
    unresolvedProducts: v.number(),
  },
  returns: v.id("snapshotMarketplaces"),
  handler: async (ctx, args): Promise<Id<"snapshotMarketplaces">> => {
    // Replace rather than append: reprocessing a marketplace within one
    // snapshot corrects it, and two rows for one marketplace would be counted
    // twice by every total.
    const existing = await ctx.db
      .query("snapshotMarketplaces")
      .withIndex("by_snapshotId_marketplace", (q) =>
        q.eq("snapshotId", args.snapshotId).eq("marketplace", args.marketplace),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return await ctx.db.insert("snapshotMarketplaces", args);
  },
});

/** Clears one marketplace's rows before they are rewritten. */
export const clearMarketplaceRows = mutation({
  args: { snapshotId: v.id("reportSnapshots"), marketplace: v.string() },
  returns: v.number(),
  handler: async (ctx, args): Promise<number> => {
    const rows = await ctx.db
      .query("snapshotRows")
      .withIndex("by_snapshotId_marketplace", (q) =>
        q.eq("snapshotId", args.snapshotId).eq("marketplace", args.marketplace),
      )
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
    return rows.length;
  },
});

export const addRows = mutation({
  args: {
    snapshotId: v.id("reportSnapshots"),
    rows: v.array(
      v.object({
        marketplace: v.string(),
        month: v.string(),
        productName: v.string(),
        sku: v.string(),
        ean: v.union(v.string(), v.null()),
        marketplaceItemId: v.union(v.string(), v.null()),
        erpItemId: v.union(v.string(), v.null()),
        currentSoh: v.union(v.number(), v.null()),
        grn: v.union(v.number(), v.null()),
        salesQuantity: v.number(),
        salesValue: v.number(),
        damage: v.number(),
        returned: v.number(),
        mappingStatus: v.string(),
        mappingReason: v.string(),
        sourceRows: v.number(),
      }),
    ),
  },
  returns: v.number(),
  handler: async (ctx, args): Promise<number> => {
    for (const row of args.rows) {
      await ctx.db.insert("snapshotRows", { snapshotId: args.snapshotId, ...row });
    }
    return args.rows.length;
  },
});

/** Seals the snapshot. After this it is what a reader opens, unchanged. */
export const complete = mutation({
  args: {
    snapshotId: v.id("reportSnapshots"),
    marketplaces: v.array(v.string()),
    periodStart: v.union(v.string(), v.null()),
    periodEnd: v.union(v.string(), v.null()),
    periodsDiffer: v.boolean(),
    summary: v.object({
      marketplaces: v.number(),
      products: v.number(),
      rows: v.number(),
      salesQuantity: v.number(),
      salesValue: v.number(),
      currentSoh: v.union(v.number(), v.null()),
      grnQuantity: v.union(v.number(), v.null()),
      mappedProducts: v.number(),
      unresolvedProducts: v.number(),
    }),
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
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { snapshotId, ...fields } = args;
    await ctx.db.patch(snapshotId, { ...fields, status: "completed", errorMessage: null });
    return null;
  },
});

export const fail = mutation({
  args: { snapshotId: v.id("reportSnapshots"), errorMessage: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.snapshotId, {
      status: "failed",
      errorMessage: args.errorMessage,
    });
    return null;
  },
});

/** Recent reports, newest first. What the home screen lists. */
export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<Doc<"reportSnapshots">[]> => {
    return await ctx.db
      .query("reportSnapshots")
      .withIndex("by_createdAt")
      .order("desc")
      .take(Math.min(args.limit ?? 20, 50));
  },
});

export const get = query({
  args: { snapshotId: v.id("reportSnapshots") },
  handler: async (ctx, args): Promise<Doc<"reportSnapshots"> | null> => {
    return await ctx.db.get(args.snapshotId);
  },
});

export const marketplacesFor = query({
  args: { snapshotId: v.id("reportSnapshots") },
  handler: async (ctx, args): Promise<Doc<"snapshotMarketplaces">[]> => {
    return await ctx.db
      .query("snapshotMarketplaces")
      .withIndex("by_snapshotId", (q) => q.eq("snapshotId", args.snapshotId))
      .collect();
  },
});

/**
 * Every row of a snapshot.
 *
 * Collected rather than paginated because the aggregate is small by
 * construction — marketplace by product by month is hundreds of rows, not the
 * hundreds of thousands the raw upload held. The cap is a guard, not a pager.
 */
export const rowsFor = query({
  args: { snapshotId: v.id("reportSnapshots") },
  handler: async (ctx, args): Promise<Doc<"snapshotRows">[]> => {
    return await ctx.db
      .query("snapshotRows")
      .withIndex("by_snapshotId", (q) => q.eq("snapshotId", args.snapshotId))
      .take(ROW_LIMIT);
  },
});

/** Deletes a snapshot and its rows. The only way a snapshot ever changes. */
export const remove = mutation({
  args: { snapshotId: v.id("reportSnapshots") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("snapshotRows")
      .withIndex("by_snapshotId", (q) => q.eq("snapshotId", args.snapshotId))
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);

    const marketplaces = await ctx.db
      .query("snapshotMarketplaces")
      .withIndex("by_snapshotId", (q) => q.eq("snapshotId", args.snapshotId))
      .collect();
    for (const entry of marketplaces) await ctx.db.delete(entry._id);

    await ctx.db.delete(args.snapshotId);
    return null;
  },
});

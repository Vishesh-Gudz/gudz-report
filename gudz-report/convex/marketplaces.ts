import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { normalizeGstin } from "../src/lib/erp/gstin";

/**
 * Marketplace configuration: which customer GSTINs trade as which marketplace.
 *
 * Editable data rather than code. The dashboard needs to say "these orders are
 * Blinkit", and the only stable way to know that is the buyer's registered
 * GSTIN — `channel` is null on about half of real orders and sometimes names a
 * marketplace on an order raised to someone else entirely.
 *
 * GSTINs are normalised on write, not just on read. Storing what someone typed
 * and folding it at query time means two rows that are the same GSTIN look
 * different in the admin UI, and a duplicate check would miss them.
 */

export const list = query({
  args: { includeInactive: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<Doc<"marketplaces">[]> => {
    const rows = await ctx.db.query("marketplaces").collect();
    return args.includeInactive ? rows : rows.filter((row) => row.isActive);
  },
});

export const getByName = query({
  args: { marketplace: v.string() },
  handler: async (ctx, args): Promise<Doc<"marketplaces"> | null> => {
    return await ctx.db
      .query("marketplaces")
      .withIndex("by_marketplace", (q) => q.eq("marketplace", args.marketplace))
      .unique();
  },
});

/**
 * Creates or replaces one marketplace's GSTIN list.
 *
 * Upsert rather than insert: configuring a marketplace twice is a correction,
 * not a second marketplace, and two rows for "blinkit" would silently split its
 * orders across both.
 */
export const upsert = mutation({
  args: {
    marketplace: v.string(),
    customerGstins: v.array(v.string()),
    knownChannelValues: v.optional(v.array(v.string())),
    isActive: v.optional(v.boolean()),
  },
  returns: v.id("marketplaces"),
  handler: async (ctx, args) => {
    const marketplace = args.marketplace.trim().toLowerCase();
    if (!marketplace) throw new Error("Marketplace name is required.");

    const gstins = [
      ...new Set(
        args.customerGstins
          .map((raw) => normalizeGstin(raw))
          .filter((gstin): gstin is string => gstin !== null),
      ),
    ];

    const existing = await ctx.db
      .query("marketplaces")
      .withIndex("by_marketplace", (q) => q.eq("marketplace", marketplace))
      .unique();

    const fields = {
      marketplace,
      customerGstins: gstins,
      knownChannelValues: args.knownChannelValues,
      isActive: args.isActive ?? true,
      updatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return existing._id;
    }
    return await ctx.db.insert("marketplaces", fields);
  },
});

export const remove = mutation({
  args: { id: v.id("marketplaces") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
    return null;
  },
});

/**
 * GSTINs configured under more than one marketplace.
 *
 * A conflict is a configuration error with a quiet failure mode — the same
 * orders would be counted under whichever marketplace happened to be indexed
 * first — so it is surfaced rather than resolved by a tie-break.
 */
export const conflicts = query({
  args: {},
  returns: v.array(
    v.object({ gstin: v.string(), marketplaces: v.array(v.string()) }),
  ),
  handler: async (ctx) => {
    const rows = await ctx.db.query("marketplaces").collect();
    const seen = new Map<string, Set<string>>();

    for (const row of rows) {
      if (!row.isActive) continue;
      for (const gstin of row.customerGstins) {
        const bucket = seen.get(gstin) ?? new Set<string>();
        bucket.add(row.marketplace);
        seen.set(gstin, bucket);
      }
    }

    return [...seen.entries()]
      .filter(([, names]) => names.size > 1)
      .map(([gstin, names]) => ({ gstin, marketplaces: [...names] }));
  },
});

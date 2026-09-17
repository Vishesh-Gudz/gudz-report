import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * Confirmed product mappings: "this marketplace product is that ERP item".
 *
 * The dashboard resolves what it can from identifiers — an EAN that matches a
 * catalogue barcode, a channel mapping recorded in the ERP. This table holds the
 * rest, where a person looked at a candidate and said yes.
 *
 * It is deliberately a separate decision from anything automatic. A confirmed
 * mapping outranks every inferred route, because it is the only one where
 * somebody actually knew. That also means a wrong confirmation is a wrong report
 * with no way to notice, so every row records when it was confirmed and by whom,
 * and `remove` exists to take one back.
 *
 * Identifiers are normalised on write rather than at query time. Storing what
 * someone typed and folding it later means two rows that are the same EAN look
 * different in a list, and a duplicate check would miss them.
 */

function fold(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toUpperCase();
  return trimmed || null;
}

export const listForMarketplace = query({
  args: { marketplace: v.string() },
  handler: async (ctx, args): Promise<Doc<"productMappings">[]> => {
    return await ctx.db
      .query("productMappings")
      .withIndex("by_marketplace", (q) =>
        q.eq("marketplace", args.marketplace.trim().toLowerCase()),
      )
      .collect();
  },
});

export const listAll = query({
  args: {},
  handler: async (ctx): Promise<Doc<"productMappings">[]> => {
    return await ctx.db.query("productMappings").collect();
  },
});

/**
 * Records one confirmation, replacing any earlier one for the same product.
 *
 * Upsert rather than insert: confirming a product twice is a correction, and two
 * rows for one product would let the report resolve it differently depending on
 * which was read first. The match is on either identifier — a product confirmed
 * by EAN and later re-confirmed by marketplace id is still the same product.
 */
export const confirm = mutation({
  args: {
    marketplace: v.string(),
    ean: v.optional(v.union(v.string(), v.null())),
    marketplaceItemId: v.optional(v.union(v.string(), v.null())),
    erpItemId: v.string(),
    erpSku: v.string(),
    erpName: v.string(),
    note: v.optional(v.union(v.string(), v.null())),
    confirmedBy: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.id("productMappings"),
  handler: async (ctx, args): Promise<Id<"productMappings">> => {
    const marketplace = args.marketplace.trim().toLowerCase();
    if (!marketplace) throw new Error("Marketplace is required.");

    const ean = fold(args.ean);
    const marketplaceItemId = fold(args.marketplaceItemId);
    if (!ean && !marketplaceItemId) {
      throw new Error(
        "A mapping needs an EAN or a marketplace item id — otherwise there is nothing to match a row on.",
      );
    }

    const erpItemId = args.erpItemId.trim();
    if (!erpItemId) throw new Error("An ERP item is required.");

    // Either identifier identifies the product. A product confirmed by EAN and
    // later re-confirmed by marketplace id is the same product, not a second one.
    const byEan = ean
      ? await ctx.db
          .query("productMappings")
          .withIndex("by_marketplace_ean", (q) =>
            q.eq("marketplace", marketplace).eq("ean", ean),
          )
          .first()
      : null;

    const byItemId = marketplaceItemId
      ? await ctx.db
          .query("productMappings")
          .withIndex("by_marketplace_itemId", (q) =>
            q.eq("marketplace", marketplace).eq("marketplaceItemId", marketplaceItemId),
          )
          .first()
      : null;

    const existing = byEan ?? byItemId;

    const fields = {
      marketplace,
      ean,
      marketplaceItemId,
      erpItemId,
      erpSku: args.erpSku.trim(),
      erpName: args.erpName.trim(),
      note: args.note?.trim() || null,
      confirmedAt: Date.now(),
      confirmedBy: args.confirmedBy?.trim() || null,
    };

    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return existing._id;
    }
    return await ctx.db.insert("productMappings", fields);
  },
});

export const remove = mutation({
  args: { id: v.id("productMappings") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
    return null;
  },
});

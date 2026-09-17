import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

/**
 * Reconciliation results.
 *
 * Storage and reads only — the matching **rules** are deliberately not here
 * yet. Deciding how a marketplace line maps to an ERP line depends on the real
 * Healthy Master workbook and on a `marketplace → customer GSTIN` mapping that
 * is a business decision, not a technical one. Writing a matcher now would mean
 * inventing both.
 *
 * What this file does fix is the shape of an answer: every result records how
 * the match was made and what the difference was, so a disputed number can be
 * traced to the rule that produced it.
 */

const MATCH_TYPE = v.union(
  v.literal("sku"),
  v.literal("barcode"),
  v.literal("channelMapping"),
  v.literal("customerIdentifier"),
  v.literal("manual"),
  v.literal("none"),
);

const MATCH_STATUS = v.union(
  v.literal("matched"),
  v.literal("unmatched"),
  v.literal("ambiguous"),
  v.literal("ignored"),
);

/**
 * Records results for one import.
 *
 * Batched for the same reason row inserts are: one mutation is one transaction
 * with a bounded write budget, and a month of marketplace lines exceeds it.
 */
export const recordResults = mutation({
  args: {
    importId: v.id("imports"),
    results: v.array(
      v.object({
        excelRowId: v.id("excelRows"),
        salesOrderId: v.union(v.string(), v.null()),
        salesOrderItemId: v.union(v.string(), v.null()),
        matchType: MATCH_TYPE,
        status: MATCH_STATUS,
        quantityDifference: v.union(v.number(), v.null()),
        amountDifference: v.union(v.number(), v.null()),
      }),
    ),
  },
  returns: v.number(),
  handler: async (ctx, args): Promise<number> => {
    const createdAt = Date.now();
    for (const result of args.results) {
      await ctx.db.insert("reconciliation", {
        importId: args.importId,
        createdAt,
        ...result,
      });
    }
    return args.results.length;
  },
});

/**
 * Updates an import's match counters.
 *
 * Kept as an explicit step rather than derived on read: the dashboard lists
 * imports and would otherwise count reconciliation rows per import on every
 * page load.
 */
export const updateImportCounters = mutation({
  args: {
    importId: v.id("imports"),
    matchedRows: v.number(),
    unmatchedRows: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.importId, {
      matchedRows: args.matchedRows,
      unmatchedRows: args.unmatchedRows,
    });
    return null;
  },
});

export const listForImport = query({
  args: {
    importId: v.id("imports"),
    status: v.optional(MATCH_STATUS),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Doc<"reconciliation">[]> => {
    if (args.status) {
      const status = args.status;
      return await ctx.db
        .query("reconciliation")
        .withIndex("by_importId_status", (q) =>
          q.eq("importId", args.importId).eq("status", status),
        )
        .take(args.limit ?? 100);
    }

    return await ctx.db
      .query("reconciliation")
      .withIndex("by_importId", (q) => q.eq("importId", args.importId))
      .take(args.limit ?? 100);
  },
});

/**
 * Match counts for one import.
 *
 * Collects every row on purpose: a count that quietly stopped at a page limit
 * would be reported as a total, and an understated "unmatched" count is exactly
 * the number nobody would question.
 */
export const summaryForImport = query({
  args: { importId: v.id("imports") },
  returns: v.object({
    matched: v.number(),
    unmatched: v.number(),
    ambiguous: v.number(),
    ignored: v.number(),
    total: v.number(),
  }),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("reconciliation")
      .withIndex("by_importId", (q) => q.eq("importId", args.importId))
      .collect();

    const counts = { matched: 0, unmatched: 0, ambiguous: 0, ignored: 0 };
    for (const row of rows) counts[row.status] += 1;

    return { ...counts, total: rows.length };
  },
});

/** Clears results for an import so it can be re-run without duplicates. */
export const clearForImport = mutation({
  args: { importId: v.id("imports") },
  returns: v.number(),
  handler: async (ctx, args): Promise<number> => {
    const rows = await ctx.db
      .query("reconciliation")
      .withIndex("by_importId", (q) => q.eq("importId", args.importId))
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
    return rows.length;
  },
});

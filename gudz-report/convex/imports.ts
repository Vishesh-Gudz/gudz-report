import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * Import lifecycle: create → processing → completed | failed.
 *
 * Nothing here parses a spreadsheet. Parsing is CPU-bound and lives in a Node
 * action (`excel.ts`); these are the transactional bookkeeping steps around it,
 * so a crash mid-parse leaves an import visibly `processing` or `failed` rather
 * than half-written and indistinguishable from a good one.
 */

const IMPORT_STATUS = v.union(
  v.literal("pending"),
  v.literal("processing"),
  v.literal("completed"),
  v.literal("failed"),
);

export const create = mutation({
  args: {
    fileName: v.string(),
    marketplace: v.optional(v.string()),
    sheetName: v.optional(v.string()),
  },
  returns: v.id("imports"),
  handler: async (ctx, args): Promise<Id<"imports">> => {
    return await ctx.db.insert("imports", {
      fileName: args.fileName,
      marketplace: args.marketplace,
      sheetName: args.sheetName,
      uploadedAt: Date.now(),
      status: "pending",
      minDate: null,
      maxDate: null,
      totalRows: 0,
      validRows: 0,
      invalidRows: 0,
      matchedRows: 0,
      unmatchedRows: 0,
      errorMessage: null,
    });
  },
});

export const setStatus = mutation({
  args: {
    importId: v.id("imports"),
    status: IMPORT_STATUS,
    errorMessage: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.importId, {
      status: args.status,
      // Clearing on success matters: a retry that succeeds must not leave the
      // previous failure's message sitting on the record.
      errorMessage: args.status === "failed" ? (args.errorMessage ?? null) : null,
    });
    return null;
  },
});

/**
 * Records the outcome of a parse.
 *
 * `minDate` / `maxDate` are what make the import actionable — they are the
 * window the ERP will be asked for. An import that completes without them can
 * be inspected but not reconciled.
 */
export const recordParseResult = mutation({
  args: {
    importId: v.id("imports"),
    minDate: v.union(v.string(), v.null()),
    maxDate: v.union(v.string(), v.null()),
    totalRows: v.number(),
    validRows: v.number(),
    invalidRows: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.importId, {
      minDate: args.minDate,
      maxDate: args.maxDate,
      totalRows: args.totalRows,
      validRows: args.validRows,
      invalidRows: args.invalidRows,
      status: "completed",
      errorMessage: null,
    });
    return null;
  },
});

/**
 * Persists normalized rows in batches.
 *
 * Batched because a Convex mutation is a single transaction with a bounded
 * write budget, and a marketplace export runs to tens of thousands of lines.
 * The action drives the batching; this just writes one chunk.
 */
export const insertRows = mutation({
  args: {
    importId: v.id("imports"),
    rows: v.array(
      v.object({
        sourceRow: v.number(),
        orderDate: v.union(v.string(), v.null()),
        marketplaceOrderId: v.union(v.string(), v.null()),
        marketplaceItemId: v.union(v.string(), v.null()),
        sku: v.union(v.string(), v.null()),
        barcode: v.union(v.string(), v.null()),
        productName: v.union(v.string(), v.null()),
        quantity: v.union(v.number(), v.null()),
        unitPrice: v.union(v.number(), v.null()),
        grossSales: v.union(v.number(), v.null()),
        rawStatus: v.union(v.string(), v.null()),
        normalizedStatus: v.union(
          v.literal("delivered"),
          v.literal("returned"),
          v.literal("cancelled"),
          v.literal("unknown"),
        ),
      }),
    ),
  },
  returns: v.number(),
  handler: async (ctx, args): Promise<number> => {
    for (const row of args.rows) {
      await ctx.db.insert("excelRows", { importId: args.importId, ...row });
    }
    return args.rows.length;
  },
});

export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<Doc<"imports">[]> => {
    return await ctx.db
      .query("imports")
      .withIndex("by_uploadedAt")
      .order("desc")
      .take(args.limit ?? 50);
  },
});

export const get = query({
  args: { importId: v.id("imports") },
  handler: async (ctx, args): Promise<Doc<"imports"> | null> => {
    return await ctx.db.get(args.importId);
  },
});

/** Rows for one import. Index-scoped: never a full scan across every upload. */
export const rowsForImport = query({
  args: { importId: v.id("imports"), limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<Doc<"excelRows">[]> => {
    return await ctx.db
      .query("excelRows")
      .withIndex("by_importId", (q) => q.eq("importId", args.importId))
      .take(args.limit ?? 100);
  },
});

/**
 * Deletes an import and everything derived from it.
 *
 * Children first: an interrupted delete then leaves orphaned rows still
 * reachable through their import, rather than rows pointing at nothing.
 */
export const remove = mutation({
  args: { importId: v.id("imports") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const reconciliations = await ctx.db
      .query("reconciliation")
      .withIndex("by_importId", (q) => q.eq("importId", args.importId))
      .collect();
    for (const row of reconciliations) await ctx.db.delete(row._id);

    const rows = await ctx.db
      .query("excelRows")
      .withIndex("by_importId", (q) => q.eq("importId", args.importId))
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);

    await ctx.db.delete(args.importId);
    return null;
  },
});

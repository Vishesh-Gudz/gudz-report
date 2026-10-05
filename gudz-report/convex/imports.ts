import { v } from "convex/values";

import { internal } from "./_generated/api";
import { mutation } from "./_generated/server";

/**
 * Starting an import.
 *
 * The browser has already parsed the workbook and reduced it to product-months
 * — see `src/lib/report/compact.ts` for why that reduction is the same answer
 * as processing every row. What arrives here is a few thousand records, not ten
 * megabytes and not 203,000 rows.
 *
 * This mutation returns as soon as the snapshot row exists, and the processing
 * runs on the scheduler. The alternative — holding an HTTP request open for the
 * minutes the ERP reads take — is what the old upload path did, and it is why
 * the upload could not survive a serverless deployment. The browser polls the
 * snapshot's own status instead, which is real state rather than a progress bar
 * invented to fill the wait.
 */

export const compactRecordValidator = v.object({
  month: v.union(v.string(), v.null()),
  barcode: v.union(v.string(), v.null()),
  sku: v.union(v.string(), v.null()),
  marketplaceItemId: v.union(v.string(), v.null()),
  productName: v.union(v.string(), v.null()),
  salesQuantity: v.number(),
  salesValue: v.number(),
  sourceRows: v.number(),
});

export const compactSheetValidator = v.object({
  sheet: v.string(),
  marketplace: v.string(),
  records: v.array(compactRecordValidator),
  sourceRowCount: v.number(),
  minDate: v.union(v.string(), v.null()),
  maxDate: v.union(v.string(), v.null()),
});

export const start = mutation({
  args: {
    sourceFileName: v.string(),
    sheets: v.array(compactSheetValidator),
  },
  returns: v.id("reportSnapshots"),
  handler: async (ctx, args) => {
    const snapshotId = await ctx.db.insert("reportSnapshots", {
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
        dispatchQuantity: null,
        mappedProducts: 0,
        unresolvedProducts: 0,
      },
      dataQuality: [],
      errorMessage: null,
    });

    await ctx.scheduler.runAfter(0, internal.importsRunner.process, {
      snapshotId,
      sheets: args.sheets,
    });

    return snapshotId;
  },
});

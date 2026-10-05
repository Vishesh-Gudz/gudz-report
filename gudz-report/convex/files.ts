import { v } from "convex/values";

import { mutation } from "./_generated/server";

/**
 * Temporary storage for an uploaded workbook.
 *
 * The browser sends the XLSX straight to Convex rather than through the Next.js
 * app. A real marketplace dump is around ten megabytes, and a Vercel function
 * refuses a request body over 4.5 MB — so the hosting platform, not the file,
 * was the thing that made the old upload path impossible. Uploading directly to
 * storage removes that ceiling and keeps the bytes off the web tier entirely.
 *
 * The file is working material, not a record. It exists only until the snapshot
 * that was built from it has been written, and `remove` is called the moment
 * that is true — see `imports.ts`. Nothing here is an archive.
 */

export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Deletes a temporary upload.
 *
 * Tolerates a missing file: cleanup runs on both the success and the failure
 * path, and a retry that finds the file already gone has done its job rather
 * than hit an error.
 */
export const remove = mutation({
  args: { storageId: v.id("_storage") },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      await ctx.storage.delete(args.storageId);
    } catch {
      // Already deleted. Nothing to undo.
    }
    return null;
  },
});

"use node";

import { v } from "convex/values";

import { createErpClient } from "../src/lib/erp/client";
import { buildSnapshotFromCompact } from "../src/lib/report/snapshot-core";
import { api } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { compactSheetValidator } from "./imports";

/**
 * The long half of an import: mapping, three ERP reads, and the write.
 *
 * A Node action, because the ERP client and the report modules are ordinary
 * TypeScript that assume a Node runtime. It runs on the scheduler rather than
 * inside a request, so it is bounded by Convex's action limit rather than by
 * how long a browser or a serverless platform is willing to wait.
 *
 * It deliberately does NOT parse a workbook. An earlier design read the XLSX
 * from Convex file storage and parsed it here; that exhausted the 512 MB Node
 * action ceiling on the real file, measured. Parsing belongs on the one machine
 * in the chain with real memory — the browser — and this receives the result.
 *
 * The credential comes from Convex's own environment. `ERP_API_KEY` is never
 * sent from the browser and never reaches it: `src/lib/erp/client.ts` takes its
 * config as an argument precisely so this is possible.
 */

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is not set on this Convex deployment. Set it with \`npx convex env set ${name} …\`.`,
    );
  }
  return value;
}

export const process_ = internalAction({
  args: {
    snapshotId: v.id("reportSnapshots"),
    sheets: v.array(compactSheetValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { snapshotId, sheets } = args;

    try {
      const erp = createErpClient({
        baseUrl: requireEnv("ERP_API_URL"),
        apiKey: requireEnv("ERP_API_KEY"),
      });

      await buildSnapshotFromCompact({
        sheets,
        erp,
        ports: {
          addMarketplace: async (standing) => {
            await ctx.runMutation(api.snapshots.addMarketplace, {
              snapshotId,
              ...standing,
            });
          },
          clearMarketplaceRows: async (marketplace) => {
            await ctx.runMutation(api.snapshots.clearMarketplaceRows, {
              snapshotId,
              marketplace,
            });
          },
          addRows: async (rows) => {
            await ctx.runMutation(api.snapshots.addRows, { snapshotId, rows });
          },
          complete: async (result) => {
            await ctx.runMutation(api.snapshots.complete, { snapshotId, ...result });
          },
          fail: async (errorMessage) => {
            await ctx.runMutation(api.snapshots.fail, { snapshotId, errorMessage });
          },
          marketplaceConfig: async (marketplace) => {
            const doc = await ctx.runQuery(api.marketplaces.getByName, { marketplace });
            return doc
              ? {
                  customerGstins: doc.customerGstins,
                  erpChannelProvider: doc.erpChannelProvider ?? null,
                }
              : null;
          },
          confirmedMappings: async (marketplace) => {
            const rows = await ctx.runQuery(api.productMappings.listForMarketplace, {
              marketplace,
            });
            return rows.map((row) => ({
              marketplace: row.marketplace,
              ean: row.ean ?? null,
              marketplaceItemId: row.marketplaceItemId ?? null,
              erpItemId: row.erpItemId,
              erpSku: row.erpSku,
              erpName: row.erpName,
            }));
          },
        },
      });
    } catch (cause) {
      // A failure here must leave a failed snapshot rather than one stuck on
      // "processing" forever — the screen polls this status, and a report that
      // never resolves is worse than one that says it broke.
      const message =
        cause instanceof Error ? cause.message : "The report could not be built.";
      try {
        await ctx.runMutation(api.snapshots.fail, { snapshotId, errorMessage: message });
      } catch {
        // Nothing further to try; the scheduler records the thrown error.
      }
      throw cause;
    }

    return null;
  },
});

export { process_ as process };

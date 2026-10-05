// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "../convex/_generated/api";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";

/**
 * Deleting a saved report.
 *
 * The thing worth testing is not that the snapshot goes — one `db.delete` does
 * that — but what goes *with* it and what survives. A report's rows and
 * marketplace standings are meaningless once the snapshot they hang off is
 * gone, so they must go too; marketplace configuration and product mappings are
 * standing decisions a human made, reused by every later report, so they must
 * not. Both halves are silent when wrong: orphaned rows accumulate invisibly,
 * and a cascade that reached too far would only show up the next time somebody
 * noticed their mapping work had vanished.
 *
 * Runs against a real Convex schema, so a foreign-key shape or an index that
 * stopped matching fails here rather than in production.
 */

// Only the modules this test calls, plus the generated ones convex-test needs
// to locate the function root. `importsRunner` is left out on purpose: it is a
// Node action that pulls in the workbook parser and the ERP client, and loading
// all of that to delete a row would make this test depend on it.
const modules = import.meta.glob([
  "../convex/_generated/*.js",
  "../convex/{snapshots,marketplaces,productMappings}.ts",
]);

async function seedSnapshot(
  t: ReturnType<typeof convexTest>,
  sourceFileName: string,
): Promise<Id<"reportSnapshots">> {
  const snapshotId = await t.mutation(api.snapshots.create, { sourceFileName });

  await t.mutation(api.snapshots.addMarketplace, {
    snapshotId,
    marketplace: "blinkit",
    sheetName: "Blinkit",
    status: "completed",
    errorMessage: null,
    periodStart: "2026-06-01",
    periodEnd: "2026-08-31",
    months: ["2026-06", "2026-07", "2026-08"],
    sourceRows: 8451,
    products: 43,
    salesQuantity: 8776,
    salesValue: 1_448_819,
    erpState: "reconciled",
    erpMessage: null,
    grnState: "reconciled",
    grnMessage: null,
    mappedProducts: 40,
    unresolvedProducts: 3,
  });

  await t.mutation(api.snapshots.addRows, {
    snapshotId,
    rows: [
      {
        marketplace: "blinkit",
        month: "2026-06",
        productName: "Ragi Chips - 100 gm",
        sku: "RAGI-100",
        ean: "8906165850653",
        marketplaceItemId: "10180611",
        erpItemId: "item_1",
        currentSoh: 400,
        grn: 21_357,
        salesQuantity: 120,
        salesValue: 12_000,
        damage: 0,
        returned: 0,
        mappingStatus: "matched",
        mappingReason: "Matched on barcode.",
        sourceRows: 9,
      },
      {
        marketplace: "blinkit",
        month: "2026-07",
        productName: "Jowar Puffs - 60 gm",
        sku: "JOWAR-60",
        ean: null,
        marketplaceItemId: "10180612",
        erpItemId: null,
        currentSoh: null,
        grn: null,
        salesQuantity: 80,
        salesValue: 8_000,
        damage: 0,
        returned: 0,
        mappingStatus: "unresolved",
        mappingReason: "No barcode on the sheet.",
        sourceRows: 4,
      },
    ],
  });

  return snapshotId;
}

describe("snapshots.remove", () => {
  test("removes the snapshot and every row beneath it", async () => {
    const t = convexTest(schema, modules);
    const snapshotId = await seedSnapshot(t, "HM Sales Dump.xlsx");

    expect(await t.query(api.snapshots.get, { snapshotId })).not.toBeNull();
    expect(await t.query(api.snapshots.rowsFor, { snapshotId })).toHaveLength(2);
    expect(await t.query(api.snapshots.marketplacesFor, { snapshotId })).toHaveLength(1);

    const result = await t.mutation(api.snapshots.remove, { snapshotId });
    expect(result).toEqual({ deleted: true, rows: 2, marketplaces: 1 });

    expect(await t.query(api.snapshots.get, { snapshotId })).toBeNull();
    expect(await t.query(api.snapshots.rowsFor, { snapshotId })).toEqual([]);
    expect(await t.query(api.snapshots.marketplacesFor, { snapshotId })).toEqual([]);

    // The queries above read through `by_snapshotId`. Read the tables whole, so
    // a row the index would not have found is still caught.
    await t.run(async (ctx) => {
      expect(await ctx.db.query("snapshotRows").collect()).toEqual([]);
      expect(await ctx.db.query("snapshotMarketplaces").collect()).toEqual([]);
      expect(await ctx.db.query("reportSnapshots").collect()).toEqual([]);
    });
  });

  test("leaves marketplace configuration and product mappings alone", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert("marketplaces", {
        marketplace: "blinkit",
        customerGstins: ["29AAGCB1286Q1ZB"],
        isActive: true,
        updatedAt: Date.now(),
      });
      await ctx.db.insert("productMappings", {
        marketplace: "blinkit",
        ean: "8906165850653",
        marketplaceItemId: "10180611",
        erpItemId: "item_1",
        erpSku: "RAGI-100",
        erpName: "Ragi Chips - 100 gm",
        note: "Confirmed against the catalogue.",
        confirmedAt: Date.now(),
        confirmedBy: null,
      });
    });

    const snapshotId = await seedSnapshot(t, "HM Sales Dump.xlsx");
    await t.mutation(api.snapshots.remove, { snapshotId });

    await t.run(async (ctx) => {
      const marketplaces = await ctx.db.query("marketplaces").collect();
      expect(marketplaces).toHaveLength(1);
      expect(marketplaces[0]!.customerGstins).toEqual(["29AAGCB1286Q1ZB"]);

      const mappings = await ctx.db.query("productMappings").collect();
      expect(mappings).toHaveLength(1);
      expect(mappings[0]!.erpItemId).toBe("item_1");
    });
  });

  test("touches only the snapshot it was given", async () => {
    const t = convexTest(schema, modules);
    const doomed = await seedSnapshot(t, "June.xlsx");
    const kept = await seedSnapshot(t, "July.xlsx");

    await t.mutation(api.snapshots.remove, { snapshotId: doomed });

    expect(await t.query(api.snapshots.get, { snapshotId: kept })).not.toBeNull();
    expect(await t.query(api.snapshots.rowsFor, { snapshotId: kept })).toHaveLength(2);
    expect(await t.query(api.snapshots.marketplacesFor, { snapshotId: kept })).toHaveLength(1);

    const listed = await t.query(api.snapshots.list, {});
    expect(listed.map((entry) => entry._id)).toEqual([kept]);
  });

  test("a second delete reports nothing to do rather than failing", async () => {
    const t = convexTest(schema, modules);
    const snapshotId = await seedSnapshot(t, "HM Sales Dump.xlsx");

    await t.mutation(api.snapshots.remove, { snapshotId });
    const again = await t.mutation(api.snapshots.remove, { snapshotId });

    expect(again).toEqual({ deleted: false, rows: 0, marketplaces: 0 });
  });
});

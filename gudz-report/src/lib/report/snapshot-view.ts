import "server-only";

import { anyApi } from "convex/server";

import { getConvexClient } from "../convex/server";

/**
 * Reading a saved report back.
 *
 * Everything here comes out of Convex exactly as it was written. Nothing is
 * recomputed, no ERP call is made, and the workbook is long gone — opening a
 * report from last month must show last month's numbers, not today's stock
 * position quietly substituted underneath. A refreshed view would be a new
 * snapshot, not a mutation of this one.
 */

export type {
  SnapshotRow,
  SnapshotMarketplace,
  SnapshotSummary,
  DataQualityNote,
  SnapshotListing,
  SnapshotView,
  ViewTotals,
} from "./snapshot-model";

import type {
  DataQualityNote,
  SnapshotListing,
  SnapshotMarketplace,
  SnapshotRow,
  SnapshotSummary,
  SnapshotView,
} from "./snapshot-model";

async function read<T>(fn: unknown, args: Record<string, unknown>, fallback: T): Promise<T> {
  const client = getConvexClient();
  if (!client) return fallback;
  try {
    return (await client.query(fn as never, args as never)) as T;
  } catch {
    return fallback;
  }
}

/** Saved reports, newest first. What the home screen lists. */
export async function listSnapshots(limit = 12): Promise<SnapshotListing[]> {
  const docs = await read<Record<string, unknown>[]>(anyApi.snapshots.list, { limit }, []);
  return docs.map((doc) => ({
    id: String(doc._id),
    sourceFileName: String(doc.sourceFileName),
    createdAt: Number(doc.createdAt),
    status: doc.status as SnapshotListing["status"],
    marketplaces: (doc.marketplaces as string[]) ?? [],
    periodStart: (doc.periodStart as string | null) ?? null,
    periodEnd: (doc.periodEnd as string | null) ?? null,
    periodsDiffer: Boolean(doc.periodsDiffer),
  }));
}

/** One saved report, whole. Null when it does not exist or Convex is absent. */
export async function loadSnapshot(snapshotId: string): Promise<SnapshotView | null> {
  const doc = await read<Record<string, unknown> | null>(
    anyApi.snapshots.get,
    { snapshotId },
    null,
  );
  if (!doc) return null;

  const [sections, rows] = await Promise.all([
    read<Record<string, unknown>[]>(anyApi.snapshots.marketplacesFor, { snapshotId }, []),
    read<Record<string, unknown>[]>(anyApi.snapshots.rowsFor, { snapshotId }, []),
  ]);

  return {
    id: String(doc._id),
    sourceFileName: String(doc.sourceFileName),
    createdAt: Number(doc.createdAt),
    status: doc.status as SnapshotView["status"],
    marketplaces: (doc.marketplaces as string[]) ?? [],
    periodStart: (doc.periodStart as string | null) ?? null,
    periodEnd: (doc.periodEnd as string | null) ?? null,
    periodsDiffer: Boolean(doc.periodsDiffer),
    summary: doc.summary as SnapshotSummary,
    dataQuality: (doc.dataQuality as DataQualityNote[]) ?? [],
    errorMessage: (doc.errorMessage as string | null) ?? null,
    sections: sections.map((entry) => ({
      marketplace: String(entry.marketplace),
      sheetName: String(entry.sheetName),
      status: entry.status as SnapshotMarketplace["status"],
      errorMessage: (entry.errorMessage as string | null) ?? null,
      periodStart: (entry.periodStart as string | null) ?? null,
      periodEnd: (entry.periodEnd as string | null) ?? null,
      months: (entry.months as string[]) ?? [],
      sourceRows: Number(entry.sourceRows),
      products: Number(entry.products),
      salesQuantity: Number(entry.salesQuantity),
      salesValue: Number(entry.salesValue),
      erpState: String(entry.erpState),
      erpMessage: (entry.erpMessage as string | null) ?? null,
      grnState: String(entry.grnState),
      grnMessage: (entry.grnMessage as string | null) ?? null,
      mappedProducts: Number(entry.mappedProducts),
      unresolvedProducts: Number(entry.unresolvedProducts),
    })),
    rows: rows.map((row) => ({
      id: String(row._id),
      marketplace: String(row.marketplace),
      month: String(row.month),
      productName: String(row.productName),
      sku: String(row.sku),
      ean: (row.ean as string | null) ?? null,
      marketplaceItemId: (row.marketplaceItemId as string | null) ?? null,
      erpItemId: (row.erpItemId as string | null) ?? null,
      currentSoh: (row.currentSoh as number | null) ?? null,
      dispatch: (row.dispatch as number | null | undefined) ?? null,
      grn: (row.grn as number | null) ?? null,
      salesQuantity: Number(row.salesQuantity),
      salesValue: Number(row.salesValue),
      damage: Number(row.damage),
      returned: Number(row.returned),
      mappingStatus: row.mappingStatus as SnapshotRow["mappingStatus"],
      mappingReason: String(row.mappingReason),
      sourceRows: Number(row.sourceRows),
    })),
  };
}


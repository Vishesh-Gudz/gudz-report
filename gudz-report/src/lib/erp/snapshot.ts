import { z } from "zod";

import {
  ledgerHealthSchema,
  snapshotRowSchema,
  type LedgerHealth,
  type SnapshotRow,
} from "../../types/erp";
import type { ErpClient } from "./client";

/**
 * Current stock position, and the health of the register behind it.
 *
 * `quantity` is what is physically present. `blockedQuantity` is committed
 * elsewhere — open orders, transfers, picklists — and is not sellable.
 * `availableQuantity` is the difference, floored at zero. Read availability from
 * that; reading it from `quantity` is how stock gets oversold.
 *
 * The snapshot comes from the ERP's live balance tables rather than an
 * aggregation of movement history, so it stays cheap no matter how long that
 * history is — and, importantly, it is unaffected by the stock ledger's sync
 * backlog. `getLedgerHealth` reports that backlog, which matters for the ERP's
 * movement reports but not for this one.
 */

export interface SnapshotFilters {
  readonly locationType?: "hub" | "warehouse" | "store";
  readonly locationId?: string;
  readonly itemIds?: ReadonlyArray<string>;
  readonly sku?: string;
  readonly category?: string;
  readonly brand?: string;
  readonly itemType?: string;
  readonly condition?: "good" | "bad" | "damaged" | "expired" | "other";
  /** Keep rows whose on-hand and blocked quantities are both zero. */
  readonly includeZero?: boolean;
  readonly limit?: number;
}

function toQuery(filters: SnapshotFilters | undefined) {
  return {
    locationType: filters?.locationType,
    locationId: filters?.locationId,
    itemIds: filters?.itemIds ? [...filters.itemIds] : undefined,
    sku: filters?.sku,
    category: filters?.category,
    brand: filters?.brand,
    itemType: filters?.itemType,
    condition: filters?.condition,
    includeZero: filters?.includeZero ?? false,
    limit: Math.min(filters?.limit ?? 200, 200),
  } as const;
}

export interface SnapshotPage {
  readonly rows: SnapshotRow[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
  readonly requestId: string;
}

/** One page of live stock positions. */
export async function getSnapshot(
  client: ErpClient,
  filters?: SnapshotFilters,
  options?: { readonly cursor?: string },
): Promise<SnapshotPage> {
  const response = await client.get("/soh/snapshot", z.array(snapshotRowSchema), {
    ...toQuery(filters),
    cursor: options?.cursor,
  });

  return {
    rows: response.data,
    nextCursor: response.pagination?.nextCursor ?? null,
    hasMore: response.pagination?.hasMore ?? false,
    requestId: response.requestId,
  };
}

/** Every live stock position, following the cursor to the end. */
export async function getAllSnapshotRows(
  client: ErpClient,
  filters?: SnapshotFilters,
  options?: { readonly maxPages?: number },
): Promise<{ rows: SnapshotRow[]; pages: number }> {
  const result = await client.getAllPages(
    "/soh/snapshot",
    snapshotRowSchema,
    toQuery(filters),
    { maxPages: options?.maxPages },
  );
  return { rows: result.rows, pages: result.pages };
}

/**
 * How far the ERP's canonical stock ledger is behind the registers feeding it.
 *
 * `status: "degraded"` means the ERP's movement reports would understate
 * activity. It does not invalidate `getSnapshot` or the sales-order feeds, which
 * read different tables — worth knowing before deciding a number is wrong.
 */
export async function getLedgerHealth(client: ErpClient): Promise<LedgerHealth> {
  const response = await client.get("/soh/ledger-health", ledgerHealthSchema);
  return response.data;
}

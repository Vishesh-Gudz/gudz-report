import "server-only";

import type { ErpClient } from "../erp/client";
import { getSnapshot } from "../erp/snapshot";

/**
 * The live stock position, which is the only genuine SOH figure available.
 *
 * What this is: the ERP's current balance per item per location, read from its
 * live balance tables. `availableQuantity` already excludes what is blocked by
 * open orders and picklists, so it is what could actually be promised today.
 *
 * What this is **not**: history. There is no opening or closing SOH here, and
 * none is derived. Deriving them would mean replaying the stock ledger, and the
 * production ledger has a known sync backlog — a number computed from it would
 * look authoritative and be wrong. The report says the historical view is
 * unavailable rather than inventing it.
 *
 * Read in batches by item id rather than pulling the whole snapshot: a report
 * covers a few dozen products, and the full position across every item and
 * location is thousands of rows nobody asked for.
 */

export interface StockPosition {
  readonly itemId: string;
  readonly sku: string;
  readonly name: string;
  /** Physically present, including what is already committed. */
  readonly onHand: number;
  /** Committed to open orders, transfers and picklists. Not sellable. */
  readonly blocked: number;
  /** `onHand` minus `blocked`. Promise against this, never against `onHand`. */
  readonly available: number;
  /** Per location, because "where" is the first question after "how much". */
  readonly locations: ReadonlyArray<{
    readonly name: string;
    readonly code: string | null;
    readonly onHand: number;
    readonly available: number;
  }>;
  /** Most recent balance update across this item's locations. */
  readonly updatedAt: string | null;
}

export interface StockSnapshot {
  readonly byItemId: ReadonlyMap<string, StockPosition>;
  readonly itemsRequested: number;
  readonly itemsFound: number;
  /** False when the ERP could not be reached — distinct from "no stock". */
  readonly available: boolean;
  readonly error: string | null;
}

/** The ERP caps `itemIds` at its page limit; stay under it. */
const BATCH = 50;

export function emptyStockSnapshot(error: string | null = null): StockSnapshot {
  return {
    byItemId: new Map(),
    itemsRequested: 0,
    itemsFound: 0,
    available: error === null,
    error,
  };
}

export async function fetchStockPositions(
  client: ErpClient,
  itemIds: ReadonlyArray<string>,
): Promise<StockSnapshot> {
  const unique = [...new Set(itemIds.filter((id) => id.trim() !== ""))];
  if (unique.length === 0) return emptyStockSnapshot();

  const byItemId = new Map<string, StockPosition>();

  try {
    for (let offset = 0; offset < unique.length; offset += BATCH) {
      const batch = unique.slice(offset, offset + BATCH);

      // `includeZero` is on deliberately: a product with no stock is a real and
      // interesting answer, and omitting it would be indistinguishable from the
      // ERP not knowing the product at all.
      const page = await getSnapshot(client, {
        itemIds: batch,
        includeZero: true,
        limit: 200,
      });

      for (const row of page.rows) {
        const existing = byItemId.get(row.itemId);
        const location = {
          name: row.location.name ?? row.location.code ?? "Unknown location",
          code: row.location.code,
          onHand: row.quantity,
          available: row.availableQuantity,
        };

        if (!existing) {
          byItemId.set(row.itemId, {
            itemId: row.itemId,
            sku: row.sku,
            name: row.name,
            onHand: row.quantity,
            blocked: row.blockedQuantity,
            available: row.availableQuantity,
            locations: [location],
            updatedAt: row.updatedAt,
          });
          continue;
        }

        // One item, several locations: the position is their sum.
        byItemId.set(row.itemId, {
          ...existing,
          onHand: existing.onHand + row.quantity,
          blocked: existing.blocked + row.blockedQuantity,
          available: existing.available + row.availableQuantity,
          locations: [...existing.locations, location],
          updatedAt:
            existing.updatedAt && row.updatedAt
              ? existing.updatedAt.localeCompare(row.updatedAt) >= 0
                ? existing.updatedAt
                : row.updatedAt
              : (existing.updatedAt ?? row.updatedAt),
        });
      }
    }
  } catch (cause) {
    return {
      byItemId,
      itemsRequested: unique.length,
      itemsFound: byItemId.size,
      available: false,
      error:
        cause instanceof Error
          ? cause.message
          : "The ERP stock position could not be read.",
    };
  }

  return {
    byItemId,
    itemsRequested: unique.length,
    itemsFound: byItemId.size,
    available: true,
    error: null,
  };
}

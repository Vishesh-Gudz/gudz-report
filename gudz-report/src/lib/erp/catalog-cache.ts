import "server-only";

import type { CatalogItem } from "../../types/erp";
import { getAllCatalogItems } from "./catalog";
import type { ErpClient } from "./client";

/**
 * The ERP catalogue, fetched once and reused.
 *
 * The catalogue is the mapping layer's lookup table: every marketplace EAN is
 * resolved against it. It is also the most expensive read in the report —
 * 3,067 items over 16 cursor pages, about twenty seconds — and it is the same
 * answer for every marketplace, every period and every user.
 *
 * So it is held in process with a short TTL. Deliberately not mirrored into
 * Convex: a catalogue copy that drifts is worse than a slow read, because a
 * product renamed or re-barcoded in the ERP would keep reconciling against the
 * old value with nothing on screen to say so. A few minutes of staleness is the
 * most this trades away, and `invalidateCatalog` exists for when even that is
 * too much.
 *
 * In-flight requests share one promise. Two dashboard tabs opened together
 * would otherwise each start their own sixteen-page walk.
 */

/** Long enough to cover a working session, short enough that edits show up. */
const TTL_MS = 10 * 60 * 1000;

interface CacheEntry {
  readonly items: CatalogItem[];
  readonly pages: number;
  readonly fetchedAt: number;
}

let cached: CacheEntry | null = null;
let inFlight: Promise<CacheEntry> | null = null;

export interface CatalogSnapshot {
  readonly items: CatalogItem[];
  readonly pages: number;
  readonly fetchedAt: number;
  readonly fromCache: boolean;
}

export async function getCatalogSnapshot(
  client: ErpClient,
  options?: { readonly maxAgeMs?: number },
): Promise<CatalogSnapshot> {
  const maxAge = options?.maxAgeMs ?? TTL_MS;

  if (cached && Date.now() - cached.fetchedAt < maxAge) {
    return { ...cached, fromCache: true };
  }

  if (!inFlight) {
    inFlight = getAllCatalogItems(client, { includeIdentifiers: true })
      .then((result) => {
        const entry: CacheEntry = {
          items: result.items,
          pages: result.pages,
          fetchedAt: Date.now(),
        };
        cached = entry;
        return entry;
      })
      .finally(() => {
        inFlight = null;
      });
  }

  return { ...(await inFlight), fromCache: false };
}

/** Drops the cached catalogue. For tests and for an explicit refresh. */
export function invalidateCatalog(): void {
  cached = null;
}

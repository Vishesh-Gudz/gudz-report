import { z } from "zod";

import { catalogItemSchema, type CatalogItem } from "../../types/erp";
import { isCursorPagination } from "../../types/erp";
import type { ErpClient } from "./client";

/**
 * The SKU master and every identifier a spreadsheet row can be matched against.
 *
 * This is the join surface for the Excel half of the report. In descending
 * order of how safe they are to match on: `sku` (the ERP's own code), `barcode`
 * with `barcodeType` (an EAN lives here as `ean13` — there is no separate EAN
 * column), `channelItemMappings` (a recorded decision that a marketplace key
 * *is* this product, and therefore authoritative), `customerItemIdentifiers` (a
 * specific customer's own article code), and `searchTags` (free-form aliases:
 * useful to a human, too loose to auto-match on).
 *
 * Production reality: these are sparse. Across a sample of finished goods,
 * barcode was set on roughly one in six and channel mappings on fewer. A matcher
 * must treat every identifier as optional and fall back, not assume a key.
 */

export interface CatalogFilters {
  /** Case-insensitive substring over SKU, name and barcode. */
  readonly search?: string;
  readonly itemIds?: ReadonlyArray<string>;
  /** Exact and case-sensitive — send the stored value. */
  readonly category?: string;
  /** Exact and case-sensitive — send the stored value. */
  readonly brand?: string;
  readonly itemType?: string;
  readonly isActive?: boolean;
  /** Set false to skip the identifier lookups entirely for a lighter sync. */
  readonly includeIdentifiers?: boolean;
  readonly limit?: number;
}

function toQuery(filters: CatalogFilters | undefined) {
  return {
    search: filters?.search,
    itemIds: filters?.itemIds ? [...filters.itemIds] : undefined,
    category: filters?.category,
    brand: filters?.brand,
    itemType: filters?.itemType,
    isActive: filters?.isActive,
    includeIdentifiers: filters?.includeIdentifiers ?? true,
    limit: Math.min(filters?.limit ?? 200, 200),
  } as const;
}

export interface CatalogPage {
  readonly items: CatalogItem[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
  readonly requestId: string;
}

/** One page of catalogue items. */
export async function getCatalog(
  client: ErpClient,
  filters?: CatalogFilters,
  options?: { readonly cursor?: string },
): Promise<CatalogPage> {
  const response = await client.get("/soh/catalog", z.array(catalogItemSchema), {
    ...toQuery(filters),
    cursor: options?.cursor,
  });

  return {
    items: response.data,
    // These endpoints page by cursor; the narrowing keeps the shared response
    // type honest now that the ERP's offset-paged modules use it too.
    nextCursor: isCursorPagination(response.pagination)
      ? response.pagination.nextCursor
      : null,
    hasMore: isCursorPagination(response.pagination)
      ? response.pagination.hasMore
      : false,
    requestId: response.requestId,
  };
}

/**
 * The whole catalogue, following the cursor to the end.
 *
 * Intended to be run once per sync and cached, not per reconciliation: the
 * matcher needs the full identifier set in memory, and paging it on every match
 * would be both slow and pointlessly hard on the ERP.
 */
export async function getAllCatalogItems(
  client: ErpClient,
  filters?: CatalogFilters,
  options?: { readonly maxPages?: number },
): Promise<{ items: CatalogItem[]; pages: number }> {
  const result = await client.getAllPages(
    "/soh/catalog",
    catalogItemSchema,
    toQuery(filters),
    { maxPages: options?.maxPages },
  );
  return { items: result.rows, pages: result.pages };
}

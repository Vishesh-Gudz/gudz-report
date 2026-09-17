import type { CatalogItem } from "../../types/erp";
import type { NormalizedExcelRow } from "../../types/excel";

/**
 * Turning a marketplace's product into an ERP product.
 *
 * This is the join the whole report rests on, and it is not one lookup — it is a
 * chain, because neither side shares an identifier with the other:
 *
 *   marketplace item id → (Master) → EAN → (ERP catalogue `barcode`) → ERP SKU
 *
 * The first two steps happen at import time (`excel/master-sheet.ts`). This
 * module does the second half, against the ERP catalogue.
 *
 * Measured against the real Healthy Master catalogue, the identifiers are
 * sparse: 3,067 items, 446 with any barcode at all, and only 223 of those look
 * like an EAN — the rest are HSN codes and internal numbers sitting in the
 * barcode field. Eighty-three barcodes are shared by more than one item. A
 * matcher that assumed a key existed, or that picked the first of several
 * candidates, would produce a report that is confidently wrong.
 *
 * So every row lands in exactly one of three states, and all three are shown:
 *
 *   - `mapped`    — exactly one ERP item, reached by a named route
 *   - `ambiguous` — an identifier matched, but several items claim it
 *   - `unmapped`  — no identifier matched; name candidates may be offered
 *
 * A name match is never silently accepted. It is offered as a candidate for a
 * human to confirm, because "Healthy Master Baked Chips" is a plausible name for
 * six different products in this catalogue.
 */

/** How a row reached its ERP item. Ordered most to least authoritative. */
export type MappingRoute =
  /** A channel mapping recorded in the ERP: someone stated this key *is* this item. */
  | "channelMapping"
  /** The marketplace's EAN equals the item's barcode. */
  | "barcode"
  /** The row already carried the ERP's own SKU. */
  | "sku"
  /** Name similarity only. Never auto-accepted — always a candidate. */
  | "nameSuggestion";

export type MappingStatus = "mapped" | "ambiguous" | "unmapped";

export interface MappingCandidate {
  readonly itemId: string;
  readonly sku: string;
  readonly name: string;
  readonly barcode: string | null;
}

export interface ProductMapping {
  readonly status: MappingStatus;
  readonly route: MappingRoute | null;
  /** Set only when `status` is `mapped`. */
  readonly item: MappingCandidate | null;
  /** Set when `status` is `ambiguous` — every candidate, never narrowed silently. */
  readonly candidates: ReadonlyArray<MappingCandidate>;
  /** Plain-English reason, shown in the data-quality view. */
  readonly reason: string;
}

/** Identifiers a row can be matched on, independent of any one marketplace. */
export interface MappableRow {
  readonly marketplaceItemId?: string | null;
  readonly barcode?: string | null;
  readonly sku?: string | null;
  readonly productName?: string | null;
}

export interface MappingOptions {
  /**
   * The ERP `channelItemMappings.provider` this marketplace trades under, when
   * one is configured. Passed in rather than derived: the ERP's provider
   * vocabulary is the ERP's, and hard-coding a marketplace name here is exactly
   * what keeps a dashboard from supporting the next one.
   */
  readonly channelProvider?: string | null;
  /**
   * Offer a name-similarity candidate when nothing else matched. On by default:
   * a suggestion a human can confirm beats a bare "unmapped".
   */
  readonly suggestByName?: boolean;
}

function fold(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toUpperCase();
  return trimmed || null;
}

function toCandidate(item: CatalogItem): MappingCandidate {
  return {
    itemId: item.itemId,
    sku: item.sku,
    name: item.name,
    barcode: item.barcode,
  };
}

/**
 * Words too common in this catalogue to carry any signal.
 *
 * Every product is "Healthy Master" something, so leaving the brand in would
 * make every pair of products look similar and turn the name suggestion into
 * noise.
 */
const STOP_WORDS = new Set([
  "healthy", "master", "and", "the", "with", "pack", "of", "gm", "g", "kg",
  "ml", "pcs", "pc", "combo", "light", "crispy", "baked",
]);

function nameTokens(value: string | null | undefined): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2 && !STOP_WORDS.has(token)),
  );
}

function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

/** Below this, a name match is not even worth offering as a candidate. */
const NAME_SUGGESTION_FLOOR = 0.5;

/**
 * Every way into the catalogue, built once per report.
 *
 * Built once rather than searched per row because a marketplace month is tens of
 * thousands of rows against three thousand catalogue items, and a linear scan
 * per row is work for nothing.
 */
export class CatalogIndex {
  private readonly bySku = new Map<string, CatalogItem>();
  private readonly byBarcode = new Map<string, CatalogItem[]>();
  private readonly byChannelKey = new Map<string, CatalogItem[]>();
  private readonly tokensByItemId = new Map<string, Set<string>>();

  readonly items: ReadonlyArray<CatalogItem>;

  constructor(items: ReadonlyArray<CatalogItem>) {
    this.items = items;

    for (const item of items) {
      const sku = fold(item.sku);
      // First wins: a duplicate SKU is an ERP data issue, and overwriting would
      // silently resolve it in favour of whichever page arrived last.
      if (sku && !this.bySku.has(sku)) this.bySku.set(sku, item);

      const barcode = fold(item.barcode);
      if (barcode) {
        this.byBarcode.set(barcode, [...(this.byBarcode.get(barcode) ?? []), item]);
      }

      for (const mapping of item.channelItemMappings) {
        if (mapping.action !== "map" || !mapping.isActive) continue;
        const key = channelKey(mapping.provider, mapping.externalKey);
        if (!key) continue;
        this.byChannelKey.set(key, [...(this.byChannelKey.get(key) ?? []), item]);
        const externalSku = channelKey(mapping.provider, mapping.externalSku);
        if (externalSku) {
          this.byChannelKey.set(externalSku, [
            ...(this.byChannelKey.get(externalSku) ?? []),
            item,
          ]);
        }
      }

      this.tokensByItemId.set(item.itemId, nameTokens(item.name));
    }
  }

  get counts(): {
    readonly items: number;
    readonly withBarcode: number;
    readonly withChannelMapping: number;
    readonly duplicateBarcodes: number;
  } {
    return {
      items: this.items.length,
      withBarcode: this.byBarcode.size,
      withChannelMapping: this.byChannelKey.size,
      duplicateBarcodes: [...this.byBarcode.values()].filter(
        (bucket) => bucket.length > 1,
      ).length,
    };
  }

  /** Items sharing one barcode. Reported, never tie-broken. */
  itemsForBarcode(barcode: string | null | undefined): CatalogItem[] {
    const key = fold(barcode);
    return key ? (this.byBarcode.get(key) ?? []) : [];
  }

  itemForSku(sku: string | null | undefined): CatalogItem | null {
    const key = fold(sku);
    return key ? (this.bySku.get(key) ?? null) : null;
  }

  itemsForChannelKey(
    provider: string | null | undefined,
    externalKey: string | null | undefined,
  ): CatalogItem[] {
    const key = channelKey(provider, externalKey);
    return key ? (this.byChannelKey.get(key) ?? []) : [];
  }

  /** Best name candidates, above the floor. Suggestions only. */
  suggestByName(productName: string | null | undefined, limit = 3): MappingCandidate[] {
    const tokens = nameTokens(productName);
    if (tokens.size === 0) return [];

    const scored: { item: CatalogItem; score: number }[] = [];
    for (const item of this.items) {
      const score = similarity(tokens, this.tokensByItemId.get(item.itemId) ?? new Set());
      if (score >= NAME_SUGGESTION_FLOOR) scored.push({ item, score });
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((entry) => toCandidate(entry.item));
  }
}

function channelKey(
  provider: string | null | undefined,
  externalKey: string | null | undefined,
): string | null {
  const p = fold(provider);
  const k = fold(externalKey);
  return p && k ? `${p} ${k}` : null;
}

const UNMAPPED_NO_IDENTIFIER =
  "The row carries no EAN, marketplace item id or SKU, so there is nothing to match on.";
const UNMAPPED_NO_MATCH =
  "No catalogue item carries this EAN as its barcode, and no channel mapping or SKU matched.";

/** Resolves one row to an ERP item, or explains why it could not be. */
export function resolveProduct(
  row: MappableRow,
  catalog: CatalogIndex,
  options?: MappingOptions,
): ProductMapping {
  const hasIdentifier =
    fold(row.barcode) !== null ||
    fold(row.sku) !== null ||
    fold(row.marketplaceItemId) !== null;

  if (!hasIdentifier && !fold(row.productName)) {
    return {
      status: "unmapped",
      route: null,
      item: null,
      candidates: [],
      reason: UNMAPPED_NO_IDENTIFIER,
    };
  }

  // 1. A recorded channel mapping. Someone stated this key is this item, which
  //    beats any identifier we could infer.
  if (options?.channelProvider) {
    for (const key of [row.marketplaceItemId, row.sku, row.barcode]) {
      const hits = catalog.itemsForChannelKey(options.channelProvider, key);
      if (hits.length === 1) {
        return mapped(hits[0]!, "channelMapping");
      }
      if (hits.length > 1) {
        return ambiguous(
          hits,
          "channelMapping",
          `The ${options.channelProvider} channel mapping for "${key}" points at ${hits.length} catalogue items.`,
        );
      }
    }
  }

  // 2. EAN against the catalogue's barcode. The main route for this workbook.
  for (const value of [row.barcode, row.sku]) {
    const hits = catalog.itemsForBarcode(value);
    if (hits.length === 1) return mapped(hits[0]!, "barcode");
    if (hits.length > 1) {
      return ambiguous(
        hits,
        "barcode",
        `Barcode ${fold(value)} is shared by ${hits.length} catalogue items, so which one sold cannot be decided from the data.`,
      );
    }
  }

  // 3. The row already carrying an ERP SKU. Rare from a marketplace, but free.
  for (const value of [row.sku, row.marketplaceItemId]) {
    const item = catalog.itemForSku(value);
    if (item) return mapped(item, "sku");
  }

  // 4. Name similarity — a suggestion for a human, never a decision.
  if (options?.suggestByName !== false) {
    const suggestions = catalog.suggestByName(row.productName);
    if (suggestions.length > 0) {
      // Still `unmapped`: a name guess is not a mapping, and calling it
      // `ambiguous` would let the KPI read "0 unmapped" for a sheet where
      // nothing was actually resolved. The candidates ride along so a human
      // can confirm one.
      return {
        status: "unmapped",
        route: "nameSuggestion",
        item: null,
        candidates: suggestions,
        reason:
          "No identifier matched. The closest catalogue items by name are offered " +
          "as candidates and must be confirmed by a human before they count.",
      };
    }
  }

  return {
    status: "unmapped",
    route: null,
    item: null,
    candidates: [],
    reason: UNMAPPED_NO_MATCH,
  };
}

function mapped(item: CatalogItem, route: MappingRoute): ProductMapping {
  return {
    status: "mapped",
    route,
    item: toCandidate(item),
    candidates: [toCandidate(item)],
    reason: ROUTE_REASONS[route],
  };
}

function ambiguous(
  items: ReadonlyArray<CatalogItem>,
  route: MappingRoute,
  reason: string,
): ProductMapping {
  return {
    status: "ambiguous",
    route,
    item: null,
    candidates: items.map(toCandidate),
    reason,
  };
}

const ROUTE_REASONS: Record<MappingRoute, string> = {
  channelMapping: "Matched a channel mapping recorded in the ERP.",
  barcode: "The row's EAN matches this catalogue item's barcode.",
  sku: "The row already carried the ERP's own SKU.",
  nameSuggestion: "Name similarity only — needs confirmation.",
};

export interface MappedExcelRow {
  readonly row: NormalizedExcelRow;
  readonly mapping: ProductMapping;
  /**
   * The key both sides are aggregated on.
   *
   * The ERP SKU when the row mapped; otherwise the row's own EAN or item id, so
   * an unmapped row still contributes its quantity and revenue to the report as
   * an Excel-only SKU rather than vanishing from the totals.
   */
  readonly key: string;
  readonly keyIsErpSku: boolean;
}

export interface MappingStatistics {
  readonly rows: number;
  readonly mapped: number;
  readonly ambiguous: number;
  readonly unmapped: number;
  /** Distinct products, which is the number a human can actually act on. */
  readonly distinctProducts: number;
  readonly distinctMapped: number;
  readonly distinctAmbiguous: number;
  readonly distinctUnmapped: number;
  readonly byRoute: Readonly<Record<MappingRoute, number>>;
  /** Quantity and revenue that did not reach an ERP item. The cost of the gaps. */
  readonly unmappedQuantity: number;
  readonly unmappedRevenue: number;
}

/**
 * Maps every row, and never drops one.
 *
 * Rows are resolved per distinct identifier rather than per row: a marketplace
 * month repeats the same seventeen products across eight thousand rows, and
 * running the name-similarity scan eight thousand times would be the slowest
 * part of the report by a wide margin.
 */
export function mapExcelRows(
  rows: ReadonlyArray<NormalizedExcelRow>,
  catalog: CatalogIndex,
  options?: MappingOptions,
): { readonly rows: MappedExcelRow[]; readonly statistics: MappingStatistics } {
  const cache = new Map<string, ProductMapping>();
  const mappedRows: MappedExcelRow[] = [];

  const productKeys = new Map<string, MappingStatus>();
  const byRoute: Record<MappingRoute, number> = {
    channelMapping: 0,
    barcode: 0,
    sku: 0,
    nameSuggestion: 0,
  };
  let unmappedQuantity = 0;
  let unmappedRevenue = 0;

  for (const row of rows) {
    const identity = [
      fold(row.barcode) ?? "",
      fold(row.sku) ?? "",
      fold(row.marketplaceItemId) ?? "",
      fold(row.productName) ?? "",
    ].join(" ");

    let mapping = cache.get(identity);
    if (!mapping) {
      mapping = resolveProduct(row, catalog, options);
      cache.set(identity, mapping);
    }

    const fallbackKey =
      fold(row.barcode) ?? fold(row.sku) ?? fold(row.marketplaceItemId);
    const key = mapping.item ? fold(mapping.item.sku)! : (fallbackKey ?? "(unidentified)");

    mappedRows.push({
      row,
      mapping,
      key,
      keyIsErpSku: mapping.item !== null,
    });

    if (mapping.route) byRoute[mapping.route] += 1;
    if (mapping.status !== "mapped") {
      unmappedQuantity += row.quantity ?? 0;
      unmappedRevenue += row.grossSales ?? 0;
    }

    // A product counts once, under its worst outcome — an identifier that is
    // ambiguous on one row is ambiguous for the product.
    const previous = productKeys.get(identity);
    if (previous === undefined || rank(mapping.status) > rank(previous)) {
      productKeys.set(identity, mapping.status);
    }
  }

  const statuses = [...productKeys.values()];

  return {
    rows: mappedRows,
    statistics: {
      rows: mappedRows.length,
      mapped: mappedRows.filter((entry) => entry.mapping.status === "mapped").length,
      ambiguous: mappedRows.filter((entry) => entry.mapping.status === "ambiguous").length,
      unmapped: mappedRows.filter((entry) => entry.mapping.status === "unmapped").length,
      distinctProducts: statuses.length,
      distinctMapped: statuses.filter((status) => status === "mapped").length,
      distinctAmbiguous: statuses.filter((status) => status === "ambiguous").length,
      distinctUnmapped: statuses.filter((status) => status === "unmapped").length,
      byRoute,
      unmappedQuantity,
      unmappedRevenue,
    },
  };
}

/** `unmapped` is worse than `ambiguous`, which is worse than `mapped`. */
function rank(status: MappingStatus): number {
  return status === "unmapped" ? 2 : status === "ambiguous" ? 1 : 0;
}

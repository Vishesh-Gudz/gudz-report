import type { MarketplaceErpState, SohReport } from "./soh-report";
import type {
  SkuErpOrderRef,
  SkuExcelRowRef,
  SkuMatchStatus,
} from "./sku-reconciliation";

/**
 * One product on one marketplace, as the report shows it.
 *
 * Marketplace is part of the row, not a filter applied to it. The same product
 * sold on Blinkit and on Zepto is two records with two sell-out figures, two
 * periods and — where configured — two ERP counterparts. Keying on SKU alone
 * would silently add them together and report a product that exists nowhere.
 *
 * A flat, already-decided shape because this crosses into a table and a detail
 * panel: anything left undecided here gets decided twice, once in each, and
 * eventually differently. The `Map` of stock positions in particular does not
 * survive serialisation, so it is resolved while it still exists.
 *
 * `stockAvailable` is nullable and that nullability is load-bearing. Null means
 * the ERP holds no position for this product; zero means it holds one and it is
 * zero. Collapsing the two turns "unknown" into "none".
 */

export type MappingState =
  /** A person confirmed which ERP product this marketplace listing is. */
  | "confirmed"
  /** An identifier resolved it — barcode, ERP SKU, or a channel mapping. */
  | "matched"
  /** The marketplace sold it and nothing in the ERP could be tied to it. */
  | "unresolved"
  /** An ERP product with no marketplace side at all, so nothing to map. */
  | "erpSide";

export interface SohProductRow {
  /** Unique per marketplace, which is what keeps the table's keys honest. */
  readonly id: string;
  readonly marketplace: string;
  readonly sku: string;
  readonly erpItemId: string | null;
  readonly productName: string;
  readonly ean: string | null;
  readonly marketplaceItemId: string | null;

  readonly periodFrom: string | null;
  readonly periodTo: string | null;

  readonly stockAvailable: number | null;
  readonly stockOnHand: number | null;
  readonly stockBlocked: number | null;
  readonly stockLocations: ReadonlyArray<{
    readonly name: string;
    readonly onHand: number;
    readonly available: number;
  }>;
  readonly stockUpdatedAt: string | null;

  /** Null when this marketplace has no ERP customer configured. */
  readonly sellIn: number | null;
  readonly sellOut: number;
  readonly quantityVariance: number | null;
  readonly quantityVariancePct: number | null;

  readonly sellInRevenue: number | null;
  readonly sellOutRevenue: number;
  readonly revenueVariance: number | null;

  readonly status: SkuMatchStatus;
  readonly erpState: MarketplaceErpState;
  readonly mapping: MappingState;
  readonly mappingReason: string;

  readonly erpOrders: number;
  readonly erpLines: number;
  readonly sourceRows: number;
  readonly erpOrderRefs: ReadonlyArray<SkuErpOrderRef>;
  readonly sourceRowRefs: ReadonlyArray<SkuExcelRowRef>;
}

const MAPPING_REASONS: Record<MappingState, string> = {
  confirmed:
    "A person confirmed which ERP product this marketplace listing is. Confirmed mappings override every automatic match.",
  matched:
    "Matched automatically on a shared identifier — the EAN against the ERP barcode, or the ERP's own SKU.",
  unresolved:
    "This marketplace product could not be tied to an ERP product, so its sell-out is counted but has no sell-in to compare against.",
  erpSide:
    "An ERP product with no matching line in the marketplace report for this period.",
};

export interface SohTotals {
  readonly marketplaces: number;
  readonly products: number;
  readonly mappedProducts: number;
  readonly unresolvedProducts: number;
  readonly stockAvailable: number;
  readonly stockProducts: number;
  /** Only across marketplaces whose ERP side is configured and was read. */
  readonly sellIn: number;
  readonly sellInRevenue: number;
  readonly sellOut: number;
  readonly sellOutRevenue: number;
  readonly quantityVariance: number;
  /** How many marketplaces contributed a sell-in figure at all. */
  readonly reconciledMarketplaces: number;
}

/**
 * Builds every row across every marketplace.
 *
 * `confirmedByMarketplace` tells a confirmed mapping apart from an automatic
 * one: the reconciliation groups on the resolved ERP SKU and no longer knows
 * which route produced it, and a confirmation belongs to one marketplace, so the
 * lookup is per marketplace rather than global.
 */
export function buildSohRows(
  report: SohReport,
  confirmedByMarketplace: ReadonlyMap<string, ReadonlySet<string>>,
): SohProductRow[] {
  const rows: SohProductRow[] = [];

  for (const section of report.sections) {
    if (section.status === "failed") continue;
    const confirmed = confirmedByMarketplace.get(section.marketplace) ?? new Set<string>();
    const reconciled = section.erpState === "reconciled";

    for (const row of section.rows) {
      const position = row.erpItemId ? report.stock.byItemId.get(row.erpItemId) : undefined;

      const mapping: MappingState =
        row.status === "erpOnly" && row.excelRows === 0
          ? "erpSide"
          : confirmed.has(row.sku.toUpperCase())
            ? "confirmed"
            : row.mappedToErp
              ? "matched"
              : "unresolved";

      rows.push({
        id: `${section.marketplace}::${row.sku}`,
        marketplace: section.marketplace,
        sku: row.sku,
        erpItemId: row.erpItemId,
        productName: row.productName,
        ean: row.ean,
        marketplaceItemId: row.marketplaceItemId,

        periodFrom: section.period?.fromDay ?? null,
        periodTo: section.period?.toDay ?? null,

        stockAvailable: position ? position.available : null,
        stockOnHand: position ? position.onHand : null,
        stockBlocked: position ? position.blocked : null,
        stockLocations: position
          ? position.locations.map((entry) => ({
              name: entry.name,
              onHand: entry.onHand,
              available: entry.available,
            }))
          : [],
        stockUpdatedAt: position?.updatedAt ?? null,

        // Null rather than zero when the marketplace has no ERP customer: a
        // zero would read as "we invoiced nothing", which is a claim this
        // report is in no position to make.
        sellIn: reconciled ? row.erpQuantity : null,
        sellOut: row.excelQuantity,
        quantityVariance: reconciled ? row.quantityVariance : null,
        quantityVariancePct: reconciled ? row.quantityVariancePct : null,

        sellInRevenue: reconciled ? row.erpRevenue : null,
        sellOutRevenue: row.excelRevenue,
        revenueVariance: reconciled ? row.amountVariance : null,

        status: row.status,
        erpState: section.erpState,
        mapping,
        mappingReason: MAPPING_REASONS[mapping],

        erpOrders: row.erpOrders,
        erpLines: row.erpLines,
        sourceRows: row.excelRows,
        erpOrderRefs: row.erpOrderRefs,
        sourceRowRefs: row.excelRowRefs,
      });
    }
  }

  return rows;
}

/**
 * Totals for a set of rows.
 *
 * Summed from the rows on screen rather than from the sections, so a filtered
 * view totals what it shows. Stock is summed per distinct ERP item, not per row:
 * one product sold on three marketplaces has one stock position, and adding it
 * three times would treble the warehouse.
 */
export function totalsFor(rows: ReadonlyArray<SohProductRow>): SohTotals {
  const seenStockItems = new Set<string>();
  let stockAvailable = 0;

  let sellIn = 0;
  let sellInRevenue = 0;
  let sellOut = 0;
  let sellOutRevenue = 0;
  let mappedProducts = 0;
  let unresolvedProducts = 0;

  for (const row of rows) {
    if (row.erpItemId && row.stockAvailable !== null && !seenStockItems.has(row.erpItemId)) {
      seenStockItems.add(row.erpItemId);
      stockAvailable += row.stockAvailable;
    }
    if (row.sellIn !== null) {
      sellIn += row.sellIn;
      sellInRevenue += row.sellInRevenue ?? 0;
    }
    sellOut += row.sellOut;
    sellOutRevenue += row.sellOutRevenue;

    if (row.mapping === "unresolved") unresolvedProducts += 1;
    else if (row.mapping !== "erpSide") mappedProducts += 1;
  }

  return {
    marketplaces: new Set(rows.map((row) => row.marketplace)).size,
    products: rows.length,
    mappedProducts,
    unresolvedProducts,
    stockAvailable,
    stockProducts: seenStockItems.size,
    sellIn,
    sellInRevenue,
    sellOut,
    sellOutRevenue,
    quantityVariance: sellOut - sellIn,
    reconciledMarketplaces: new Set(
      rows.filter((row) => row.sellIn !== null).map((row) => row.marketplace),
    ).size,
  };
}

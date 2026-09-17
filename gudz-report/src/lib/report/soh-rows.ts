import type { MarketplaceReport } from "./marketplace-report";
import type { SkuMatchStatus, SkuErpOrderRef, SkuExcelRowRef } from "./sku-reconciliation";

/**
 * One product, as the report shows it.
 *
 * A flat, already-decided shape rather than the reconciliation's nested one, for
 * a specific reason: this crosses the server/client boundary into a table and a
 * detail panel, and anything left undecided here gets decided twice — once in
 * each — and eventually differently. The `Map` of stock positions in particular
 * does not survive serialisation, so it is resolved into the row while it still
 * exists.
 *
 * `stockAvailable` is nullable and that nullability is load-bearing. Null means
 * the ERP has no live position for this product; zero means it has one and it is
 * zero. Collapsing the two would turn "we don't know" into "there is none".
 */

export type MappingState =
  /** A person confirmed which ERP item this marketplace product is. */
  | "confirmed"
  /** An identifier resolved it — barcode, ERP SKU, or a channel mapping. */
  | "matched"
  /** The marketplace sold it and nothing in the ERP could be tied to it. */
  | "unresolved"
  /** An ERP product with no marketplace side at all, so nothing to map. */
  | "erpSide";

export interface SohProductRow {
  readonly sku: string;
  readonly erpItemId: string | null;
  readonly productName: string;
  readonly ean: string | null;
  readonly marketplaceItemId: string | null;

  /** Live available stock, or null when the ERP has no position for it. */
  readonly stockAvailable: number | null;
  readonly stockOnHand: number | null;
  readonly stockBlocked: number | null;
  readonly stockLocations: ReadonlyArray<{
    readonly name: string;
    readonly onHand: number;
    readonly available: number;
  }>;
  readonly stockUpdatedAt: string | null;

  readonly sellIn: number;
  readonly sellOut: number;
  readonly quantityVariance: number;
  readonly quantityVariancePct: number | null;

  readonly sellInRevenue: number;
  readonly sellOutRevenue: number;
  readonly revenueVariance: number;
  readonly revenueVariancePct: number | null;

  readonly status: SkuMatchStatus;
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

/**
 * Builds the product rows, resolving stock and mapping state while the report's
 * in-memory structures are still available.
 *
 * `confirmedKeys` is how a confirmed mapping is told apart from an automatic
 * one. The reconciliation groups by the resolved ERP SKU and no longer knows
 * which route produced it, so the set of confirmed identifiers is passed in.
 */
export function buildSohRows(
  report: MarketplaceReport,
  confirmedErpSkus: ReadonlySet<string>,
): SohProductRow[] {
  return report.reconciliation.rows.map((row) => {
    const position = row.erpItemId ? report.stock.byItemId.get(row.erpItemId) : undefined;

    const mapping: MappingState =
      row.status === "erpOnly" && row.excelRows === 0
        ? "erpSide"
        : confirmedErpSkus.has(row.sku.toUpperCase())
          ? "confirmed"
          : row.mappedToErp
            ? "matched"
            : "unresolved";

    return {
      sku: row.sku,
      erpItemId: row.erpItemId,
      productName: row.productName,
      ean: row.ean,
      marketplaceItemId: row.marketplaceItemId,

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

      sellIn: row.erpQuantity,
      sellOut: row.excelQuantity,
      quantityVariance: row.quantityVariance,
      quantityVariancePct: row.quantityVariancePct,

      sellInRevenue: row.erpRevenue,
      sellOutRevenue: row.excelRevenue,
      revenueVariance: row.amountVariance,
      revenueVariancePct: row.amountVariancePct,

      status: row.status,
      mapping,
      mappingReason: MAPPING_REASONS[mapping],

      erpOrders: row.erpOrders,
      erpLines: row.erpLines,
      sourceRows: row.excelRows,
      erpOrderRefs: row.erpOrderRefs,
      sourceRowRefs: row.excelRowRefs,
    };
  });
}

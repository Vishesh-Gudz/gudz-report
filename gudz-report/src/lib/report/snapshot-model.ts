/**
 * The saved report's shape, and the arithmetic over it.
 *
 * Deliberately free of `server-only` and of any Convex import: the table and the
 * detail panel are client components and need both these types and the totals.
 * The loaders that actually read Convex live in `snapshot-view.ts`, which is
 * server-only — keeping them apart is what stops a database import being pulled
 * into the browser bundle.
 */

export interface SnapshotRow {
  readonly id: string;
  readonly marketplace: string;
  readonly month: string;
  readonly productName: string;
  readonly sku: string;
  readonly ean: string | null;
  readonly marketplaceItemId: string | null;
  readonly erpItemId: string | null;
  /** Null renders as an em dash. Zero would be a recorded zero. */
  readonly currentSoh: number | null;
  /**
   * Goods sent. Optional as well as nullable: a snapshot saved before this
   * column existed carries no field at all, and it reads as an em dash rather
   * than breaking the row.
   */
  readonly dispatch?: number | null;
  readonly grn: number | null;
  readonly salesQuantity: number;
  readonly salesValue: number;
  readonly damage: number;
  readonly returned: number;
  readonly mappingStatus: "confirmed" | "matched" | "unresolved";
  readonly mappingReason: string;
  readonly sourceRows: number;
}

export interface SnapshotMarketplace {
  readonly marketplace: string;
  readonly sheetName: string;
  readonly status: "completed" | "failed";
  readonly errorMessage: string | null;
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
  readonly months: string[];
  readonly sourceRows: number;
  readonly products: number;
  readonly salesQuantity: number;
  readonly salesValue: number;
  readonly erpState: string;
  readonly erpMessage: string | null;
  readonly grnState: string;
  readonly grnMessage: string | null;
  readonly mappedProducts: number;
  readonly unresolvedProducts: number;
}

export interface SnapshotSummary {
  readonly marketplaces: number;
  readonly products: number;
  readonly rows: number;
  readonly salesQuantity: number;
  readonly salesValue: number;
  readonly currentSoh: number | null;
  readonly grnQuantity: number | null;
  /** Absent on snapshots saved before Dispatch existed. */
  readonly dispatchQuantity?: number | null;
  readonly mappedProducts: number;
  readonly unresolvedProducts: number;
}

export interface DataQualityNote {
  readonly state: "ok" | "warn" | "absent" | "bad";
  readonly title: string;
  readonly detail: string;
}

export interface SnapshotListing {
  readonly id: string;
  readonly sourceFileName: string;
  readonly createdAt: number;
  readonly status: "processing" | "completed" | "failed";
  readonly marketplaces: string[];
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
  readonly periodsDiffer: boolean;
}

export interface SnapshotView extends SnapshotListing {
  readonly summary: SnapshotSummary;
  readonly dataQuality: DataQualityNote[];
  readonly sections: SnapshotMarketplace[];
  readonly rows: SnapshotRow[];
  readonly errorMessage: string | null;
}


export interface ViewTotals {
  readonly rows: number;
  readonly products: number;
  readonly marketplaces: number;
  readonly salesQuantity: number;
  readonly salesValue: number;
  /** Null when no row carried a figure — an em dash, not a zero. */
  readonly currentSoh: number | null;
  readonly dispatch: number | null;
  readonly grn: number | null;
  readonly damage: number;
  readonly returned: number;
  readonly unresolvedProducts: number;
}

/**
 * Totals for whatever is on screen.
 *
 * Current SOH is summed per distinct ERP item, not per row: one product appears
 * once per month and once per marketplace, and it has one warehouse position.
 * Adding it per row would multiply the warehouse by the number of months.
 */
export function totalsFor(rows: ReadonlyArray<SnapshotRow>): ViewTotals {
  const stockSeen = new Set<string>();
  const products = new Set<string>();
  const unresolved = new Set<string>();

  let currentSoh: number | null = null;
  let dispatch: number | null = null;
  let grn: number | null = null;
  let salesQuantity = 0;
  let salesValue = 0;
  let damage = 0;
  let returned = 0;

  for (const row of rows) {
    products.add(`${row.marketplace}::${row.sku}`);
    if (row.mappingStatus === "unresolved") unresolved.add(`${row.marketplace}::${row.sku}`);

    if (row.erpItemId && row.currentSoh !== null && !stockSeen.has(row.erpItemId)) {
      stockSeen.add(row.erpItemId);
      currentSoh = (currentSoh ?? 0) + row.currentSoh;
    }
    if (row.dispatch !== null && row.dispatch !== undefined) {
      dispatch = (dispatch ?? 0) + row.dispatch;
    }
    if (row.grn !== null) grn = (grn ?? 0) + row.grn;

    salesQuantity += row.salesQuantity;
    salesValue += row.salesValue;
    damage += row.damage;
    returned += row.returned;
  }

  return {
    rows: rows.length,
    products: products.size,
    marketplaces: new Set(rows.map((row) => row.marketplace)).size,
    salesQuantity,
    salesValue,
    currentSoh,
    dispatch,
    grn,
    damage,
    returned,
    unresolvedProducts: unresolved.size,
  };
}

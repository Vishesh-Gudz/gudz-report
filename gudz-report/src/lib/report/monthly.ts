import type { NormalizedExcelRow } from "../../types/excel";
import type { MappedExcelRow } from "./product-mapping";

/**
 * Collapsing a marketplace sheet into marketplace × product × month.
 *
 * This is the step that makes the whole report cheap. Swiggy alone is 103,397
 * spreadsheet rows; the same data as product-months is a few dozen. Nothing
 * downstream ever needs the individual rows — the question is "how much of this
 * item sold in August", and the answer is a sum — so the aggregate is computed
 * once here and the raw rows are discarded.
 *
 * The month comes from the marketplace report's own date, never from the upload
 * time and never from the ERP. A row that carries no usable date is counted
 * under `undated` rather than silently dropped into the nearest month, because
 * a sheet with broken dates should look broken rather than lopsided.
 */

/** A product's sales in one month, as the marketplace reported them. */
export interface ProductMonth {
  /** `YYYY-MM`, or `null` for rows whose date could not be read. */
  readonly month: string | null;
  readonly key: string;
  readonly productName: string;
  readonly ean: string | null;
  readonly marketplaceItemId: string | null;
  /** The ERP item this product resolved to, when it resolved at all. */
  readonly erpItemId: string | null;
  readonly erpSku: string | null;
  readonly mappingStatus: "confirmed" | "matched" | "unresolved";
  readonly mappingReason: string;
  readonly salesQuantity: number;
  readonly salesValue: number;
  readonly sourceRows: number;
}

export interface MonthlyAggregate {
  readonly rows: ProductMonth[];
  /** Months present, sorted, excluding undated rows. */
  readonly months: string[];
  readonly distinctProducts: number;
  readonly mappedProducts: number;
  readonly unresolvedProducts: number;
  readonly salesQuantity: number;
  readonly salesValue: number;
  readonly undatedRows: number;
}

function monthOf(orderDate: string | null): string | null {
  if (!orderDate || orderDate.length < 7) return null;
  return orderDate.slice(0, 7);
}

/**
 * Identity for a product within one marketplace.
 *
 * The resolved ERP SKU when there is one, so two marketplace listings that mean
 * the same ERP product become one row. Otherwise the marketplace's own
 * identifiers, which keeps unresolved products apart from each other instead of
 * piling them into a single anonymous line.
 */
function identityOf(entry: MappedExcelRow): string {
  if (entry.keyIsErpSku) return entry.key.toUpperCase();
  const own =
    entry.row.barcode ?? entry.row.sku ?? entry.row.marketplaceItemId ?? null;
  return (own ?? entry.row.productName ?? "(unidentified)").toUpperCase();
}

export function aggregateMonthly(
  rows: ReadonlyArray<MappedExcelRow>,
  confirmedErpSkus: ReadonlySet<string>,
): MonthlyAggregate {
  const buckets = new Map<
    string,
    {
      month: string | null;
      key: string;
      productName: string;
      ean: string | null;
      marketplaceItemId: string | null;
      erpItemId: string | null;
      erpSku: string | null;
      mappingStatus: ProductMonth["mappingStatus"];
      mappingReason: string;
      salesQuantity: number;
      salesValue: number;
      sourceRows: number;
    }
  >();

  const productKeys = new Set<string>();
  const unresolvedKeys = new Set<string>();
  let salesQuantity = 0;
  let salesValue = 0;
  let undatedRows = 0;

  for (const entry of rows) {
    const row: NormalizedExcelRow = entry.row;
    const month = monthOf(row.orderDate);
    if (month === null) undatedRows += 1;

    const identity = identityOf(entry);
    productKeys.add(identity);

    const erpSku = entry.mapping.item?.sku ?? null;
    const mappingStatus: ProductMonth["mappingStatus"] =
      entry.mapping.status !== "mapped"
        ? "unresolved"
        : erpSku && confirmedErpSkus.has(erpSku.toUpperCase())
          ? "confirmed"
          : "matched";

    if (mappingStatus === "unresolved") unresolvedKeys.add(identity);

    const bucketKey = `${identity}::${month ?? "undated"}`;
    const existing = buckets.get(bucketKey);

    const quantity = row.quantity ?? 0;
    const value = row.grossSales ?? 0;
    salesQuantity += quantity;
    salesValue += value;

    if (existing) {
      existing.salesQuantity += quantity;
      existing.salesValue += value;
      existing.sourceRows += 1;
      continue;
    }

    buckets.set(bucketKey, {
      month,
      key: identity,
      // The ERP's name when the product resolved — it is the catalogue's own
      // wording and matches what anyone checking in the ERP will search for.
      productName: entry.mapping.item?.name ?? row.productName ?? identity,
      ean: row.barcode ?? row.sku ?? null,
      marketplaceItemId: row.marketplaceItemId ?? null,
      erpItemId: entry.mapping.item?.itemId ?? null,
      erpSku,
      mappingStatus,
      mappingReason: entry.mapping.reason,
      salesQuantity: quantity,
      salesValue: value,
      sourceRows: 1,
    });
  }

  const aggregated = [...buckets.values()].sort((a, b) => {
    if (a.key !== b.key) return b.salesQuantity - a.salesQuantity;
    return (a.month ?? "9999-99").localeCompare(b.month ?? "9999-99");
  });

  const months = [
    ...new Set(
      aggregated
        .map((entry) => entry.month)
        .filter((month): month is string => month !== null),
    ),
  ].sort();

  return {
    rows: aggregated,
    months,
    distinctProducts: productKeys.size,
    mappedProducts: productKeys.size - unresolvedKeys.size,
    unresolvedProducts: unresolvedKeys.size,
    salesQuantity,
    salesValue,
    undatedRows,
  };
}

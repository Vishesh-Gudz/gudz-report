import type { ReportingPeriod } from "@/lib/dates/reporting-period";
import type { NormalizedExcelRow } from "./excel";
import type { SalesOrderLine } from "./erp";

/**
 * The shapes the report is eventually assembled from.
 *
 * Types only — the matching and aggregation logic is deliberately not written
 * yet. It depends on the real Healthy Master workbook and on a
 * `marketplace → customer GSTIN` mapping that is a business decision. Fixing
 * the shape of an answer now is useful; inventing the rules that produce it
 * would be guesswork nobody could later tell apart from a decision.
 */

/**
 * How a spreadsheet line was matched to an ERP line.
 *
 * Ordered by how much it can be trusted. `channelMapping` is highest because it
 * is a recorded human decision that a marketplace key *is* a given product;
 * `sku` and `barcode` are direct identifier matches; `manual` is a one-off
 * override; `none` means nothing matched and the row needs a human.
 */
export const MATCH_TYPES = [
  "channelMapping",
  "sku",
  "barcode",
  "customerIdentifier",
  "manual",
  "none",
] as const;
export type MatchType = (typeof MATCH_TYPES)[number];

export const MATCH_STATUSES = [
  "matched",
  "unmatched",
  "ambiguous",
  "ignored",
] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

export interface ReconciliationRow {
  readonly excelRow: NormalizedExcelRow;
  /** Null when nothing matched — the row is still reported, never dropped. */
  readonly erpLine: SalesOrderLine | null;
  readonly matchType: MatchType;
  readonly status: MatchStatus;
  /** Excel quantity minus ERP quantity. Positive means the sheet claims more. */
  readonly quantityDifference: number | null;
  readonly amountDifference: number | null;
}

/**
 * Headline numbers for one reconciliation.
 *
 * `unmatchedRows` and `erpOnlyLines` are both carried on purpose: a row the
 * spreadsheet has and the ERP does not is a different problem from a line the
 * ERP has and the spreadsheet does not, and collapsing them into one "variance"
 * hides which of the two systems to go and look at.
 */
export interface ReportSummary {
  readonly period: ReportingPeriod;
  readonly totalExcelRows: number;
  readonly matchedRows: number;
  readonly unmatchedRows: number;
  readonly ambiguousRows: number;
  /** ERP lines in the period with no spreadsheet counterpart. */
  readonly erpOnlyLines: number;
  readonly excelQuantity: number;
  readonly erpQuantity: number;
  readonly excelAmount: number;
  readonly erpAmount: number;
}

/** One product's position across both systems. */
export interface ProductReportRow {
  readonly sku: string;
  readonly productName: string | null;
  /** Null when the SKU never resolved to an ERP item. */
  readonly itemId: string | null;
  readonly excelQuantity: number;
  readonly erpQuantity: number;
  readonly quantityDifference: number;
  readonly excelAmount: number;
  readonly erpAmount: number;
  readonly amountDifference: number;
  readonly matchStatus: MatchStatus;
}

/**
 * A marketplace, defined by the customer GSTINs it trades under.
 *
 * This mapping is configuration, not ERP data, and it lives here rather than in
 * the ERP on purpose: "GSTIN 29… is Blinkit" is a fact about this business, and
 * baking it into a generic ERP endpoint would make that endpoint useful to
 * exactly one dashboard. One marketplace can hold several GSTINs — regional
 * entities are registered separately.
 */
export interface MarketplaceMapping {
  readonly marketplace: string;
  readonly customerGstins: ReadonlyArray<string>;
  /** Channel strings seen on these orders. Provenance only — never identity. */
  readonly knownChannelValues?: ReadonlyArray<string>;
}

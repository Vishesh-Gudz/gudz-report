import type { SalesOrderLine } from "../../types/erp";
import type { NormalizedExcelRow } from "../../types/excel";
import { MarketplaceIndex, type Attribution } from "./attribution";
import { isReportableStatus, reportedQuantity } from "./policy";

/**
 * Joining a marketplace spreadsheet to ERP sales-order lines.
 *
 * The governing rule: **nothing is matched on a guess, and nothing is dropped.**
 * A row that cannot be matched confidently is reported as unmatched with a
 * reason. Silently pairing two rows that merely look similar produces a
 * reconciliation that balances and is wrong, which is the one failure mode
 * nobody goes back and checks.
 *
 * Matching is tried in descending order of how much the identifier can be
 * trusted. Each strategy is recorded on the result, so a disputed number can be
 * traced to the rule that produced it rather than argued about.
 */

export const MATCH_STRATEGIES = [
  /** The marketplace's own line identifier, when the ERP carries the same value. */
  "marketplaceItemId",
  /** Exact SKU, folded for case and surrounding whitespace. */
  "sku",
  /** Exact barcode against the ERP line's SKU — only when SKUs are barcodes. */
  "barcode",
] as const;
export type MatchStrategy = (typeof MATCH_STRATEGIES)[number];

export type MatchStatus = "matched" | "unmatched" | "ambiguous";

export type UnmatchedReason =
  | "noIdentifier"
  | "noErpLine"
  | "ambiguous"
  | "quantityOnly";

export interface MatchedPair {
  readonly excelRow: NormalizedExcelRow;
  /** Null for unmatched rows — the row survives either way. */
  readonly erpLine: SalesOrderLine | null;
  readonly status: MatchStatus;
  readonly strategy: MatchStrategy | null;
  readonly reason: UnmatchedReason | null;
  /** How many ERP lines the identifier hit. >1 means ambiguous, never auto-picked. */
  readonly candidateCount: number;
  readonly attribution: Attribution | null;
  /** Excel quantity minus ERP ordered quantity. Positive means the sheet claims more. */
  readonly quantityVariance: number | null;
  readonly amountVariance: number | null;
}

export interface ReconciliationResult {
  readonly pairs: MatchedPair[];
  /** ERP lines in the period with no spreadsheet counterpart. */
  readonly erpOnly: { line: SalesOrderLine; attribution: Attribution }[];
  readonly counts: {
    readonly excelRows: number;
    readonly matched: number;
    readonly unmatched: number;
    readonly ambiguous: number;
    readonly erpOnly: number;
  };
}

/** Folds an identifier for comparison. Case and surrounding space are noise. */
function foldKey(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const folded = value.trim().toUpperCase();
  return folded || null;
}

/**
 * Index of ERP lines by every identifier they can be found under.
 *
 * A key that resolves to more than one line is kept as a list rather than
 * overwritten. That is what makes ambiguity detectable: one SKU appearing on
 * three ERP lines is a real situation, and picking the first would silently
 * attribute a spreadsheet row to an arbitrary one of them.
 */
class ErpLineIndex {
  private readonly bySku = new Map<string, SalesOrderLine[]>();
  private readonly byItemId = new Map<string, SalesOrderLine[]>();
  private readonly consumed = new Set<string>();

  constructor(lines: ReadonlyArray<SalesOrderLine>) {
    for (const line of lines) {
      const sku = foldKey(line.sku);
      if (sku) this.bySku.set(sku, [...(this.bySku.get(sku) ?? []), line]);

      const itemId = foldKey(line.itemId);
      if (itemId) this.byItemId.set(itemId, [...(this.byItemId.get(itemId) ?? []), line]);
    }
  }

  lookup(key: string | null, map: "sku" | "itemId"): SalesOrderLine[] {
    if (!key) return [];
    const source = map === "sku" ? this.bySku : this.byItemId;
    return source.get(key) ?? [];
  }

  /** Marks a line as reconciled so it does not also appear as ERP-only. */
  consume(line: SalesOrderLine): void {
    this.consumed.add(line.salesOrderItemId);
  }

  unconsumed(lines: ReadonlyArray<SalesOrderLine>): SalesOrderLine[] {
    return lines.filter((line) => !this.consumed.has(line.salesOrderItemId));
  }
}

function variance(excel: number | null, erp: number | null): number | null {
  if (excel === null || erp === null) return null;
  return excel - erp;
}

export interface ReconcileOptions {
  /**
   * Only reconcile against ERP lines whose order status counts as business.
   * On by default — drafts are a third of production data and are not revenue.
   */
  readonly reportableOnly?: boolean;
}

/**
 * Reconciles a set of spreadsheet rows against a set of ERP lines.
 *
 * Pure: no I/O, no clock, no configuration read from the environment. Every
 * input is an argument, which is what makes the arithmetic testable without a
 * database or a live ERP.
 */
export function reconcile(
  excelRows: ReadonlyArray<NormalizedExcelRow>,
  erpLines: ReadonlyArray<SalesOrderLine>,
  marketplaces: MarketplaceIndex,
  options?: ReconcileOptions,
): ReconciliationResult {
  const reportableOnly = options?.reportableOnly ?? true;
  const eligible = reportableOnly
    ? erpLines.filter((line) => isReportableStatus(line.status))
    : [...erpLines];

  const index = new ErpLineIndex(eligible);
  const pairs: MatchedPair[] = [];

  for (const excelRow of excelRows) {
    const attempts: { strategy: MatchStrategy; candidates: SalesOrderLine[] }[] = [
      {
        strategy: "marketplaceItemId",
        candidates: index.lookup(foldKey(excelRow.marketplaceItemId), "itemId"),
      },
      { strategy: "sku", candidates: index.lookup(foldKey(excelRow.sku), "sku") },
      { strategy: "barcode", candidates: index.lookup(foldKey(excelRow.barcode), "sku") },
    ];

    const hadIdentifier =
      Boolean(excelRow.marketplaceItemId) ||
      Boolean(excelRow.sku) ||
      Boolean(excelRow.barcode);

    const hit = attempts.find((attempt) => attempt.candidates.length > 0);

    if (!hit) {
      pairs.push({
        excelRow,
        erpLine: null,
        status: "unmatched",
        strategy: null,
        reason: hadIdentifier ? "noErpLine" : "noIdentifier",
        candidateCount: 0,
        attribution: null,
        quantityVariance: null,
        amountVariance: null,
      });
      continue;
    }

    if (hit.candidates.length > 1) {
      // Reported, never resolved by picking one. Which of three ERP lines a
      // spreadsheet row belongs to is a question for a human.
      pairs.push({
        excelRow,
        erpLine: null,
        status: "ambiguous",
        strategy: hit.strategy,
        reason: "ambiguous",
        candidateCount: hit.candidates.length,
        attribution: null,
        quantityVariance: null,
        amountVariance: null,
      });
      continue;
    }

    const erpLine = hit.candidates[0]!;
    index.consume(erpLine);

    const attribution = marketplaces.attribute({
      customerGstin: erpLine.customerGstin,
      customerId: erpLine.customerId,
      customerName: erpLine.customerName,
      channel: erpLine.channel,
    });

    pairs.push({
      excelRow,
      erpLine,
      status: "matched",
      strategy: hit.strategy,
      reason: null,
      candidateCount: 1,
      attribution,
      quantityVariance: variance(excelRow.quantity, reportedQuantity(erpLine)),
      amountVariance: variance(excelRow.grossSales, erpLine.lineTotal),
    });
  }

  const erpOnly = index.unconsumed(eligible).map((line) => ({
    line,
    attribution: marketplaces.attribute({
      customerGstin: line.customerGstin,
      customerId: line.customerId,
      customerName: line.customerName,
      channel: line.channel,
    }),
  }));

  return {
    pairs,
    erpOnly,
    counts: {
      excelRows: excelRows.length,
      matched: pairs.filter((pair) => pair.status === "matched").length,
      unmatched: pairs.filter((pair) => pair.status === "unmatched").length,
      ambiguous: pairs.filter((pair) => pair.status === "ambiguous").length,
      erpOnly: erpOnly.length,
    },
  };
}

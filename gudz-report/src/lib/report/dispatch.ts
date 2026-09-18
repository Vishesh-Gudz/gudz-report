import type { SalesOrderLine } from "../../types/erp";
import { isReportableStatus } from "./policy";

/**
 * Dispatch — what the report shows as goods sent.
 *
 * ── What the ERP actually has ───────────────────────────────────────────────
 * The ERP has no independently tracked dispatch quantity. That is a finding,
 * not an assumption; every candidate was checked against the live data for
 * 1 Jun – 31 Aug 2026 across all six marketplaces:
 *
 *  - `shippedQuantity` and `deliveredQuantity` are never different. Two fields,
 *    one value, on every one of the 2,456 lines.
 *  - The value is a function of status alone. All 801 `completed` lines carry
 *    `shippedQuantity === orderedQuantity`; all 1,655 `approved` lines carry
 *    zero. Not one line is partially shipped, which is what a real dispatch
 *    register would be full of.
 *  - No code path increments `shipped_quantity` on a sales-order item. The only
 *    write in the ERP sets it to 0 at creation.
 *  - `dispatchedAt` is populated backwards for this purpose: 475 `approved`
 *    lines have one and no `completed` line does, and Zepto has none at all.
 *  - `sales_order_dispatch_scans` counts cartons and boxes, not units of a SKU.
 *  - `sales_order_invoices` stores a presentation document, not quantities.
 *
 * So `shippedQuantity` is real ERP data with a narrow meaning: **the quantity
 * on orders that reached `completed`**. That is a genuine measure of goods that
 * left, and it is the one this module reports. It is not a claim that anybody
 * scanned them out of the gate.
 *
 * ── What follows from that ──────────────────────────────────────────────────
 * Dispatch is a subset of GRN by construction, because GRN counts every
 * reportable order and this counts only the completed ones. A reader who
 * expects dispatch to exceed goods received will find the opposite, and the
 * data-quality note says so rather than leaving them to discover it.
 *
 * ── Why this module is separate ─────────────────────────────────────────────
 * Everything above is expected to be replaced. When the ERP grows a real
 * dispatch register, only `dispatchedQuantity` below changes, and the shape it
 * returns — a map keyed `itemId::YYYY-MM`, exactly like `grn.ts` — stays. GRN
 * is deliberately untouched by any of this.
 *
 * The lines are passed in rather than fetched: they are the same lines GRN
 * already read, and walking ~59 GSTIN paginations a second time to recompute a
 * column from data already in memory would double every import for nothing.
 */

/** One month of dispatched quantity for one ERP item. */
export interface DispatchMonthlyTotal {
  readonly itemId: string;
  readonly itemSku: string;
  /** `YYYY-MM`. */
  readonly month: string;
  readonly quantity: number;
  /** How many ERP lines contributed. */
  readonly lines: number;
}

export interface DispatchResult {
  /** Keyed `${itemId}::${month}`. */
  readonly byItemMonth: ReadonlyMap<string, DispatchMonthlyTotal>;
  readonly totalQuantity: number;
  readonly lines: number;
  readonly available: boolean;
}

export function emptyDispatchResult(): DispatchResult {
  return { byItemMonth: new Map(), totalQuantity: 0, lines: 0, available: false };
}

/**
 * The dispatched quantity on one ERP sales-order line.
 *
 * The single place the meaning of "dispatched" is decided. A real dispatch
 * register replaces this function and nothing else.
 */
export function dispatchedQuantity(line: SalesOrderLine): number {
  const shipped = line.shippedQuantity;
  return Number.isFinite(shipped) && shipped > 0 ? shipped : 0;
}

/**
 * Dispatch per item per month, from ERP sales-order lines.
 *
 * Dated on the order, not on `dispatchedAt`. The ERP records a dispatch date on
 * a minority of lines and none of Zepto's, so using it would bucket most of the
 * column by one date field and the rest by another, and no two rows would be
 * comparable. Using the order date throughout keeps Dispatch on the same row
 * and the same month as the GRN it should be read against.
 *
 * A line with nothing dispatched contributes no entry rather than a zero, so a
 * product-month with no completed order reads as an em dash — the same rule the
 * rest of the report follows.
 */
export function aggregateDispatch(
  lines: ReadonlyArray<SalesOrderLine>,
): DispatchResult {
  const byItemMonth = new Map<string, DispatchMonthlyTotal>();
  let totalQuantity = 0;
  let lineCount = 0;

  for (const line of lines) {
    if (!isReportableStatus(line.status)) continue;

    const month = line.orderDate.slice(0, 7);
    if (month.length !== 7) continue;

    // Free-text lines carry no item id and have nothing to be attributed to.
    const itemId = line.itemId;
    if (!itemId) continue;

    const quantity = dispatchedQuantity(line);
    if (quantity === 0) continue;

    const key = `${itemId}::${month}`;
    const existing = byItemMonth.get(key);

    byItemMonth.set(key, {
      itemId,
      itemSku: line.sku,
      month,
      quantity: (existing?.quantity ?? 0) + quantity,
      lines: (existing?.lines ?? 0) + 1,
    });

    totalQuantity += quantity;
    lineCount += 1;
  }

  return { byItemMonth, totalQuantity, lines: lineCount, available: true };
}

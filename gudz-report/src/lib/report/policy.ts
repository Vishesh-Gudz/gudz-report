import type { ErpSalesOrderStatus } from "../../types/erp";

/**
 * What counts as business in this report.
 *
 * Every rule here was settled by looking at real Healthy Master data rather
 * than by reading the ERP schema, which is why each one is written down with
 * what it is guarding against.
 */

/**
 * Statuses that represent a real, countable order.
 *
 * `draft` is the reason this list exists. Roughly a third of sampled production
 * orders sit in `draft` — parked, not yet confirmed, and never meant to be
 * revenue. `excludeCancelled` alone does not remove them, so relying on it
 * would overstate every headline number on the page.
 *
 * Filtering to an allow-list rather than subtracting a deny-list is deliberate:
 * a status added to the ERP later gets excluded until someone decides it counts,
 * which is the safe direction to be wrong in.
 */
export const REPORTABLE_STATUSES: ReadonlyArray<ErpSalesOrderStatus> = [
  "approved",
  "completed",
  "delivered",
] as const;

/** Statuses deliberately left out of the headline figures. */
export const EXCLUDED_STATUSES: ReadonlyArray<ErpSalesOrderStatus> = [
  "draft",
  "cancelled",
] as const;

export function isReportableStatus(status: string): boolean {
  return (REPORTABLE_STATUSES as ReadonlyArray<string>).includes(status);
}

/**
 * The quantity the report treats as "sold".
 *
 * `orderedQuantity`, not shipped or delivered. In production most lines carry
 * `shippedQuantity: 0` and `deliveredQuantity: 0` even on orders that are
 * approved and invoiced — the fulfilment pipeline is not consistently completed
 * in the ERP. Deriving the headline metric from those would report a business
 * that sells almost nothing.
 *
 * Shipped and delivered are still surfaced per line; they are just not the
 * number anything is totalled from.
 */
export function reportedQuantity(line: {
  orderedQuantity: number;
}): number {
  return line.orderedQuantity;
}

/** Bucket for rows whose marketplace cannot be established. Never dropped. */
export const UNATTRIBUTED = "Unattributed" as const;
export type Unattributed = typeof UNATTRIBUTED;

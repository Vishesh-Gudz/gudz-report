/**
 * What this report measures, in the business's own words.
 *
 * The three columns are deliberately named after what somebody in the business
 * would say, not after the system a number came from. An earlier version used
 * "sell-in" and "sell-out"; they were dropped because readers consistently had
 * to be told which was which, and a label that needs explaining is a label that
 * will be misread when nobody is there to explain it.
 *
 *   **Current SOH**     — Healthy Master's own available stock, right now.
 *   **Dispatch**        — goods sent, from the quantity on orders that reached
 *                         completed in that month.
 *   **GRN**             — goods received by the marketplace, taken from the
 *                         quantity invoiced to them in that month.
 *   **Sales Quantity**  — what the marketplace reported selling, that month.
 *
 * Read left to right they are the flow: Healthy Master dispatches, the customer
 * receives, the marketplace sells.
 *
 * Two things this report refuses to claim:
 *
 *  - **GRN is currently the invoiced quantity**, not a receipt the marketplace
 *    confirmed. The ERP's `customer_grn` register is the stricter answer and is
 *    empty in production, so the report uses what exists and `report/grn.ts`
 *    keeps the swap to one call. Where the two eventually differ, believe the
 *    register.
 *  - **Current SOH is not historical SOH.** Stock at the end of a past month
 *    would have to be replayed from a ledger with a known sync backlog. The
 *    live position is shown, labelled as live, and month-end stock is reported
 *    as unavailable rather than invented.
 *
 * Where a figure does not exist, the report shows an em dash. Never a zero — a
 * zero claims the register was read and genuinely held nothing.
 */

export const REPORT_TITLE = "SOH Report";

/** Kept for the document title and the export; the header shows metadata instead. */
export const REPORT_SUBTITLE = "Stock, goods received and sales by product and month";

export const CURRENT_SOH = {
  label: "Current SOH",
  source: "ERP live stock",
  /** Shown on hover, not on the page. */
  description:
    "Available stock in Healthy Master's own locations now, after blocked stock. Not month-end stock.",
} as const;

export const DISPATCH = {
  label: "Dispatch",
  source: "ERP B2B sales orders",
  description:
    "Quantity on orders that reached completed in that month. The ERP tracks no separate dispatch count, so this is a subset of GRN rather than larger than it.",
} as const;

export const GRN = {
  label: "GRN",
  source: "ERP B2B sales orders",
  description:
    "Quantity invoiced to the marketplace that month, from ERP B2B sales orders. Drafts and cancellations excluded.",
} as const;

export const SALES_QUANTITY = {
  label: "Sales Quantity",
  source: "Marketplace report",
  description: "Units the marketplace reported selling that month.",
} as const;

export const DAMAGE = { label: "Damage" } as const;

export const RETURNED = { label: "Returned" } as const;

/** Mapping wording, so the table and the detail panel cannot drift apart. */
export const MAPPING_LABELS = {
  confirmed: "Confirmed",
  matched: "Matched",
  unresolved: "Needs Review",
} as const;

export type MappingStatus = keyof typeof MAPPING_LABELS;

/** Per-marketplace GRN standing, in the words the panel uses. */
export const GRN_STATE_LABELS: Record<string, string> = {
  available: "GRN available",
  notConfigured: "ERP not configured",
  unavailable: "ERP unavailable",
};

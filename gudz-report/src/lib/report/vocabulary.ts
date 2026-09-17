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
 *   **GRN**             — what the customer recorded receiving, from the ERP's
 *                         `customer_grn` register.
 *   **Sales Quantity**  — what the marketplace reported selling, that month.
 *
 * Two things this report refuses to claim:
 *
 *  - **GRN is not the sales order.** `orderedQuantity` is what was invoiced; a
 *    GRN is what the marketplace booked in at their end. Relabelling one as the
 *    other would answer a different question while looking right.
 *  - **Current SOH is not historical SOH.** Stock at the end of a past month
 *    would have to be replayed from a ledger with a known sync backlog. The
 *    live position is shown, labelled as live, and month-end stock is reported
 *    as unavailable rather than invented.
 *
 * Where a figure does not exist, the report shows an em dash. Never a zero — a
 * zero claims the register was read and genuinely held nothing.
 */

export const REPORT_TITLE = "SOH Report";

export const REPORT_SUBTITLE =
  "Stock, goods received and sales by product and month";

export const CURRENT_SOH = {
  label: "Current SOH",
  source: "ERP live stock",
  description:
    "Available stock in Healthy Master's own locations right now, after deducting what is blocked by open orders. A live position, not stock held at the end of the month.",
} as const;

export const GRN = {
  label: "GRN",
  source: "ERP customer GRN",
  description:
    "What the customer recorded receiving, from the ERP's customer GRN register. This is not the invoiced quantity.",
  awaiting: "Awaiting customer GRN",
} as const;

export const SALES_QUANTITY = {
  label: "Sales Quantity",
  source: "Marketplace report",
  description:
    "Units the marketplace reported selling in that month, from the uploaded report.",
} as const;

export const DAMAGE = {
  label: "Damage",
  description: "No source is connected yet, so this reads zero for every row.",
} as const;

export const RETURNED = {
  label: "Returned",
  description: "No source is connected yet, so this reads zero for every row.",
} as const;

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
  awaiting: GRN.awaiting,
  notConfigured: "ERP not configured",
  unavailable: "ERP unavailable",
};

/**
 * What this report measures, and what it refuses to claim.
 *
 * It is an SOH report, and one genuine stock figure is in it: the **live**
 * position from the ERP's balance tables, per product and location. That is
 * real, current, and labelled as current.
 *
 * What is deliberately absent is *historical* SOH — opening and closing stock
 * for a past period. Deriving those means replaying the ERP stock ledger, and
 * the production ledger has a known sync backlog, so the result would look
 * authoritative and be wrong. The report says so on screen instead.
 *
 * Around that live position sit the two flow measures:
 *
 *   **Sell-in**  — what Healthy Master invoiced *to* the marketplace. B2B
 *                  sales orders in the ERP, by `orderedQuantity`.
 *   **Sell-out** — what the marketplace says it sold *to consumers*. The rows
 *                  in the uploaded marketplace sheet.
 *
 * These are different measurements of different events, separated by however
 * long stock sits in the marketplace's warehouse. They are not supposed to be
 * equal, and a period where they were equal would be the suspicious one. The
 * gap between them is the report's whole subject: sustained sell-out above
 * sell-in is the marketplace drawing down stock it already holds, and sustained
 * sell-in above sell-out is stock accumulating there.
 *
 * The variance between them is a flow difference, not a stock count, and must
 * never be presented as one: a reader who takes it for a discrepancy will go
 * looking for inventory that was never missing. The labels live here so the
 * whole UI says the same thing, and so the next screen that needs them does not
 * invent a third name.
 *
 * Field names in the data layer stay source-shaped — `erpQuantity`,
 * `excelRevenue` — because they say where a number came from, which is a
 * separate and still-true fact. This module maps source to meaning.
 */

export const REPORT_TITLE = "SOH Report";

/**
 * What the product is, in one line, under the title.
 *
 * The title is the client's name for this thing and stays. The subtitle carries
 * the honesty: it says which stock figure is real and which is not, before
 * anybody reads a number.
 */
export const REPORT_SUBTITLE =
  "Live stock position, sell-in and sell-out per product";

export const SELL_IN = {
  label: "Sell-in",
  /** Where it comes from, for a subtitle or a tooltip. */
  source: "ERP B2B sales orders",
  description:
    "What Healthy Master invoiced to the marketplace, from ERP B2B sales orders. Quantity is orderedQuantity; drafts and cancellations are excluded.",
} as const;

export const SELL_OUT = {
  label: "Sell-out",
  source: "Marketplace report",
  description:
    "What the marketplace reports selling to consumers, from the uploaded sheet.",
} as const;

/**
 * The one-paragraph explanation shown on the report itself.
 *
 * On the page rather than in a tooltip: somebody reading a variance for the
 * first time needs to know it is a timing difference before they treat it as an
 * error, and a tooltip is exactly where that does not get read.
 */
export const REPORT_EXPLANATION =
  "Sell-in is what Healthy Master invoiced to the marketplace. Sell-out is what " +
  "the marketplace reports selling to consumers. They measure different events at " +
  "different times, so a gap is normal rather than an error: sell-out above " +
  "sell-in means the marketplace is drawing down stock it already holds, and " +
  "sell-in above sell-out means stock is building up there. The stock column is " +
  "the live position in Healthy Master's own warehouses today, not the " +
  "marketplace's.";

/** The live stock measure. Real, current, and never presented as historical. */
export const STOCK_ON_HAND = {
  label: "Stock on hand",
  source: "ERP live balances",
  description:
    "Available stock in Healthy Master's own locations right now, after deducting what is blocked by open orders and picklists. This is a live position, not the stock held at the end of the reporting period.",
} as const;

/** Column and status wording, so the table and the tiles cannot drift apart. */
export const SKU_STATUS_LABELS = {
  matched: "Agrees",
  variance: "Variance",
  /** Invoiced to the marketplace, but the marketplace reports no sales of it. */
  erpOnly: "Sell-in only",
  /** The marketplace sold it, but nothing was invoiced in this window. */
  excelOnly: "Sell-out only",
} as const;

export const SKU_STATUS_HINTS = {
  matched: "Sell-in and sell-out agree for this product.",
  variance: "Both sides report this product, and the numbers differ.",
  erpOnly:
    "Invoiced to the marketplace in this window, but the marketplace reports no consumer sales of it.",
  excelOnly:
    "The marketplace reports selling this, but nothing was invoiced in this window — it may have shipped earlier, or the product may not be mapped to an ERP item.",
} as const;

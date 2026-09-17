/**
 * What the two sides of this report actually measure.
 *
 * The report was called an "SOH report", and that was wrong in a way that
 * matters. Stock on Hand is a position: how much exists, right now, in a
 * location. Nothing in this dashboard measures that. What it compares is:
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
 * Calling that "SOH" invited somebody to read a variance as a stock discrepancy
 * and go looking for missing inventory that was never missing. The labels live
 * here so the whole UI says the same thing, and so the next screen that needs
 * them does not invent a third name.
 *
 * Field names in the data layer stay source-shaped — `erpQuantity`,
 * `excelRevenue` — because they say where a number came from, which is a
 * separate and still-true fact. This module maps source to meaning.
 */

export const REPORT_TITLE = "Sell-in vs Sell-out";

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
  "This is not a stock-on-hand report. It compares sell-in — what Healthy Master " +
  "invoiced to the marketplace — against sell-out, what the marketplace reports " +
  "selling to consumers. The two measure different events at different times, so " +
  "a gap is normal: sell-out above sell-in means the marketplace is drawing down " +
  "stock it already holds, and sell-in above sell-out means stock is building up " +
  "there. Treat a variance as a question, not as a discrepancy.";

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

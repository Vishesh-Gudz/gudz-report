import type { MarketplaceReport } from "@/lib/report/marketplace-report";
import { SELL_IN, SELL_OUT, STOCK_ON_HAND } from "@/lib/report/vocabulary";

/**
 * The five numbers somebody quotes from this report.
 *
 * Restrained on purpose: one row of figures with their units named, no tiles
 * competing with the table below them. Sell-in and sell-out are shown as a pair
 * with the variance between them, because either alone is a half-answer.
 *
 * `Mapped` sits among them rather than in the data-quality section because it
 * qualifies every other number on the strip — a reader seeing "18 of 23" knows
 * immediately how much of the report is comparable.
 */

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const num = new Intl.NumberFormat("en-IN");

function Metric({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "warn" | "up" | "down";
}) {
  const valueColour =
    tone === "up" ? "text-amber-700" : tone === "down" ? "text-sky-700" : "text-zinc-900";

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5 border-l border-zinc-200 px-5 py-4 first:border-l-0">
      <span className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
        {label}
      </span>
      <span className={`text-[22px] leading-tight font-semibold ${valueColour}`}>
        {value}
      </span>
      {detail ? (
        <span
          className={`truncate text-[12px] ${tone === "warn" ? "text-amber-700" : "text-zinc-500"}`}
          title={detail}
        >
          {detail}
        </span>
      ) : null}
    </div>
  );
}

export function SummaryStrip({ report }: { report: MarketplaceReport }) {
  const { reconciliation, stockAvailability, excel } = report;
  const products = reconciliation.rows.length;

  // Counted from the list the review screen actually shows, not from the
  // row-identity tally. The two group differently — a product whose sheet rows
  // carry a placeholder EAN forms an extra identity — and a summary that says
  // "5 need review" over a screen listing four is a summary nobody trusts again.
  const totalProducts = excel.mapping?.distinctProducts ?? 0;
  const needsReview = report.unmappedRows.length;
  const mappedProducts = Math.max(0, totalProducts - needsReview);

  const variance = reconciliation.totals.quantityVariance;

  return (
    <section className="flex flex-wrap border border-zinc-200 bg-white">
      <Metric
        label="Products"
        value={num.format(products)}
        detail={`${num.format(reconciliation.counts.skusWithVariance)} with a variance`}
      />
      <Metric
        label="Mapped"
        value={totalProducts > 0 ? `${mappedProducts} / ${totalProducts}` : "—"}
        detail={
          totalProducts > 0
            ? needsReview === 0
              ? "all products matched"
              : `${needsReview} need review`
            : "no marketplace report loaded"
        }
        tone={needsReview > 0 ? "warn" : undefined}
      />
      <Metric
        label={STOCK_ON_HAND.label}
        value={
          stockAvailability.currentAvailable
            ? num.format(stockAvailability.totalAvailable)
            : "—"
        }
        detail={
          stockAvailability.currentAvailable
            ? `available now · ${num.format(stockAvailability.productsWithPosition)} products`
            : "live position unavailable"
        }
        tone={stockAvailability.currentAvailable ? undefined : "warn"}
      />
      <Metric
        label={SELL_IN.label}
        value={num.format(reconciliation.totals.erpQuantity)}
        detail={inr.format(reconciliation.totals.erpRevenue)}
      />
      <Metric
        label={SELL_OUT.label}
        value={num.format(reconciliation.totals.excelQuantity)}
        detail={inr.format(reconciliation.totals.excelRevenue)}
      />
      <Metric
        label="Quantity variance"
        value={`${variance > 0 ? "+" : variance < 0 ? "−" : ""}${num.format(Math.abs(variance))}`}
        detail="sell-out minus sell-in"
        tone={variance > 0 ? "up" : variance < 0 ? "down" : undefined}
      />
    </section>
  );
}

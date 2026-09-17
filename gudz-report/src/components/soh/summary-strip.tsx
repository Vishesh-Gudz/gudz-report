import type { SohTotals } from "@/lib/report/soh-rows";
import { SELL_IN, SELL_OUT, STOCK_ON_HAND } from "@/lib/report/vocabulary";

/**
 * The numbers somebody quotes from this report.
 *
 * Sell-in and the variance are qualified rather than absolute: when only some
 * marketplaces have an ERP customer configured, a bare total would read as a
 * figure for the whole upload. The detail line says how many marketplaces
 * actually contributed one, so the number cannot be quoted out of context.
 *
 * Stock is summed per distinct ERP item, not per row — one product sold on three
 * marketplaces has one warehouse position, and adding it three times would
 * treble it.
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

export function SummaryStrip({
  totals,
  marketplaceCount,
}: {
  totals: SohTotals;
  marketplaceCount: number;
}) {
  const partiallyReconciled =
    totals.reconciledMarketplaces > 0 &&
    totals.reconciledMarketplaces < marketplaceCount;

  const sellInDetail =
    totals.reconciledMarketplaces === 0
      ? "no marketplace configured"
      : partiallyReconciled
        ? `${totals.reconciledMarketplaces} of ${marketplaceCount} marketplaces · ${inr.format(totals.sellInRevenue)}`
        : inr.format(totals.sellInRevenue);

  return (
    <section className="flex flex-wrap border border-zinc-200 bg-white">
      <Metric
        label="Marketplaces"
        value={num.format(marketplaceCount)}
        detail={
          totals.reconciledMarketplaces === marketplaceCount
            ? "all reconciled"
            : `${totals.reconciledMarketplaces} reconciled`
        }
        tone={partiallyReconciled || totals.reconciledMarketplaces === 0 ? "warn" : undefined}
      />
      <Metric
        label="Products"
        value={num.format(totals.products)}
        detail="one record per marketplace"
      />
      <Metric
        label="Mapped"
        value={
          totals.mappedProducts + totals.unresolvedProducts > 0
            ? `${totals.mappedProducts} / ${totals.mappedProducts + totals.unresolvedProducts}`
            : "—"
        }
        detail={
          totals.unresolvedProducts === 0
            ? "all products matched"
            : `${totals.unresolvedProducts} need review`
        }
        tone={totals.unresolvedProducts > 0 ? "warn" : undefined}
      />
      <Metric
        label={STOCK_ON_HAND.label}
        value={totals.stockProducts > 0 ? num.format(totals.stockAvailable) : "—"}
        detail={
          totals.stockProducts > 0
            ? `available now · ${num.format(totals.stockProducts)} products`
            : "live position unavailable"
        }
        tone={totals.stockProducts > 0 ? undefined : "warn"}
      />
      <Metric
        label={SELL_IN.label}
        value={totals.reconciledMarketplaces > 0 ? num.format(totals.sellIn) : "—"}
        detail={sellInDetail}
        tone={totals.reconciledMarketplaces === 0 ? "warn" : undefined}
      />
      <Metric
        label={SELL_OUT.label}
        value={num.format(totals.sellOut)}
        detail={inr.format(totals.sellOutRevenue)}
      />
      <Metric
        label="Variance"
        value={
          totals.reconciledMarketplaces > 0
            ? `${totals.quantityVariance > 0 ? "+" : totals.quantityVariance < 0 ? "−" : ""}${num.format(Math.abs(totals.quantityVariance))}`
            : "—"
        }
        detail={
          totals.reconciledMarketplaces === 0
            ? "needs a configured marketplace"
            : partiallyReconciled
              ? "reconciled marketplaces only"
              : "sell-out minus sell-in"
        }
        tone={
          totals.reconciledMarketplaces === 0
            ? "warn"
            : totals.quantityVariance > 0
              ? "up"
              : totals.quantityVariance < 0
                ? "down"
                : undefined
        }
      />
    </section>
  );
}

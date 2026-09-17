import type { ViewTotals } from "@/lib/report/snapshot-model";
import { CURRENT_SOH, GRN, SALES_QUANTITY } from "@/lib/report/vocabulary";

/**
 * The five figures worth quoting, on one line.
 *
 * Typography and a hairline carry the separation; there are no cards, because a
 * card around a number adds nothing a reader uses. Damage and Returned are not
 * here — they belong in the rows, where a zero reads as a value rather than as
 * a headline.
 *
 * An em dash where a source holds nothing. GRN reads as a dash until a customer
 * goods receipt exists; a zero would claim one was raised and recorded nothing.
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
  title,
}: {
  label: string;
  value: string;
  detail?: string;
  title?: string;
}) {
  return (
    <div
      className="flex min-w-0 flex-1 flex-col gap-1 border-l border-zinc-200 px-5 py-3.5 first:border-l-0 first:pl-0"
      title={title}
    >
      <span className="text-[11px] tracking-wide text-zinc-500 uppercase">{label}</span>
      <span className="text-[19px] leading-none font-semibold text-zinc-900">{value}</span>
      {detail ? (
        <span className="truncate text-[11px] text-zinc-400">{detail}</span>
      ) : (
        <span className="h-[14px]" aria-hidden />
      )}
    </div>
  );
}

export function SummaryStrip({
  totals,
  marketplaceCount,
  monthCount,
}: {
  totals: ViewTotals;
  marketplaceCount: number;
  monthCount: number;
}) {
  return (
    <section className="flex flex-wrap border-b border-zinc-200 bg-white px-5">
      <Metric
        label="Marketplaces"
        value={num.format(marketplaceCount)}
        detail={`${num.format(monthCount)} month${monthCount === 1 ? "" : "s"}`}
      />
      <Metric
        label="Products"
        value={num.format(totals.products)}
        detail={`${num.format(totals.rows)} rows`}
      />
      <Metric
        label={CURRENT_SOH.label}
        value={totals.currentSoh === null ? "—" : num.format(totals.currentSoh)}
        title={CURRENT_SOH.description}
      />
      <Metric
        label={GRN.label}
        value={totals.grn === null ? "—" : num.format(totals.grn)}
        title={GRN.description}
      />
      <Metric
        label={SALES_QUANTITY.label}
        value={num.format(totals.salesQuantity)}
        detail={inr.format(totals.salesValue)}
        title={SALES_QUANTITY.description}
      />
    </section>
  );
}

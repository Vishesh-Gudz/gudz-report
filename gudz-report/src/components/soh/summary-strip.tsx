import type { ViewTotals } from "@/lib/report/snapshot-model";
import { CURRENT_SOH, GRN, SALES_QUANTITY } from "@/lib/report/vocabulary";

/**
 * The figures somebody quotes from this report.
 *
 * An em dash wherever a source holds nothing. GRN in particular reads as a dash
 * until a customer goods receipt exists; a zero would claim one was raised and
 * recorded nothing, which is a different and wrong statement.
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
  tone?: "warn";
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5 border-l border-zinc-200 px-5 py-4 first:border-l-0">
      <span className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
        {label}
      </span>
      <span className="text-[22px] leading-tight font-semibold text-zinc-900">{value}</span>
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
  monthCount,
}: {
  totals: ViewTotals;
  marketplaceCount: number;
  monthCount: number;
}) {
  return (
    <section className="flex flex-wrap border border-zinc-200 bg-white">
      <Metric
        label="Marketplaces"
        value={num.format(marketplaceCount)}
        detail={`${num.format(monthCount)} month${monthCount === 1 ? "" : "s"}`}
      />
      <Metric
        label="Products"
        value={num.format(totals.products)}
        detail={`${num.format(totals.rows)} product-months`}
      />
      <Metric
        label="Mapped"
        value={
          totals.products > 0
            ? `${totals.products - totals.unresolvedProducts} / ${totals.products}`
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
        label={CURRENT_SOH.label}
        value={totals.currentSoh === null ? "—" : num.format(totals.currentSoh)}
        detail={totals.currentSoh === null ? "live position unavailable" : "available now"}
        tone={totals.currentSoh === null ? "warn" : undefined}
      />
      <Metric
        label={GRN.label}
        value={totals.grn === null ? "—" : num.format(totals.grn)}
        detail={totals.grn === null ? GRN.awaiting : "received by the customer"}
        tone={totals.grn === null ? "warn" : undefined}
      />
      <Metric
        label={SALES_QUANTITY.label}
        value={num.format(totals.salesQuantity)}
        detail={inr.format(totals.salesValue)}
      />
    </section>
  );
}

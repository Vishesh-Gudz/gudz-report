import type { ReportKpis } from "@/lib/report/aggregate";

/**
 * Headline figures.
 *
 * Every number comes from the aggregated model, never recomputed here — a card
 * and a table that each total the same rows independently will eventually
 * disagree, and whichever one the client reads first is the one they quote.
 */

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const count = new Intl.NumberFormat("en-IN");

function Card({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "warn";
}) {
  return (
    <div
      className={[
        "rounded-lg border p-4",
        tone === "warn"
          ? "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950"
          : "border-zinc-200 dark:border-zinc-800",
      ].join(" ")}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-xs text-zinc-500">{hint}</p> : null}
    </div>
  );
}

export function KpiCards({ kpis }: { kpis: ReportKpis }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
      <Card label="Orders" value={count.format(kpis.orders)} hint="Excl. draft & cancelled" />
      <Card label="Customers" value={count.format(kpis.customers)} />
      <Card
        label="Units Ordered"
        value={count.format(kpis.unitsOrdered)}
        hint="orderedQuantity"
      />
      <Card label="Revenue" value={inr.format(kpis.revenue)} hint="Sum of ERP line totals" />
      <Card label="Matched Lines" value={count.format(kpis.matchedLines)} />
      <Card
        label="Unmatched Lines"
        value={count.format(kpis.unmatchedLines + kpis.ambiguousLines)}
        // Highlighted when non-zero: an unmatched row is the number most worth
        // acting on, and a quiet zero-styled card is the one people skip.
        tone={kpis.unmatchedLines + kpis.ambiguousLines > 0 ? "warn" : "default"}
        hint={
          kpis.ambiguousLines > 0
            ? `${count.format(kpis.ambiguousLines)} ambiguous`
            : undefined
        }
      />
    </div>
  );
}

import type { ReportKpis } from "@/lib/report/marketplace-report";

/**
 * The headline numbers.
 *
 * Both sides are shown side by side rather than as a single "revenue" figure,
 * because the whole point of the report is that the two disagree. A dashboard
 * that showed one number would be hiding the question it exists to answer.
 *
 * Every ERP figure here is after the status policy: drafts and cancellations are
 * excluded before anything is summed, using the same status list sent to the ERP
 * as a filter. There is no view of this page that includes a draft order.
 */

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const num = new Intl.NumberFormat("en-IN");

interface Card {
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
  readonly tone?: "neutral" | "warn";
}

export function ReportKpiCards({ kpis }: { kpis: ReportKpis }) {
  const cards: Card[] = [
    { label: "ERP Orders", value: num.format(kpis.erpOrders) },
    { label: "ERP Customers", value: num.format(kpis.erpCustomers) },
    { label: "ERP Units", value: num.format(kpis.erpUnits), hint: "orderedQuantity" },
    { label: "Report Units", value: num.format(kpis.reportUnits) },
    { label: "ERP Revenue", value: inr.format(kpis.erpRevenue) },
    { label: "Report Revenue", value: inr.format(kpis.reportRevenue) },
    { label: "Matched SKUs", value: num.format(kpis.skusMatched), hint: "both sides agree" },
    {
      label: "SKUs with variance",
      value: num.format(kpis.skusWithVariance),
      tone: kpis.skusWithVariance > 0 ? "warn" : "neutral",
    },
    { label: "ERP only", value: num.format(kpis.skusErpOnly) },
    { label: "Report only", value: num.format(kpis.skusExcelOnly) },
    {
      label: "Unmapped rows",
      value: num.format(kpis.unmappedRows),
      hint: "no ERP product",
      tone: kpis.unmappedRows > 0 ? "warn" : "neutral",
    },
    {
      label: "Ambiguous rows",
      value: num.format(kpis.ambiguousRows),
      hint: "needs a human",
      tone: kpis.ambiguousRows > 0 ? "warn" : "neutral",
    },
  ];

  return (
    <dl className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
      {cards.map((card) => (
        <div
          key={card.label}
          className={`rounded-lg border p-3 ${
            card.tone === "warn"
              ? "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950"
              : "border-zinc-200 dark:border-zinc-800"
          }`}
        >
          <dt className="text-xs text-zinc-500">{card.label}</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums">{card.value}</dd>
          {card.hint ? (
            <p className="mt-0.5 text-xs text-zinc-500">{card.hint}</p>
          ) : null}
        </div>
      ))}
    </dl>
  );
}

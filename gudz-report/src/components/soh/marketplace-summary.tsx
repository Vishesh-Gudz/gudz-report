import { AlertTriangle } from "lucide-react";

import type { SnapshotMarketplace } from "@/lib/report/snapshot-model";
import { GRN_STATE_LABELS, SALES_QUANTITY } from "@/lib/report/vocabulary";

/**
 * One line per marketplace: what was read, and how far the ERP reached.
 *
 * Shown whenever a report covers more than one marketplace, because the
 * headline totals hide the thing a reader most needs — that GRN exists for some
 * marketplaces and not others. Each keeps its own reporting period; they
 * genuinely differ inside one workbook.
 */

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const num = new Intl.NumberFormat("en-IN");

const GRN_STYLES: Record<string, string> = {
  available: "border-emerald-200 bg-emerald-50 text-emerald-700",
  awaiting: "border-zinc-200 bg-zinc-50 text-zinc-600",
  notConfigured: "border-zinc-200 bg-zinc-50 text-zinc-500",
  unavailable: "border-amber-200 bg-amber-50 text-amber-800",
};

export function MarketplaceSummary({ sections }: { sections: SnapshotMarketplace[] }) {
  if (sections.length <= 1) return null;

  return (
    <section className="border border-zinc-200 bg-white">
      <header className="flex items-baseline justify-between gap-3 border-b border-zinc-200 px-5 py-3">
        <h2 className="text-[13px] font-semibold text-zinc-900">By marketplace</h2>
        <p className="text-[12px] text-zinc-500">Each report keeps its own period</p>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] text-[13px]">
          <thead>
            <tr className="border-b border-zinc-200 text-[11px] tracking-wide text-zinc-500 uppercase">
              <th className="px-5 py-2 text-left font-medium">Marketplace</th>
              <th className="px-3 py-2 text-left font-medium">Period</th>
              <th className="px-3 py-2 text-right font-medium">Products</th>
              <th className="px-3 py-2 text-right font-medium">{SALES_QUANTITY.label}</th>
              <th className="px-3 py-2 text-right font-medium">Value</th>
              <th className="px-5 py-2 text-left font-medium">GRN status</th>
            </tr>
          </thead>
          <tbody>
            {sections.map((section) => (
              <tr key={section.marketplace} className="border-b border-zinc-100 last:border-0">
                <td className="px-5 py-2 font-medium text-zinc-900 capitalize">
                  {section.marketplace}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-zinc-600">
                  {section.periodStart && section.periodEnd
                    ? `${section.periodStart} → ${section.periodEnd}`
                    : "—"}
                </td>
                <td className="px-3 py-2 text-right text-zinc-700">
                  {section.status === "failed" ? "—" : num.format(section.products)}
                </td>
                <td className="px-3 py-2 text-right text-zinc-700">
                  {section.status === "failed" ? "—" : num.format(section.salesQuantity)}
                </td>
                <td className="px-3 py-2 text-right text-zinc-700">
                  {section.status === "failed" ? "—" : inr.format(section.salesValue)}
                </td>
                <td className="px-5 py-2">
                  {section.status === "failed" ? (
                    <>
                      <span className="inline-flex items-center gap-1.5 rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-700">
                        <AlertTriangle className="h-3 w-3" aria-hidden />
                        Unable to process
                      </span>
                      {section.errorMessage ? (
                        <p className="mt-1 max-w-[22rem] text-[11px] text-red-700">
                          {section.errorMessage}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <span
                      title={section.grnMessage ?? undefined}
                      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${
                        GRN_STYLES[section.grnState] ?? GRN_STYLES.notConfigured
                      }`}
                    >
                      {GRN_STATE_LABELS[section.grnState] ?? section.grnState}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

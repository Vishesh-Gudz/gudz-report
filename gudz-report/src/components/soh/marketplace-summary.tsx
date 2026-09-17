import { AlertTriangle } from "lucide-react";

import type { MarketplaceSection } from "@/lib/report/soh-report";

/**
 * One line per marketplace: what was read, and whether it could be reconciled.
 *
 * Shown whenever an upload covers more than one marketplace, because the
 * headline totals hide the thing a reader most needs to know — that sell-in
 * exists for some marketplaces and not others. A single "sell-out 214,000"
 * without this table invites the assumption that every channel was measured the
 * same way.
 *
 * A marketplace with no ERP customer configured shows a dash for sell-in rather
 * than a zero, and says so in its status. A marketplace whose sheet failed keeps
 * its row and carries the reason.
 */

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const num = new Intl.NumberFormat("en-IN");

const ERP_LABELS: Record<MarketplaceSection["erpState"], string> = {
  reconciled: "Reconciled",
  notConfigured: "ERP not configured",
  unavailable: "ERP unavailable",
};

const ERP_STYLES: Record<MarketplaceSection["erpState"], string> = {
  reconciled: "border-emerald-200 bg-emerald-50 text-emerald-700",
  notConfigured: "border-zinc-200 bg-zinc-50 text-zinc-600",
  unavailable: "border-amber-200 bg-amber-50 text-amber-800",
};

export function MarketplaceSummary({
  sections,
}: {
  sections: MarketplaceSection[];
}) {
  if (sections.length <= 1) return null;

  return (
    <section className="border border-zinc-200 bg-white">
      <header className="flex items-baseline justify-between gap-3 border-b border-zinc-200 px-5 py-3">
        <h2 className="text-[13px] font-semibold text-zinc-900">By marketplace</h2>
        <p className="text-[12px] text-zinc-500">
          Each sheet has its own reporting period and its own ERP status
        </p>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[54rem] text-[13px]">
          <thead>
            <tr className="border-b border-zinc-200 text-zinc-500">
              <th className="px-5 py-2 text-left text-[11px] font-medium tracking-wide uppercase">
                Marketplace
              </th>
              <th className="px-3 py-2 text-left text-[11px] font-medium tracking-wide uppercase">
                Period
              </th>
              <th className="px-3 py-2 text-right text-[11px] font-medium tracking-wide uppercase">
                Products
              </th>
              <th className="px-3 py-2 text-right text-[11px] font-medium tracking-wide uppercase">
                Sell-in
              </th>
              <th className="px-3 py-2 text-right text-[11px] font-medium tracking-wide uppercase">
                Sell-out
              </th>
              <th className="px-3 py-2 text-right text-[11px] font-medium tracking-wide uppercase">
                Sell-out value
              </th>
              <th className="px-5 py-2 text-left text-[11px] font-medium tracking-wide uppercase">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {sections.map((section) => (
              <tr key={section.marketplace} className="border-b border-zinc-100 last:border-0">
                <td className="px-5 py-2 font-medium text-zinc-900 capitalize">
                  {section.marketplace}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-zinc-600">
                  {section.period
                    ? `${section.period.fromDay} → ${section.period.toDay}`
                    : "—"}
                </td>
                <td className="px-3 py-2 text-right text-zinc-700">
                  {section.status === "failed" ? "—" : num.format(section.rows.length)}
                </td>
                <td className="px-3 py-2 text-right text-zinc-700">
                  {section.erpState === "reconciled"
                    ? num.format(section.sellInQuantity)
                    : "—"}
                </td>
                <td className="px-3 py-2 text-right text-zinc-700">
                  {section.status === "failed"
                    ? "—"
                    : num.format(section.sellOutQuantity)}
                </td>
                <td className="px-3 py-2 text-right text-zinc-700">
                  {section.status === "failed"
                    ? "—"
                    : inr.format(section.sellOutRevenue)}
                </td>
                <td className="px-5 py-2">
                  {section.status === "failed" ? (
                    <span className="inline-flex items-center gap-1.5 rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-700">
                      <AlertTriangle className="h-3 w-3" aria-hidden />
                      Import failed
                    </span>
                  ) : (
                    <span
                      title={section.erpMessage ?? undefined}
                      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${ERP_STYLES[section.erpState]}`}
                    >
                      {ERP_LABELS[section.erpState]}
                    </span>
                  )}
                  {section.status === "failed" && section.error ? (
                    <p className="mt-1 max-w-[22rem] text-[11px] text-red-700">
                      {section.error}
                    </p>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

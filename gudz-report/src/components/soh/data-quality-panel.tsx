import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Check, Minus } from "lucide-react";

import type { MarketplaceReport } from "@/lib/report/marketplace-report";

/**
 * What the report does and does not know, stated before anyone has to ask.
 *
 * This section is why the numbers above it can be quoted. Two things get said
 * plainly here that a dashboard is normally tempted to bury:
 *
 *  - how much of the marketplace report reached an ERP product, because the
 *    unmapped share is counted in sell-out but has no sell-in to compare to;
 *  - that **historical** stock is unavailable. Opening and closing SOH would
 *    have to be replayed from a stock ledger with a known sync backlog, and a
 *    figure like that looks authoritative precisely when it is wrong. An empty
 *    column would invite a reader to assume zero; this says the words instead.
 *
 * The live stock position is real and is labelled as live, not as period-end.
 */

const num = new Intl.NumberFormat("en-IN");

type State = "ok" | "warn" | "absent";

function Line({
  state,
  title,
  detail,
  action,
}: {
  state: State;
  title: string;
  detail: string;
  action?: { href: string; label: string };
}) {
  const Icon = state === "ok" ? Check : state === "warn" ? AlertTriangle : Minus;
  const tone =
    state === "ok"
      ? "text-emerald-600"
      : state === "warn"
        ? "text-amber-600"
        : "text-zinc-400";

  return (
    <li className="flex gap-3 border-b border-zinc-100 px-5 py-3 last:border-0">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-zinc-900">{title}</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-zinc-500">{detail}</p>
      </div>
      {action ? (
        <Link
          href={action.href}
          className="inline-flex shrink-0 items-center gap-1 self-center rounded border border-zinc-200 px-2 py-1 text-[12px] text-zinc-700 hover:bg-zinc-50"
        >
          {action.label}
          <ArrowUpRight className="h-3 w-3" aria-hidden />
        </Link>
      ) : null}
    </li>
  );
}

export function DataQualityPanel({
  report,
  importId,
}: {
  report: MarketplaceReport;
  importId: string | null;
}) {
  const mapping = report.excel.mapping;
  const total = mapping?.distinctProducts ?? 0;
  // The same count the review screen lists, so the two can never disagree.
  const needsReview = report.unmappedRows.length;
  const mapped = Math.max(0, total - needsReview);

  const mappingsHref = report.marketplace
    ? `/mappings?marketplace=${report.marketplace}${importId ? `&importId=${importId}` : ""}`
    : "/mappings";

  return (
    <section className="border border-zinc-200 bg-white">
      <header className="border-b border-zinc-200 px-5 py-3">
        <h2 className="text-[13px] font-semibold text-zinc-900">Data quality</h2>
        <p className="mt-0.5 text-[12px] text-zinc-500">
          Where this report is complete, and where it is not.
        </p>
      </header>

      <ul>
        <Line
          state={needsReview === 0 ? "ok" : "warn"}
          title={
            total > 0
              ? `${num.format(mapped)} of ${num.format(total)} products matched to an ERP product`
              : "No marketplace report loaded"
          }
          detail={
            total === 0
              ? "Upload a marketplace report to compare it against ERP sales."
              : needsReview === 0
                ? "Every product in the uploaded report reached an ERP product, so every row has both sides."
                : `${num.format(needsReview)} product${needsReview === 1 ? "" : "s"} could not be matched automatically — usually several ERP records for the same item differing only by pack size. Their sales are still counted, but they have no sell-in to compare against.`
          }
          action={needsReview > 0 ? { href: mappingsHref, label: "Review" } : undefined}
        />

        {mapping && mapping.unmappedQuantity > 0 ? (
          <Line
            state="warn"
            title={`${num.format(mapping.unmappedQuantity)} units not comparable`}
            detail="Counted in sell-out because the marketplace reported them, but not attributable to an ERP product until the products above are matched."
          />
        ) : null}

        <Line
          state={report.erpAvailable ? "ok" : "warn"}
          title={
            report.erpAvailable
              ? "ERP sales data available for this period"
              : "ERP sales data unavailable"
          }
          detail={
            report.erpAvailable
              ? `${num.format(report.erp.orders)} order${report.erp.orders === 1 ? "" : "s"} and ${num.format(report.erp.lines)} line${report.erp.lines === 1 ? "" : "s"} read for ${report.period.fromDay} → ${report.period.toDay}. Draft and cancelled orders are excluded.`
              : "Sell-in figures are missing from this report. This is a connection problem, not an absence of sales."
          }
        />

        <Line
          state={report.stockAvailability.currentAvailable ? "ok" : "warn"}
          title={
            report.stockAvailability.currentAvailable
              ? `Live stock position available for ${num.format(report.stockAvailability.productsWithPosition)} products`
              : "Live stock position unavailable"
          }
          detail={
            report.stockAvailability.currentAvailable
              ? `${num.format(report.stockAvailability.totalAvailable)} units available across Healthy Master's own locations, after deducting stock blocked by open orders. Read live, not as at the end of the period.`
              : (report.stockAvailability.currentError ??
                "The ERP stock position could not be read for these products.")
          }
        />

        {/* Said out loud rather than shown as an empty column. */}
        <Line
          state="absent"
          title="Historical stock on hand unavailable"
          detail={report.stockAvailability.historyReason}
        />
      </ul>
    </section>
  );
}

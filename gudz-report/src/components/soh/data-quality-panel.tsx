import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Check, Minus, XCircle } from "lucide-react";

import type { SohReport } from "@/lib/report/soh-report";
import type { SohTotals } from "@/lib/report/soh-rows";

/**
 * What the report does and does not know, stated before anyone has to ask.
 *
 * Three things get said plainly here that a dashboard is normally tempted to
 * bury:
 *
 *  - how much of each marketplace report reached an ERP product, because the
 *    unmapped share is counted in sell-out but has no sell-in to compare to;
 *  - which marketplaces have no ERP customer configured at all, so their
 *    sell-in column is absent rather than zero;
 *  - that **historical** stock is unavailable. Opening and closing SOH would
 *    have to be replayed from a stock ledger with a known sync backlog, and a
 *    figure like that looks authoritative precisely when it is wrong.
 */

const num = new Intl.NumberFormat("en-IN");

type State = "ok" | "warn" | "absent" | "bad";

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
  const Icon =
    state === "ok" ? Check : state === "bad" ? XCircle : state === "warn" ? AlertTriangle : Minus;
  const tone =
    state === "ok"
      ? "text-emerald-600"
      : state === "bad"
        ? "text-red-600"
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
  totals,
}: {
  report: SohReport;
  totals: SohTotals;
}) {
  const failed = report.sections.filter((section) => section.status === "failed");
  const notConfigured = report.sections.filter(
    (section) => section.status === "completed" && section.erpState === "notConfigured",
  );
  const unavailable = report.sections.filter(
    (section) => section.status === "completed" && section.erpState === "unavailable",
  );
  const reconciled = report.sections.filter(
    (section) => section.erpState === "reconciled",
  );

  const totalProducts = totals.mappedProducts + totals.unresolvedProducts;

  // Review the marketplace with the most unresolved products first — it is the
  // one where a decision moves the report most.
  const worst = [...report.sections]
    .filter((section) => section.unresolvedProducts > 0)
    .sort((a, b) => b.unresolvedProducts - a.unresolvedProducts)[0];

  const mappingsHref = worst
    ? `/mappings?marketplace=${worst.marketplace}${report.importId ? `&importId=${report.importId}` : ""}`
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
        {failed.length > 0 ? (
          <Line
            state="bad"
            title={`${num.format(failed.length)} sheet${failed.length === 1 ? "" : "s"} could not be read`}
            detail={failed
              .map((section) => `${section.marketplace}: ${section.error}`)
              .join(" · ")}
          />
        ) : null}

        <Line
          state={totals.unresolvedProducts === 0 ? "ok" : "warn"}
          title={
            totalProducts > 0
              ? `${num.format(totals.mappedProducts)} of ${num.format(totalProducts)} products matched to an ERP product`
              : "No marketplace report loaded"
          }
          detail={
            totalProducts === 0
              ? "Upload a marketplace report to compare it against ERP sales."
              : totals.unresolvedProducts === 0
                ? "Every product in this upload reached an ERP product."
                : `${num.format(totals.unresolvedProducts)} product${totals.unresolvedProducts === 1 ? "" : "s"} could not be matched automatically — usually several ERP records for the same item differing only by pack size. Their sales are still counted, but they have no sell-in to compare against.`
          }
          action={
            totals.unresolvedProducts > 0
              ? { href: mappingsHref, label: "Review" }
              : undefined
          }
        />

        <Line
          state={reconciled.length > 0 ? "ok" : "warn"}
          title={
            reconciled.length > 0
              ? `ERP sell-in read for ${reconciled.map((section) => section.marketplace).join(", ")}`
              : "No marketplace has ERP reconciliation configured"
          }
          detail={
            reconciled.length > 0
              ? `${num.format(reconciled.reduce((total, section) => total + section.erpOrders, 0))} orders and ${num.format(reconciled.reduce((total, section) => total + section.erpLines, 0))} lines, each read for its own marketplace's reporting period. Draft and cancelled orders are excluded.`
              : "Sell-out is shown from the uploaded reports, but there is nothing to compare it against until a customer GSTIN is configured for at least one marketplace."
          }
        />

        {notConfigured.length > 0 ? (
          <Line
            state="absent"
            title={`ERP reconciliation not configured for ${notConfigured.map((section) => section.marketplace).join(", ")}`}
            detail="These reports are parsed and their sell-out is counted, but no ERP customer is configured for them, so their sell-in column is absent rather than zero. Configuring the marketplace's customer GSTIN enables it."
          />
        ) : null}

        {unavailable.length > 0 ? (
          <Line
            state="warn"
            title={`ERP unavailable for ${unavailable.map((section) => section.marketplace).join(", ")}`}
            detail={
              unavailable
                .map((section) => section.erpMessage)
                .filter(Boolean)
                .join(" · ") ||
              "Configured, but the ERP could not be read. Sell-in is missing rather than zero."
            }
          />
        ) : null}

        <Line
          state={report.stockAvailable ? "ok" : "warn"}
          title={
            report.stockAvailable
              ? `Live stock position available for ${num.format(totals.stockProducts)} products`
              : "Live stock position unavailable"
          }
          detail={
            report.stockAvailable
              ? `${num.format(totals.stockAvailable)} units available across Healthy Master's own locations, after deducting stock blocked by open orders. Read live, not as at the end of any reporting period.`
              : (report.stockError ??
                "The ERP stock position could not be read for these products.")
          }
        />

        {report.periodsDiffer ? (
          <Line
            state="absent"
            title="Multiple reporting periods"
            detail="The uploaded sheets cover different windows, so there is no single period for this report. Each marketplace was reconciled against its own dates; filter by marketplace to see them."
          />
        ) : null}

        {/* Said out loud rather than shown as an empty column. */}
        <Line
          state="absent"
          title="Historical stock on hand unavailable"
          detail={report.historyReason}
        />
      </ul>
    </section>
  );
}

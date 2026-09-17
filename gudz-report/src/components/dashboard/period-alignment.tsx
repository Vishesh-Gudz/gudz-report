import type {
  ErpSideSummary,
  ExcelSideSummary,
} from "@/lib/report/marketplace-report";
import type { ReportingPeriod } from "@/lib/dates/reporting-period";
import { SELL_IN, SELL_OUT } from "@/lib/report/vocabulary";

/**
 * Do both halves actually describe the same window?
 *
 * Shown before the reconciliation, not after, because every variance below is
 * meaningless if they do not. The failure this catches is quiet: a spreadsheet
 * covering June to August compared against an ERP query for August produces a
 * page full of plausible variances that are really just missing months.
 *
 * The two sides are labelled by what they measure, not by which system they came
 * from: sell-out is what the marketplace says it sold to consumers, sell-in is
 * what Healthy Master invoiced to the marketplace. Different events, different
 * times, and the gap between them is the report. See `report/vocabulary.ts`.
 */

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const num = new Intl.NumberFormat("en-IN");

export function PeriodAlignment({
  period,
  excel,
  erp,
}: {
  period: ReportingPeriod;
  excel: ExcelSideSummary;
  erp: ErpSideSummary;
}) {
  // The period is derived from the spreadsheet, so a mismatch means someone
  // overrode it by hand — worth saying out loud rather than leaving to be
  // noticed.
  const aligned =
    excel.minDate === null ||
    excel.maxDate === null ||
    (excel.minDate === period.fromDay && excel.maxDate === period.toDay);

  return (
    <section className="grid gap-3 md:grid-cols-2">
      <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h3 className="text-sm font-medium">
          {SELL_OUT.label}{" "}
          {excel.sheet ? <code className="text-xs">{excel.sheet}</code> : null}
        </h3>
        <p className="mt-1 text-xs text-zinc-500">
          {SELL_OUT.source} · {excel.fileName ?? "no import loaded"}
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <Fact label="Date range" value={
            excel.minDate && excel.maxDate
              ? `${excel.minDate} → ${excel.maxDate}`
              : "—"
          } />
          <Fact label="Rows" value={num.format(excel.rows)} />
          <Fact
            label="Mapped rows"
            value={excel.mapping ? num.format(excel.mapping.mapped) : "—"}
          />
          <Fact
            label="Unmapped rows"
            value={
              excel.mapping
                ? num.format(excel.mapping.unmapped + excel.mapping.ambiguous)
                : "—"
            }
            tone={
              excel.mapping && excel.mapping.unmapped + excel.mapping.ambiguous > 0
                ? "warn"
                : undefined
            }
          />
          <Fact label="Units" value={num.format(excel.quantity)} />
          <Fact label="Revenue" value={inr.format(excel.revenue)} />
        </dl>
      </div>

      <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h3 className="text-sm font-medium">
          {SELL_IN.label} · {SELL_IN.source}
        </h3>
        <p className="mt-1 text-xs text-zinc-500">
          {erp.gstins.length > 0
            ? `Customer GSTIN ${erp.gstins.join(", ")}`
            : "No GSTIN filter — every B2B customer"}
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <Fact label="Date range" value={`${period.fromDay} → ${period.toDay}`} />
          <Fact label="Orders" value={num.format(erp.orders)} />
          <Fact label="Lines" value={num.format(erp.lines)} />
          <Fact label="Distinct SKUs" value={num.format(erp.skus)} />
          <Fact label="Units" value={num.format(erp.quantity)} />
          <Fact label="Revenue" value={inr.format(erp.revenue)} />
        </dl>
        {erp.erpReportedOrders !== null && erp.erpReportedOrders !== erp.orders ? (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-500">
            The ERP reports {num.format(erp.erpReportedOrders)} orders for this
            filter but {num.format(erp.orders)} were counted from the lines
            returned. Worth checking before quoting either number.
          </p>
        ) : null}
      </div>

      {!aligned ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm md:col-span-2 dark:border-amber-900 dark:bg-amber-950">
          The ERP was queried for {period.fromDay} → {period.toDay}, but the
          spreadsheet covers {excel.minDate} → {excel.maxDate}. Every variance
          below includes that difference in window, not just a difference in
          sales.
        </p>
      ) : null}
    </section>
  );
}

function Fact({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn";
}) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd
        className={`font-medium tabular-nums ${
          tone === "warn" ? "text-amber-700 dark:text-amber-500" : ""
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

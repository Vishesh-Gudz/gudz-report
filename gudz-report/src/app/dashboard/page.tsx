import { KpiCards } from "@/components/dashboard/kpi-cards";
import { DataQuality } from "@/components/dashboard/data-quality";
import { ProductSummary } from "@/components/dashboard/product-summary";
import { ReportFiltersForm } from "@/components/dashboard/report-filters";
import { ReportTable } from "@/components/dashboard/report-table";
import { filterLines } from "@/lib/report/aggregate";
import { loadReport, resolvePeriod } from "@/lib/report/load";
import { monthPeriod } from "@/lib/dates/reporting-period";
import { REPORTABLE_STATUSES } from "@/lib/report/policy";

export const metadata = { title: "Dashboard · Gudz Report" };

/**
 * The B2B sales report.
 *
 * A Server Component, which is what keeps the ERP key server-side: the fetch
 * happens in this process and only the aggregated model is serialised to the
 * browser. Nothing here is exposed to a client component except plain data.
 *
 * `force-dynamic` because the ERP is queried per request against a live
 * reporting period — a cached page would serve last month's numbers under this
 * month's filters.
 */
export const dynamic = "force-dynamic";

/**
 * Period when nothing else says otherwise.
 *
 * August 2026 is where the verified Healthy Master data actually is (1,245 B2B
 * orders). Defaulting to "this month" would open the dashboard on an empty
 * screen and read as broken.
 */
const FALLBACK_PERIOD = monthPeriod("2026-08");

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

function formatDay(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(date.getTime())
    ? day
    : date.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
}

function single(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  const { period, latestImport } = await resolvePeriod(
    { from: single(params.from), to: single(params.to) },
    FALLBACK_PERIOD,
  );

  const { model, source } = await loadReport({
    period,
    importId: single(params.importId) ?? latestImport?._id ?? null,
  });

  const filters = {
    marketplace: single(params.marketplace),
    customer: single(params.customer),
    sku: single(params.sku),
    product: single(params.product),
    status: single(params.status),
  };

  const lines = filterLines(model.lines, filters);

  // Recomputed for the filtered view so the table footer and the product
  // summary describe the same rows. The KPI cards above stay on the whole
  // period — they answer "how did August go", not "what did I just filter to".
  const filteredRevenue = lines.reduce((total, row) => total + row.lineTotal, 0);

  return (
    <main className="mx-auto flex w-full max-w-[110rem] flex-1 flex-col gap-6 px-6 py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-zinc-500">Healthy Master</p>
          <h1 className="text-2xl font-semibold tracking-tight">
            SOH / B2B Sales Report
          </h1>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-zinc-500">
            Reporting period
          </p>
          <p className="font-medium">
            {formatDay(model.period.fromDay)} → {formatDay(model.period.toDay)}
          </p>
        </div>
      </header>

      {source.warnings.length > 0 ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950">
          <p className="font-medium">Data notes</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {source.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {source.excelRowCount === 0 ? (
        <p className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          No Excel import is loaded for this period, so every line below is shown
          as <strong>ERP only</strong> and no variances are computed. Upload a
          marketplace workbook on the{" "}
          <a href="/imports" className="underline underline-offset-4">
            imports
          </a>{" "}
          page to reconcile against it.
        </p>
      ) : null}

      <KpiCards kpis={model.kpis} />

      <ReportFiltersForm
        values={{
          from: model.period.fromDay,
          to: model.period.toDay,
          ...filters,
        }}
        model={model}
      />

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">Sales order lines</h2>
          <p className="text-sm text-zinc-500">
            Filtered revenue {inr.format(filteredRevenue)} · statuses{" "}
            {REPORTABLE_STATUSES.join(", ")} · quantity from{" "}
            <code>orderedQuantity</code>
          </p>
        </div>
        <ReportTable rows={lines} />
      </section>

      <ProductSummary rows={model.skuReconciliation.rows} />

      <DataQuality kpis={model.kpis} unmatched={model.unmatched} />
    </main>
  );
}

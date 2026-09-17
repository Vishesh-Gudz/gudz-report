import Link from "next/link";

import { MappingQuality } from "@/components/dashboard/mapping-quality";
import { PeriodAlignment } from "@/components/dashboard/period-alignment";
import { ReconciliationTable } from "@/components/dashboard/reconciliation-table";
import { ReportKpiCards } from "@/components/dashboard/report-kpis";
import { ReportSelector } from "@/components/dashboard/report-selector";
import { monthPeriod } from "@/lib/dates/reporting-period";
import { REPORTABLE_STATUSES } from "@/lib/report/policy";
import {
  listImports,
  loadMarketplaceReport,
} from "@/lib/report/marketplace-report";

export const metadata = { title: "Dashboard · Gudz Report" };

/**
 * The client-facing report.
 *
 * A Server Component, which is what keeps the ERP key server-side: the fetch
 * happens in this process and only the aggregated model is serialised to the
 * browser. No client component here receives anything but plain data.
 *
 * `force-dynamic` because the ERP is queried per request against a live
 * reporting period — a cached page would serve one import's numbers under
 * another's filters.
 */
export const dynamic = "force-dynamic";

/**
 * Only used when there is no import at all.
 *
 * The reporting period normally comes from the uploaded sheet's own dates, which
 * is the whole point — the file says what window it covers. This exists so the
 * page renders something real before the first upload rather than an empty
 * screen that reads as broken.
 */
const FALLBACK_PERIOD = monthPeriod("2026-08");

function single(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

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

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  const imports = await listImports();
  const report = await loadMarketplaceReport(
    {
      importId: single(params.importId) ?? null,
      marketplace: single(params.marketplace) ?? null,
    },
    FALLBACK_PERIOD,
  );

  return (
    <main className="mx-auto flex w-full max-w-[110rem] flex-1 flex-col gap-6 px-6 py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-zinc-500">Healthy Master</p>
          <h1 className="text-2xl font-semibold tracking-tight">SOH Report</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Marketplace{" "}
            <strong className="capitalize">
              {report.marketplace ?? "not selected"}
            </strong>
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs tracking-wide text-zinc-500 uppercase">
            Reporting period
          </p>
          <p className="font-medium">
            {formatDay(report.period.fromDay)} → {formatDay(report.period.toDay)}
          </p>
          <p className="text-xs text-zinc-500">
            Derived from the uploaded sheet&rsquo;s own dates
          </p>
        </div>
      </header>

      <ReportSelector
        imports={imports}
        selectedImportId={single(params.importId) ?? null}
        marketplaces={report.availableMarketplaces.map((entry) => entry.marketplace)}
        selectedMarketplace={report.marketplace}
      />

      {report.warnings.length > 0 ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950">
          <p className="font-medium">Data notes</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {report.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {report.excel.rows === 0 ? (
        <p className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          No marketplace sheet is loaded, so every SKU below is shown as{" "}
          <strong>ERP only</strong> and no variances are computed. Upload a
          workbook and choose its sheet on the{" "}
          <Link href="/imports" className="underline underline-offset-4">
            imports
          </Link>{" "}
          page.
        </p>
      ) : null}

      <ReportKpiCards kpis={report.kpis} />

      <PeriodAlignment
        period={report.period}
        excel={report.excel}
        erp={report.erp}
      />

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">Product reconciliation</h2>
          <p className="text-sm text-zinc-500">
            Aggregated per SKU · ERP statuses {REPORTABLE_STATUSES.join(", ")} ·
            quantity from <code>orderedQuantity</code>
          </p>
        </div>
        <ReconciliationTable rows={report.reconciliation.rows} />
      </section>

      <MappingQuality report={report} />
    </main>
  );
}

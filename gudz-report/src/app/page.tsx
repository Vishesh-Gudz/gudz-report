import Link from "next/link";
import { anyApi } from "convex/server";

import { DataQualityPanel } from "@/components/soh/data-quality-panel";
import { MarketplaceSummary } from "@/components/soh/marketplace-summary";
import { ReportShell } from "@/components/soh/report-shell";
import { ReportView } from "@/components/soh/report-view";
import { SummaryStrip } from "@/components/soh/summary-strip";
import { UploadFlow } from "@/components/soh/upload-flow";
import { getConvexClient } from "@/lib/convex/server";
import { loadSohReport } from "@/lib/report/soh-report";
import { buildSohRows, totalsFor } from "@/lib/report/soh-rows";
import { REPORT_EXPLANATION, REPORT_SUBTITLE, REPORT_TITLE } from "@/lib/report/vocabulary";

export const metadata = { title: `${REPORT_TITLE} · Healthy Master` };

/**
 * The product. One route, two states: upload, or report.
 *
 * A Server Component, which is what keeps the ERP key in this process — the
 * browser receives aggregated rows and nothing else. `force-dynamic` because the
 * ERP is read per request: sell-in and the live stock position both move during
 * the day, and a cached page would quietly serve this morning's figures.
 */
export const dynamic = "force-dynamic";

function single(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Confirmed mappings per marketplace, so the table can say which rows a person
 * decided rather than which the matcher inferred.
 *
 * Read per marketplace because a confirmation belongs to one: the same EAN is
 * listed by several channels and means a different pack on each.
 */
async function confirmedByMarketplace(
  marketplaces: string[],
): Promise<Map<string, Set<string>>> {
  const client = getConvexClient();
  const result = new Map<string, Set<string>>();
  if (!client) return result;

  for (const marketplace of marketplaces) {
    try {
      const docs = (await client.query(
        anyApi.productMappings.listForMarketplace as never,
        { marketplace } as never,
      )) as { erpSku: string }[];
      result.set(marketplace, new Set(docs.map((doc) => doc.erpSku.toUpperCase())));
    } catch {
      // A missing confirmation list downgrades a badge, nothing more — the
      // report itself already applied the mappings server-side.
      result.set(marketplace, new Set());
    }
  }
  return result;
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requestedImportId = single(params.importId) ?? null;
  const wantsUpload = single(params.upload) === "1";

  const report = await loadSohReport({ importId: requestedImportId });
  const hasReport = report.importId !== null && report.sections.length > 0;

  if (!hasReport || wantsUpload) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-8 px-6 py-20">
        <div>
          <p className="text-[13px] font-medium text-zinc-500">Healthy Master</p>
          <h1 className="mt-1 text-[28px] leading-tight font-semibold tracking-tight text-zinc-900">
            {REPORT_TITLE}
          </h1>
          <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-zinc-600">
            {hasReport
              ? "Upload a new marketplace workbook, or go back to the current report."
              : "Upload a marketplace workbook to generate the latest stock and sales view. One workbook can cover every marketplace at once."}
          </p>
        </div>

        <UploadFlow />

        {hasReport ? (
          <p className="text-[13px] text-zinc-500">
            <Link href="/" className="underline underline-offset-4 hover:text-zinc-900">
              Back to the current report
            </Link>
          </p>
        ) : null}
      </main>
    );
  }

  const rows = buildSohRows(
    report,
    await confirmedByMarketplace(report.marketplaces),
  );
  const totals = totalsFor(rows);

  const marketplaces = report.sections
    .filter((section) => section.status === "completed")
    .map((section) => section.marketplace);

  return (
    <ReportShell
      title={REPORT_TITLE}
      subtitle={REPORT_SUBTITLE}
      marketplaceLabel={
        marketplaces.length === 1 ? marketplaces[0]! : `All (${marketplaces.length})`
      }
      period={report.period}
      periodsDiffer={report.periodsDiffer}
      sourceFileName={report.fileName}
      rows={rows}
    >
      {report.warnings.length > 0 ? (
        <div className="border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-[13px] font-medium text-amber-900">
            Some figures in this report are incomplete
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px] text-amber-800">
            {report.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <SummaryStrip totals={totals} marketplaceCount={marketplaces.length} />

      <p className="max-w-4xl text-[12px] leading-relaxed text-zinc-500">
        {REPORT_EXPLANATION}
      </p>

      <MarketplaceSummary sections={report.sections} />

      <ReportView rows={rows} marketplaces={marketplaces} />

      <DataQualityPanel report={report} totals={totals} />
    </ReportShell>
  );
}

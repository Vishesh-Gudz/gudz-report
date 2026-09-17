import Link from "next/link";
import { anyApi } from "convex/server";

import { DataQualityPanel } from "@/components/soh/data-quality-panel";
import { ReportShell } from "@/components/soh/report-shell";
import { ReportView } from "@/components/soh/report-view";
import { SummaryStrip } from "@/components/soh/summary-strip";
import { UploadFlow } from "@/components/soh/upload-flow";
import { getConvexClient } from "@/lib/convex/server";
import { monthPeriod } from "@/lib/dates/reporting-period";
import {
  listImports,
  loadMarketplaceReport,
} from "@/lib/report/marketplace-report";
import { buildSohRows } from "@/lib/report/soh-rows";
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

/** Only reached when no report has ever been uploaded. */
const FALLBACK_PERIOD = monthPeriod("2026-08");

function single(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

interface ConfirmedDoc {
  erpSku: string;
}

/**
 * Which SKUs a person confirmed, so the table can say so.
 *
 * The reconciliation groups on the resolved ERP SKU and no longer remembers
 * which route produced it, so the confirmed set is read here and passed down.
 */
async function confirmedSkus(marketplace: string | null): Promise<Set<string>> {
  const client = getConvexClient();
  if (!client || !marketplace) return new Set();
  try {
    const docs = (await client.query(
      anyApi.productMappings.listForMarketplace as never,
      { marketplace } as never,
    )) as ConfirmedDoc[];
    return new Set(docs.map((doc) => doc.erpSku.toUpperCase()));
  } catch {
    // A missing confirmation list downgrades a badge, nothing more. The report
    // itself already applied the mappings server-side.
    return new Set();
  }
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requestedImportId = single(params.importId) ?? null;
  const wantsUpload = single(params.upload) === "1";

  const imports = await listImports();
  const usable = imports.filter(
    (entry) => entry.status === "completed" && entry.minDate && entry.maxDate,
  );

  // Nothing has ever been uploaded, or the client asked for the upload screen.
  if (usable.length === 0 || wantsUpload) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-8 px-6 py-20">
        <div>
          <p className="text-[13px] font-medium text-zinc-500">Healthy Master</p>
          <h1 className="mt-1 text-[28px] leading-tight font-semibold tracking-tight text-zinc-900">
            {REPORT_TITLE}
          </h1>
          <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-zinc-600">
            {usable.length === 0
              ? "Upload a marketplace report to generate the latest stock and sales view."
              : "Upload a new marketplace report, or go back to the current one."}
          </p>
        </div>

        <UploadFlow />

        {usable.length > 0 ? (
          <p className="text-[13px] text-zinc-500">
            <Link href="/" className="underline underline-offset-4 hover:text-zinc-900">
              Back to the current report
            </Link>
          </p>
        ) : null}
      </main>
    );
  }

  const report = await loadMarketplaceReport(
    { importId: requestedImportId, marketplace: single(params.marketplace) ?? null },
    FALLBACK_PERIOD,
  );

  const rows = buildSohRows(report, await confirmedSkus(report.marketplace));
  const importId = requestedImportId ?? usable[0]?._id ?? null;

  return (
    <ReportShell
      title={REPORT_TITLE}
      subtitle={REPORT_SUBTITLE}
      marketplace={report.marketplace}
      period={{ from: report.period.fromDay, to: report.period.toDay }}
      sourceFileName={report.excel.fileName}
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

      <SummaryStrip report={report} />

      <p className="max-w-4xl text-[12px] leading-relaxed text-zinc-500">
        {REPORT_EXPLANATION}
      </p>

      <ReportView
        rows={rows}
        period={{ from: report.period.fromDay, to: report.period.toDay }}
        marketplace={report.marketplace ?? "marketplace"}
      />

      <DataQualityPanel report={report} importId={importId} />
    </ReportShell>
  );
}

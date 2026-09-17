import Link from "next/link";
import { FileSpreadsheet } from "lucide-react";

import { DataQualityPanel } from "@/components/soh/data-quality-panel";
import { MarketplaceSummary } from "@/components/soh/marketplace-summary";
import { ReportShell } from "@/components/soh/report-shell";
import { ReportView } from "@/components/soh/report-view";
import { UploadFlow } from "@/components/soh/upload-flow";
import {
  listSnapshots,
  loadSnapshot,
  type SnapshotListing,
} from "@/lib/report/snapshot-view";
import { REPORT_SUBTITLE, REPORT_TITLE } from "@/lib/report/vocabulary";

export const metadata = { title: `${REPORT_TITLE} · Healthy Master` };

/**
 * The product. One route, three states: no reports yet, the list, or a report.
 *
 * A Server Component, which is what keeps the ERP key in this process — the
 * browser receives saved rows and nothing else. `force-dynamic` because the list
 * of saved reports changes as reports are made; the reports themselves do not
 * change once saved, which is the point of saving them.
 */
export const dynamic = "force-dynamic";

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
        timeZone: "UTC",
      });
}

function describe(snapshot: SnapshotListing): string {
  if (snapshot.marketplaces.length === 0) return "No marketplace";
  if (snapshot.marketplaces.length === 1) return snapshot.marketplaces[0]!;
  return `All marketplaces (${snapshot.marketplaces.length})`;
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requested = single(params.report) ?? null;
  const wantsUpload = single(params.upload) === "1";

  const snapshots = await listSnapshots();
  const usable = snapshots.filter((entry) => entry.status === "completed");

  // ── A saved report
  if (requested && !wantsUpload) {
    const snapshot = await loadSnapshot(requested);
    if (snapshot && snapshot.status === "completed") {
      const marketplaces = snapshot.sections
        .filter((section) => section.status === "completed")
        .map((section) => section.marketplace);

      const months = [...new Set(snapshot.rows.map((row) => row.month))].sort();
      const needsReview = new Set(
        snapshot.rows
          .filter((row) => row.mappingStatus === "unresolved")
          .map((row) => `${row.marketplace}::${row.sku}`),
      ).size;

      const worst = [...snapshot.sections]
        .filter((section) => section.unresolvedProducts > 0)
        .sort((a, b) => b.unresolvedProducts - a.unresolvedProducts)[0];

      return (
        <ReportShell snapshot={snapshot}>
          <MarketplaceSummary sections={snapshot.sections} />
          <ReportView rows={snapshot.rows} marketplaces={marketplaces} months={months} />
          <DataQualityPanel
            notes={snapshot.dataQuality}
            needsReview={needsReview}
            reviewHref={
              worst ? `/mappings?marketplace=${worst.marketplace}` : "/mappings"
            }
          />
        </ReportShell>
      );
    }
  }

  // ── Upload, or nothing saved yet
  if (wantsUpload || usable.length === 0) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-8 px-6 py-20">
        <div>
          <p className="text-[13px] font-medium text-zinc-500">Healthy Master</p>
          <h1 className="mt-1 text-[28px] leading-tight font-semibold tracking-tight text-zinc-900">
            {REPORT_TITLE}
          </h1>
          <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-zinc-600">
            {usable.length === 0
              ? "Upload a marketplace workbook to generate a report. One workbook can cover every marketplace at once."
              : REPORT_SUBTITLE}
          </p>
        </div>

        <UploadFlow />

        {usable.length > 0 ? (
          <p className="text-[13px] text-zinc-500">
            <Link href="/" className="underline underline-offset-4 hover:text-zinc-900">
              Back to saved reports
            </Link>
          </p>
        ) : null}
      </main>
    );
  }

  // ── The list of saved reports
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-16">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[13px] font-medium text-zinc-500">Healthy Master</p>
          <h1 className="mt-1 text-[24px] leading-tight font-semibold tracking-tight text-zinc-900">
            {REPORT_TITLE}
          </h1>
        </div>
        <Link
          href="/?upload=1"
          className="flex h-9 items-center rounded bg-zinc-900 px-4 text-[13px] font-medium text-white hover:bg-zinc-800"
        >
          Upload new report
        </Link>
      </div>

      <section className="border border-zinc-200 bg-white">
        <header className="border-b border-zinc-200 px-5 py-3">
          <h2 className="text-[13px] font-semibold text-zinc-900">Recent reports</h2>
        </header>
        <ul>
          {usable.map((snapshot) => (
            <li
              key={snapshot.id}
              className="flex items-center gap-4 border-b border-zinc-100 px-5 py-3 last:border-0"
            >
              <FileSpreadsheet className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-zinc-900 capitalize">
                  {describe(snapshot)}
                </p>
                <p className="mt-0.5 text-[12px] text-zinc-500">
                  {snapshot.periodStart && snapshot.periodEnd
                    ? `${formatDay(snapshot.periodStart)} – ${formatDay(snapshot.periodEnd)} ${snapshot.periodEnd.slice(0, 4)}`
                    : snapshot.periodsDiffer
                      ? "Multiple periods"
                      : "No period"}
                  {" · Processed "}
                  {new Date(snapshot.createdAt).toLocaleDateString("en-GB", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })}
                </p>
              </div>
              <Link
                href={`/?report=${snapshot.id}`}
                className="shrink-0 rounded border border-zinc-200 px-3 py-1.5 text-[13px] font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Open
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

import Image from "next/image";
import Link from "next/link";

import { DataQualityPanel } from "@/components/soh/data-quality-panel";
import { MarketplacePeriods } from "@/components/soh/marketplace-periods";
import { ReportShell } from "@/components/soh/report-shell";
import { ReportView } from "@/components/soh/report-view";
import { UploadFlow } from "@/components/soh/upload-flow";
import {
  listSnapshots,
  loadSnapshot,
  type SnapshotListing,
} from "@/lib/report/snapshot-view";
import { REPORT_TITLE } from "@/lib/report/vocabulary";

export const metadata = { title: `${REPORT_TITLE} · Healthy Master` };

/**
 * One route, three states: nothing saved yet, the list of reports, or a report.
 *
 * A Server Component, which is what keeps the ERP key in this process — the
 * browser receives saved rows and nothing else. `force-dynamic` because the list
 * changes as reports are made; the reports themselves never change once saved,
 * which is the point of saving them.
 */
export const dynamic = "force-dynamic";

function single(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

function shortDay(day: string): string {
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

function describe(snapshot: SnapshotListing): string {
  if (snapshot.marketplaces.length === 0) return "No marketplace";
  if (snapshot.marketplaces.length === 1) return snapshot.marketplaces[0]!;
  return `All marketplaces`;
}

function Brand({ size = 22 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2.5">
      <Image src="/icon.png" alt="" width={size} height={size} className="rounded-sm" priority />
      <span className="text-[13px] font-medium text-zinc-500">Healthy Master</span>
    </span>
  );
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

    if (!snapshot || snapshot.status !== "completed") {
      return (
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-6 py-24">
          <Brand />
          <h1 className="text-[17px] font-semibold text-zinc-900">
            Unable to open this report
          </h1>
          <p className="text-[13px] text-zinc-500">
            It may have been deleted.
          </p>
          <Link
            href="/"
            className="flex h-9 w-fit items-center rounded bg-zinc-900 px-4 text-[13px] font-medium text-white hover:bg-zinc-800"
          >
            All reports
          </Link>
        </main>
      );
    }

    const marketplaces = snapshot.sections
      .filter((section) => section.status === "completed")
      .map((section) => section.marketplace);

    const months = [...new Set(snapshot.rows.map((row) => row.month))].sort();

    const products = new Set(snapshot.rows.map((row) => `${row.marketplace}::${row.sku}`));
    const unresolved = new Set(
      snapshot.rows
        .filter((row) => row.mappingStatus === "unresolved")
        .map((row) => `${row.marketplace}::${row.sku}`),
    );

    const worst = [...snapshot.sections]
      .filter((section) => section.unresolvedProducts > 0)
      .sort((a, b) => b.unresolvedProducts - a.unresolvedProducts)[0];

    return (
      <ReportShell snapshot={snapshot}>
        <div className="border border-zinc-200 bg-white">
          <MarketplacePeriods sections={snapshot.sections} />
          <ReportView
            snapshot={snapshot}
            rows={snapshot.rows}
            marketplaces={marketplaces}
            months={months}
          />
        </div>

        <div className="mt-3">
          <DataQualityPanel
            notes={snapshot.dataQuality}
            mapped={products.size - unresolved.size}
            total={products.size}
            needsReview={unresolved.size}
            reviewHref={worst ? `/mappings?marketplace=${worst.marketplace}` : "/mappings"}
          />
        </div>
      </ReportShell>
    );
  }

  // ── Upload, or nothing saved yet
  if (wantsUpload || usable.length === 0) {
    return (
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-6 px-6 py-24">
        <div className="flex flex-col gap-3">
          <Brand />
          <h1 className="text-[22px] leading-tight font-semibold tracking-tight text-zinc-900">
            {REPORT_TITLE}
          </h1>
        </div>

        <UploadFlow />

        {usable.length > 0 ? (
          <Link
            href="/"
            className="text-[13px] text-zinc-500 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900"
          >
            All reports
          </Link>
        ) : null}
      </main>
    );
  }

  // ── Saved reports
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-6 py-20">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-2">
          <Brand />
          <h1 className="text-[20px] leading-tight font-semibold tracking-tight text-zinc-900">
            {REPORT_TITLE}
          </h1>
        </div>
        <Link
          href="/?upload=1"
          className="flex h-9 items-center rounded bg-zinc-900 px-4 text-[13px] font-medium text-white hover:bg-zinc-800"
        >
          Upload report
        </Link>
      </div>

      <ul className="border border-zinc-200 bg-white">
        {usable.map((snapshot) => (
          <li
            key={snapshot.id}
            className="flex items-center gap-4 border-b border-zinc-100 px-4 py-2.5 last:border-0"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-zinc-900 capitalize">
                {describe(snapshot)}
              </p>
              <p className="mt-0.5 text-[12px] text-zinc-500">
                {snapshot.periodStart && snapshot.periodEnd
                  ? `${shortDay(snapshot.periodStart)} – ${shortDay(snapshot.periodEnd)}`
                  : snapshot.periodsDiffer
                    ? "Multiple periods"
                    : "No period"}
              </p>
            </div>
            <span className="shrink-0 text-[12px] text-zinc-400">
              {new Date(snapshot.createdAt).toLocaleDateString("en-GB", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
            </span>
            <Link
              href={`/?report=${snapshot.id}`}
              className="shrink-0 rounded border border-zinc-200 px-3 py-1 text-[12px] font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Open
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}

"use client";

import Image from "next/image";
import Link from "next/link";

import type { SnapshotView } from "@/lib/report/snapshot-model";
import { REPORT_TITLE } from "@/lib/report/vocabulary";

/**
 * The frame: what this report covers, and what you can do with it.
 *
 * Export is built in the browser from the snapshot rows already on the page, so
 * what lands in Excel is exactly what was saved — no second code path
 * recomputing the same figures, and no need for the original workbook, which is
 * deleted after processing. A missing figure exports as an em dash for the same
 * reason it displays as one: a zero would be a claim.
 */

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


export function ReportShell({
  snapshot,
  children,
}: {
  snapshot: SnapshotView;
  children: React.ReactNode;
}) {
  const marketplaceLabel =
    snapshot.marketplaces.length === 1
      ? snapshot.marketplaces[0]!
      : `All (${snapshot.marketplaces.length})`;




  return (
    <div className="flex min-h-full flex-col bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex w-full max-w-[110rem] flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Image
              src="/icon.png"
              alt=""
              width={20}
              height={20}
              className="rounded-sm"
              priority
            />
            <h1 className="text-[15px] font-semibold tracking-tight text-zinc-900">
              {REPORT_TITLE}
            </h1>
            <span className="text-zinc-300" aria-hidden>
              /
            </span>
            <p className="min-w-0 truncate text-[13px] text-zinc-600">
              <span className="capitalize">{marketplaceLabel}</span>
              <span className="text-zinc-300"> · </span>
              {snapshot.periodStart && snapshot.periodEnd
                ? `${formatDay(snapshot.periodStart)} – ${formatDay(snapshot.periodEnd)}`
                : snapshot.periodsDiffer
                  ? "Multiple periods"
                  : "No period"}
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            <Link
              href="/?upload=1"
              className="flex h-8 items-center rounded px-2.5 text-[13px] text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
            >
              New report
            </Link>
            <Link
              href="/"
              className="flex h-8 items-center rounded px-2.5 text-[13px] text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
            >
              All reports
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[110rem] flex-1 flex-col px-5 py-4">
        {children}
      </main>
    </div>
  );
}

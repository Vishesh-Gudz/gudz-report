"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Download } from "lucide-react";

import type { SnapshotView } from "@/lib/report/snapshot-model";
import { buildExport, exportFileName, toCsv } from "@/lib/report/export";
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
  const anchorRef = useRef<HTMLAnchorElement>(null);
  const [busy, setBusy] = useState(false);

  const marketplaceLabel =
    snapshot.marketplaces.length === 1
      ? snapshot.marketplaces[0]!
      : `All (${snapshot.marketplaces.length})`;

  function download(blob: Blob, fileName: string) {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const url = URL.createObjectURL(blob);
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function exportCsv() {
    // A BOM, so Excel reads the product names as UTF-8 rather than mojibake.
    download(
      new Blob(["﻿", toCsv(snapshot.rows)], { type: "text/csv;charset=utf-8" }),
      exportFileName(marketplaceLabel, snapshot.periodStart, snapshot.createdAt, "csv"),
    );
  }

  async function exportXlsx() {
    setBusy(true);
    try {
      // Loaded on demand. The sheet library is several hundred kilobytes and
      // most readers never export, so it stays out of the page bundle.
      const XLSX = await import("xlsx");
      const sheet = XLSX.utils.aoa_to_sheet(buildExport(snapshot.rows));
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, "SOH Report");
      const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
      download(
        new Blob([bytes], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
        exportFileName(marketplaceLabel, snapshot.periodStart, snapshot.createdAt, "xlsx"),
      );
    } finally {
      setBusy(false);
    }
  }

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
            <span className="mx-1 h-4 w-px bg-zinc-200" aria-hidden />
            <button
              type="button"
              onClick={exportCsv}
              disabled={snapshot.rows.length === 0}
              className="h-8 rounded border border-zinc-200 px-2.5 text-[13px] font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
            >
              CSV
            </button>
            <button
              type="button"
              onClick={exportXlsx}
              disabled={snapshot.rows.length === 0 || busy}
              className="inline-flex h-8 items-center gap-1.5 rounded bg-zinc-900 px-3 text-[13px] font-medium text-white hover:bg-zinc-800 disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              {busy ? "Preparing" : "Excel"}
            </button>
            {/* Programmatic download target: the file is generated in the
                browser, so there is no URL until the click happens. */}
            <a ref={anchorRef} className="hidden" aria-hidden>
              Download
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[110rem] flex-1 flex-col px-5 py-4">
        {children}
      </main>
    </div>
  );
}

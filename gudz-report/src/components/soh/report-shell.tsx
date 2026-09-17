"use client";

import { useRef } from "react";
import Link from "next/link";
import { Download } from "lucide-react";

import type { SnapshotRow, SnapshotView } from "@/lib/report/snapshot-model";
import {
  CURRENT_SOH,
  DAMAGE,
  GRN,
  MAPPING_LABELS,
  RETURNED,
  REPORT_SUBTITLE,
  REPORT_TITLE,
  SALES_QUANTITY,
} from "@/lib/report/vocabulary";

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

function csvCell(value: string | number | null): string {
  if (value === null) return "—";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function ReportShell({
  snapshot,
  children,
}: {
  snapshot: SnapshotView;
  children: React.ReactNode;
}) {
  const anchorRef = useRef<HTMLAnchorElement>(null);

  const marketplaceLabel =
    snapshot.marketplaces.length === 1
      ? snapshot.marketplaces[0]!
      : `All (${snapshot.marketplaces.length})`;

  function exportCsv() {
    const header = [
      "Marketplace",
      "Product",
      "SKU",
      "EAN",
      "Month",
      CURRENT_SOH.label,
      GRN.label,
      SALES_QUANTITY.label,
      "Sales Value",
      DAMAGE.label,
      RETURNED.label,
      "Status",
    ];

    const body = snapshot.rows.map((row: SnapshotRow) =>
      [
        row.marketplace,
        row.productName,
        row.sku,
        row.ean,
        row.month,
        row.currentSoh,
        row.grn,
        row.salesQuantity,
        Math.round(row.salesValue),
        row.damage,
        row.returned,
        MAPPING_LABELS[row.mappingStatus],
      ].map(csvCell),
    );

    const csv = [header.map(csvCell), ...body].map((line) => line.join(",")).join("\r\n");
    // A BOM, so Excel reads the product names as UTF-8 rather than mojibake.
    const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const anchor = anchorRef.current;
    if (!anchor) return;
    anchor.href = url;
    anchor.download = `soh-report-${marketplaceLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${
      snapshot.periodStart ?? new Date(snapshot.createdAt).toISOString().slice(0, 10)
    }.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex min-h-full flex-col bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex w-full max-w-[100rem] flex-wrap items-end justify-between gap-4 px-6 py-5">
          <div className="min-w-0">
            <p className="text-[12px] font-medium tracking-wide text-zinc-500 uppercase">
              Healthy Master
            </p>
            <h1 className="mt-0.5 text-[20px] leading-tight font-semibold tracking-tight text-zinc-900">
              {REPORT_TITLE}
            </h1>
            <p className="mt-1 text-[13px] text-zinc-500">{REPORT_SUBTITLE}</p>
          </div>

          <div className="flex flex-wrap items-end gap-6">
            <dl className="flex gap-6">
              <div>
                <dt className="text-[11px] tracking-wide text-zinc-500 uppercase">
                  Marketplace
                </dt>
                <dd className="mt-0.5 text-[14px] font-medium text-zinc-900 capitalize">
                  {marketplaceLabel}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] tracking-wide text-zinc-500 uppercase">Period</dt>
                <dd className="mt-0.5 text-[14px] font-medium text-zinc-900">
                  {snapshot.periodStart && snapshot.periodEnd
                    ? `${formatDay(snapshot.periodStart)} — ${formatDay(snapshot.periodEnd)}`
                    : snapshot.periodsDiffer
                      ? "Multiple periods"
                      : "—"}
                </dd>
                <dd className="mt-0.5 text-[11px] text-zinc-400">
                  Saved{" "}
                  {new Date(snapshot.createdAt).toLocaleDateString("en-GB", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })}
                </dd>
              </div>
            </dl>

            <div className="flex items-center gap-2">
              <Link
                href="/?upload=1"
                className="flex h-8 items-center rounded border border-zinc-200 bg-white px-3 text-[13px] font-medium text-zinc-700 hover:bg-zinc-50"
              >
                New report
              </Link>
              <Link
                href="/"
                className="flex h-8 items-center rounded border border-zinc-200 bg-white px-3 text-[13px] font-medium text-zinc-700 hover:bg-zinc-50"
              >
                All reports
              </Link>
              <button
                type="button"
                onClick={exportCsv}
                disabled={snapshot.rows.length === 0}
                className="inline-flex h-8 items-center gap-1.5 rounded bg-zinc-900 px-3 text-[13px] font-medium text-white hover:bg-zinc-800 disabled:opacity-40"
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                Export
              </button>
              {/* Programmatic download target: the file is generated in the
                  browser, so there is no URL until the click happens. */}
              <a ref={anchorRef} className="hidden" aria-hidden>
                Download
              </a>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[100rem] flex-1 flex-col gap-5 px-6 py-6">
        {children}
      </main>

      <footer className="border-t border-zinc-200 bg-white">
        <div className="mx-auto w-full max-w-[100rem] px-6 py-3 text-[11px] text-zinc-400">
          {CURRENT_SOH.label} from {CURRENT_SOH.source} · {GRN.label} from {GRN.source} ·{" "}
          {SALES_QUANTITY.label} from the {SALES_QUANTITY.source.toLowerCase()} ·{" "}
          {snapshot.sourceFileName}
        </div>
      </footer>
    </div>
  );
}

"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, RefreshCw } from "lucide-react";

import type { SohProductRow } from "@/lib/report/soh-rows";
import { SELL_IN, SELL_OUT, STOCK_ON_HAND } from "@/lib/report/vocabulary";

/**
 * Export, refresh, and switching report.
 *
 * The export is built in the browser from the rows already on the page, so what
 * lands in Excel is exactly what was on screen — including nothing that was not.
 * A server-side export would be a second code path computing the same figures,
 * and the two would eventually disagree about a rounding rule.
 *
 * Refresh re-runs the server render, which re-reads the ERP. Worth having its
 * own button: sell-in and the live stock position both move during the day, and
 * a reader who has had the page open since morning should be able to say so.
 */

function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  // Leading separators and quotes are what turn a product name into a broken
  // column, or in the worst case into a formula.
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function ReportActions({
  rows,
  marketplace,
  period,
  onChangeReport,
}: {
  rows: SohProductRow[];
  marketplace: string;
  period: { from: string; to: string };
  onChangeReport: () => void;
}) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const anchorRef = useRef<HTMLAnchorElement>(null);

  function exportCsv() {
    const header = [
      "Product",
      "SKU",
      "EAN",
      "Marketplace item ID",
      STOCK_ON_HAND.label,
      "Stock on hand (gross)",
      "Stock blocked",
      `${SELL_IN.label} qty`,
      `${SELL_OUT.label} qty`,
      "Quantity variance",
      `${SELL_IN.label} revenue`,
      `${SELL_OUT.label} revenue`,
      "Revenue variance",
      "Status",
      "Mapping",
    ];

    const body = rows.map((row) =>
      [
        row.productName,
        row.sku,
        row.ean,
        row.marketplaceItemId,
        row.stockAvailable,
        row.stockOnHand,
        row.stockBlocked,
        row.sellIn,
        row.sellOut,
        row.quantityVariance,
        Math.round(row.sellInRevenue),
        Math.round(row.sellOutRevenue),
        Math.round(row.revenueVariance),
        row.status,
        row.mapping,
      ].map(csvCell),
    );

    const csv = [header.map(csvCell), ...body].map((line) => line.join(",")).join("\r\n");
    // A BOM, so Excel opens the product names as UTF-8 rather than mojibake.
    const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const anchor = anchorRef.current;
    if (!anchor) return;
    anchor.href = url;
    anchor.download = `soh-report-${marketplace}-${period.from}-to-${period.to}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onChangeReport}
        className="h-8 rounded border border-zinc-200 bg-white px-3 text-[13px] font-medium text-zinc-700 hover:bg-zinc-50"
      >
        Change report
      </button>

      <button
        type="button"
        onClick={() => {
          setRefreshing(true);
          router.refresh();
          // The refresh resolves on the server; this only stops the spinner
          // looking stuck if the render is quick.
          window.setTimeout(() => setRefreshing(false), 1200);
        }}
        className="inline-flex h-8 items-center gap-1.5 rounded border border-zinc-200 bg-white px-3 text-[13px] font-medium text-zinc-700 hover:bg-zinc-50"
      >
        <RefreshCw
          className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
          aria-hidden
        />
        Refresh
      </button>

      <button
        type="button"
        onClick={exportCsv}
        disabled={rows.length === 0}
        className="inline-flex h-8 items-center gap-1.5 rounded bg-zinc-900 px-3 text-[13px] font-medium text-white hover:bg-zinc-800 disabled:opacity-40"
      >
        <Download className="h-3.5 w-3.5" aria-hidden />
        Export
      </button>

      {/* Programmatic download target: the export is generated in the browser,
          so there is no URL to put on a real link until the click happens. */}
      <a ref={anchorRef} className="hidden" aria-hidden>
        Download
      </a>
    </div>
  );
}

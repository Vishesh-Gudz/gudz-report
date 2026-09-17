"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download } from "lucide-react";

import { toCsv } from "@/lib/report/export";
import type { SnapshotRow, SnapshotView } from "@/lib/report/snapshot-model";
import { buildWorkbook, workbookFileName } from "@/lib/report/workbook";

/**
 * Export, with the one choice that actually matters made explicit.
 *
 * "Current view" and "Full report" are genuinely different files once a filter
 * is on, and a single Export button has to silently pick one. Whichever it
 * picked would be wrong half the time and wrong invisibly — somebody sends a
 * filtered file believing it is the whole report. Naming both costs one
 * dropdown.
 *
 * Everything is generated in the browser from the saved snapshot. The original
 * workbook is deleted after processing, so there is nothing to re-read and no
 * second code path to disagree with the table.
 */

type Status = "idle" | "working" | "done";

export function ExportMenu({
  snapshot,
  visibleRows,
}: {
  snapshot: SnapshotView;
  /** The rows currently on screen, after filters and search. */
  visibleRows: SnapshotRow[];
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [label, setLabel] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLAnchorElement>(null);

  // Close on an outside click or Escape. A menu that only closes by choosing
  // something traps anyone who opened it to look.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function download(blob: Blob, fileName: string) {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const url = URL.createObjectURL(blob);
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function finish(message: string) {
    setStatus("done");
    setLabel(message);
    window.setTimeout(() => {
      setStatus("idle");
      setLabel("");
    }, 2200);
  }

  async function exportExcel(scope: "current" | "full") {
    setOpen(false);
    setStatus("working");
    setLabel("Preparing Excel…");
    try {
      const rows = scope === "current" ? visibleRows : snapshot.rows;
      const bytes = await buildWorkbook(snapshot, rows, scope);
      download(
        new Blob([bytes], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
        workbookFileName(snapshot, "xlsx", scope),
      );
      finish("Downloaded");
    } catch {
      // The technical cause is in the console; the reader gets something they
      // can act on.
      finish("Export failed");
    }
  }

  function exportCsv() {
    setOpen(false);
    // A BOM, so Excel reads the product names as UTF-8 rather than mojibake.
    download(
      new Blob(["﻿", toCsv(visibleRows)], { type: "text/csv;charset=utf-8" }),
      workbookFileName(snapshot, "csv", "current"),
    );
    finish("Downloaded");
  }

  const filtered = visibleRows.length !== snapshot.rows.length;
  const busy = status === "working";

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={snapshot.rows.length === 0 || busy}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-7 items-center gap-1.5 rounded bg-zinc-900 px-2.5 text-[12px] font-medium text-white hover:bg-zinc-800 disabled:opacity-40"
      >
        <Download className="h-3.5 w-3.5" aria-hidden />
        {status === "idle" ? "Export" : label}
        {status === "idle" ? <ChevronDown className="h-3 w-3" aria-hidden /> : null}
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1 w-56 border border-zinc-200 bg-white py-1 shadow-sm"
        >
          <p className="px-3 py-1 text-[10.5px] tracking-wide text-zinc-400 uppercase">
            Excel
          </p>
          <button
            type="button"
            role="menuitem"
            onClick={() => exportExcel("current")}
            className="flex w-full items-baseline justify-between gap-2 px-3 py-1.5 text-left text-[13px] text-zinc-700 hover:bg-zinc-50"
          >
            Current view
            <span className="text-[11px] text-zinc-400">
              {visibleRows.length.toLocaleString("en-IN")} rows
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => exportExcel("full")}
            className="flex w-full items-baseline justify-between gap-2 px-3 py-1.5 text-left text-[13px] text-zinc-700 hover:bg-zinc-50"
          >
            Full report
            <span className="text-[11px] text-zinc-400">
              {snapshot.rows.length.toLocaleString("en-IN")} rows
            </span>
          </button>

          <p className="mt-1 border-t border-zinc-100 px-3 pt-2 pb-1 text-[10.5px] tracking-wide text-zinc-400 uppercase">
            CSV
          </p>
          <button
            type="button"
            role="menuitem"
            onClick={exportCsv}
            className="flex w-full items-baseline justify-between gap-2 px-3 py-1.5 text-left text-[13px] text-zinc-700 hover:bg-zinc-50"
          >
            Current view
            <span className="text-[11px] text-zinc-400">
              {visibleRows.length.toLocaleString("en-IN")} rows
            </span>
          </button>

          {filtered ? (
            <p className="mt-1 border-t border-zinc-100 px-3 pt-2 pb-1 text-[11px] leading-relaxed text-zinc-400">
              A filter is on, so the two Excel files differ.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Programmatic download target: the file is generated in the browser, so
          there is no URL until the click happens. */}
      <a ref={anchorRef} className="hidden" aria-hidden>
        Download
      </a>
    </div>
  );
}

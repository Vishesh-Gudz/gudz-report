"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, FileSpreadsheet, Loader2, Upload, XCircle } from "lucide-react";

import { getBrowserConvexClient } from "@/lib/convex/browser";
import type { CompactSheet } from "@/lib/report/compact";
import type { WorkerResponse } from "@/lib/excel/import-worker";

/**
 * Uploading a marketplace workbook.
 *
 * The workbook never leaves the browser. A Web Worker parses the sheets that
 * were picked and reduces them to product-months — 203,000 rows become a few
 * hundred records — and only that reduction is sent to Convex, which does the
 * mapping, the ERP reads and the write.
 *
 * It is built this way because the file cannot go anywhere else. A Vercel
 * function refuses a request body over 4.5 MB and a real export is ten; a Convex
 * Node action runs out of its 512 MB ceiling parsing it. The browser is the one
 * machine in the chain with no limit that this file exceeds — and the worker is
 * what keeps a minute of parsing from freezing the tab.
 *
 * Progress is per sheet and real. No percentages: the work is genuinely uneven —
 * Blinkit is 8,451 rows and Swiggy is 103,397 — and a bar moving on a timer
 * would be a lie about how far along it is.
 *
 * `Master` is never offered. It is the product mapping table, loaded once by the
 * parser and used for every sheet, and it is not sales data.
 *
 * A sheet that fails does not stop the others. It is shown with its reason and
 * the remaining marketplaces carry on, because five good sheets are worth more
 * than a clean failure.
 */

interface SheetOption {
  marketplace: string;
  sheet: string;
  rowCount: number;
  caveats: string[];
}

interface InspectResponse {
  marketplaces: SheetOption[];
  unrecognisedSheets: string[];
  sheetNames: string[];
  master: { rows: number; withEan: number; active: number } | null;
}

/** Spawns the parser worker. Kept here so both callers build it the same way. */
function createImportWorker(): Worker {
  return new Worker(new URL("../../lib/excel/import-worker.ts", import.meta.url), {
    type: "module",
  });
}

/**
 * Runs one worker job to completion.
 *
 * The worker is terminated either way, which is also what discards the workbook:
 * the bytes live in that thread and nowhere else, so ending it is the cleanup.
 */
function runWorker(
  request: { type: "inspect"; file: ArrayBuffer } | {
    type: "process";
    file: ArrayBuffer;
    sheets: string[];
    year: number | null;
  },
  onProgress: (message: WorkerResponse) => void,
): Promise<WorkerResponse> {
  return new Promise((resolve, reject) => {
    const worker = createImportWorker();

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (
        message.type === "inspected" ||
        message.type === "compacted" ||
        message.type === "failed"
      ) {
        worker.terminate();
        resolve(message);
        return;
      }
      onProgress(message);
    };

    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "The workbook could not be read."));
    };

    worker.postMessage(request, [request.file]);
  });
}

type SheetState =
  | { stage: "pending" }
  | { stage: "parsing" }
  | { stage: "parsed"; rows: number; period: { from: string; to: string } | null }
  | { stage: "saving"; rows: number }
  | {
      stage: "done";
      rows: number;
      period: { from: string; to: string } | null;
      erpConfigured: boolean;
    }
  | { stage: "failed"; error: string };

/** Turns a server or network failure into something a non-engineer can act on. */
function friendlyError(raw: string): { message: string; hint?: string } {
  const text = raw.toLowerCase();

  if (text.includes("could not read the workbook") || text.includes("no sheets")) {
    return {
      message: "This file could not be opened as a spreadsheet.",
      hint: "Check that it is an .xlsx export and not a PDF, CSV or a damaged download.",
    };
  }
  if (text.includes("empty")) {
    return { message: "That file is empty.", hint: "Re-download it and try again." };
  }
  if (text.includes("limit is 25 mb")) {
    return {
      message: "That file is too large to process.",
      hint: "Export a shorter date range; the limit is 25 MB.",
    };
  }
  if (text.includes("fetch") || text.includes("network") || text.includes("failed to")) {
    return {
      message: "The workbook could not be uploaded.",
      hint: "Check your connection and try again. Nothing was saved.",
    };
  }
  return { message: raw };
}

export function UploadFlow() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [overview, setOverview] = useState<InspectResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reading, setReading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [sheetStates, setSheetStates] = useState<Record<string, SheetState>>({});
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [dragging, setDragging] = useState(false);

  function resetAll() {
    setOverview(null);
    setSelected(new Set());
    setSheetStates({});
    setError(null);
    setProcessing(false);
    setReading(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function inspect(picked: File) {
    setFile(picked);
    setOverview(null);
    setSheetStates({});
    setError(null);
    setReading(true);

    try {
      // Read in the browser, not uploaded. A ten-megabyte workbook exceeds what
      // a serverless function will accept as a request body, and inspecting it
      // here means the file never needs to travel at all.
      const buffer = await picked.arrayBuffer();
      const message = await runWorker({ type: "inspect", file: buffer }, () => {});

      if (message.type === "failed") {
        setError(friendlyError(message.error));
        return;
      }
      if (message.type !== "inspected") return;

      const result: InspectResponse = {
        marketplaces: message.marketplaces,
        unrecognisedSheets: message.unrecognisedSheets,
        sheetNames: message.sheetNames,
        master: message.master,
      };

      if (result.marketplaces.length === 0) {
        setError({
          message: "No marketplace report was found in this workbook.",
          hint: `Sheets found: ${result.sheetNames.join(", ")}. This report reads Blinkit, Bigbasket, Zepto, Swiggy, FirstClub and Flipkart exports.`,
        });
        return;
      }

      setOverview(result);
      // Everything eligible, pre-selected: processing the whole workbook is the
      // common case, and unticking one is easier than ticking six.
      setSelected(new Set(result.marketplaces.map((entry) => entry.sheet)));
    } catch (cause) {
      setError(friendlyError(cause instanceof Error ? cause.message : "network"));
    } finally {
      setReading(false);
    }
  }

  async function process() {
    if (!file || selected.size === 0) return;

    const sheets = (overview?.marketplaces ?? [])
      .filter((entry) => selected.has(entry.sheet))
      .map((entry) => entry.sheet);

    setProcessing(true);
    setError(null);
    setSheetStates(
      Object.fromEntries(sheets.map((sheet) => [sheet, { stage: "pending" } as SheetState])),
    );

    try {
      // The workbook is parsed and reduced here, in a worker. Only the
      // reduction crosses the network — see `lib/report/compact.ts`.
      const buffer = await file.arrayBuffer();
      const message = await runWorker(
        { type: "process", file: buffer, sheets, year: null },
        (progress) => {
          if (progress.type === "sheet-started") {
            setSheetStates((current) => ({
              ...current,
              [progress.sheet]: { stage: "parsing" },
            }));
          } else if (progress.type === "sheet-parsed") {
            setSheetStates((current) => ({
              ...current,
              [progress.sheet]: { stage: "parsed", rows: progress.rows, period: null },
            }));
          } else if (progress.type === "sheet-completed") {
            setSheetStates((current) => ({
              ...current,
              [progress.sheet]: {
                stage: "done",
                rows: progress.rows,
                period: progress.period,
                erpConfigured: false,
              },
            }));
          } else if (progress.type === "sheet-failed") {
            setSheetStates((current) => ({
              ...current,
              [progress.sheet]: { stage: "failed", error: progress.error },
            }));
          }
        },
      );

      if (message.type === "failed") {
        setError(friendlyError(message.error));
        setProcessing(false);
        return;
      }
      if (message.type !== "compacted") return;

      const compacted: CompactSheet[] = message.sheets;
      if (compacted.length === 0) {
        setError({
          message: "No sheet in this workbook could be read.",
          hint: "Check the file, or try a different export.",
        });
        setProcessing(false);
        return;
      }

      const convex = getBrowserConvexClient();
      if (!convex) {
        setError({
          message: "The report could not be saved.",
          hint: "This deployment has no Convex connection configured.",
        });
        setProcessing(false);
        return;
      }

      // Every sheet moves to "saving" together: from here the work is one
      // Convex job covering all of them, not a per-sheet step.
      setSheetStates((current) =>
        Object.fromEntries(
          Object.entries(current).map(([sheet, state]) => [
            sheet,
            state.stage === "done"
              ? { stage: "saving" as const, rows: state.rows }
              : state,
          ]),
        ),
      );

      const snapshotId = (await convex.mutation("imports:start" as never, {
        sourceFileName: file.name,
        sheets: compacted,
      } as never)) as string;

      // The mutation returns as soon as the job is scheduled. What follows is
      // the real status of that job, read from the snapshot itself — never a
      // timer pretending to know how far along the ERP reads are.
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const snapshot = (await convex.query("snapshots:get" as never, {
          snapshotId,
        } as never)) as { status: string; errorMessage: string | null } | null;

        if (!snapshot) continue;
        if (snapshot.status === "completed") {
          router.push(`/?report=${snapshotId}`);
          router.refresh();
          return;
        }
        if (snapshot.status === "failed") {
          setError(
            friendlyError(snapshot.errorMessage ?? "The report could not be built."),
          );
          setProcessing(false);
          return;
        }
      }
    } catch (cause) {
      setError(friendlyError(cause instanceof Error ? cause.message : "network"));
      setProcessing(false);
    }
  }

  function toggle(sheet: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(sheet)) next.delete(sheet);
      else next.add(sheet);
      return next;
    });
  }

  const options = overview?.marketplaces ?? [];
  const allSelected = options.length > 0 && selected.size === options.length;
  const someSelected = selected.size > 0 && !allSelected;

  const buttonLabel =
    selected.size === 1
      ? `Process ${options.find((entry) => selected.has(entry.sheet))?.marketplace ?? "marketplace"}`
      : `Process ${selected.size} marketplaces`;

  if (!file || (!overview && !reading && !error)) {
    return (
      <>
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const dropped = event.dataTransfer.files?.[0];
            if (dropped) void inspect(dropped);
          }}
          className={`flex flex-col items-center gap-2.5 border border-dashed px-6 py-10 text-center transition-colors ${
            dragging ? "border-zinc-400 bg-zinc-50" : "border-zinc-300 bg-white"
          }`}
        >
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded bg-zinc-900 px-4 py-2 text-[13px] font-medium text-white hover:bg-zinc-800"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden />
            Upload XLSX
          </button>
          <p className="text-[12px] text-zinc-400">XLSX only, up to 25 MB</p>
        </div>
        <FileInput inputRef={inputRef} onPick={inspect} />
      </>
    );
  }

  return (
    <>
      <div className="border border-zinc-200 bg-white">
        <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3">
          <FileSpreadsheet className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden />
          <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-zinc-900">
            {file?.name}
          </p>
          {!processing ? (
            <button
              type="button"
              onClick={() => {
                setFile(null);
                resetAll();
              }}
              className="text-[13px] text-zinc-500 hover:text-zinc-900"
            >
              Cancel
            </button>
          ) : null}
        </div>

        {reading ? (
          <p className="flex items-center gap-2 px-4 py-3 text-[13px] text-zinc-600">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Reading workbook
          </p>
        ) : null}

        {overview && !processing ? (
          <div className="px-4 py-4">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[13px] font-medium text-zinc-900">Select reports</p>
              <p className="text-[12px] text-zinc-400">
                {options.length} found
              </p>
            </div>

            <label className="mt-3 flex cursor-pointer items-center gap-2.5 border border-zinc-200 bg-zinc-50 px-3 py-2.5">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(node) => {
                  if (node) node.indeterminate = someSelected;
                }}
                onChange={() =>
                  setSelected(
                    allSelected ? new Set() : new Set(options.map((entry) => entry.sheet)),
                  )
                }
                className="h-3.5 w-3.5 accent-zinc-900"
              />
              <span className="text-[13px] font-medium text-zinc-900">
                All marketplaces
              </span>
            </label>

            <ul className="mt-1 border border-t-0 border-zinc-200">
              {options.map((entry) => (
                <li key={entry.sheet} className="border-t border-zinc-100 first:border-t-0">
                  <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 hover:bg-zinc-50">
                    <input
                      type="checkbox"
                      checked={selected.has(entry.sheet)}
                      onChange={() => toggle(entry.sheet)}
                      className="h-3.5 w-3.5 accent-zinc-900"
                    />
                    <span className="flex-1 text-[13px] text-zinc-900 capitalize">
                      {entry.marketplace}
                    </span>
                    <span className="text-[12px] text-zinc-500">
                      {entry.rowCount.toLocaleString("en-IN")} rows
                    </span>
                  </label>
                </li>
              ))}
            </ul>

            {overview.master ? (
              <p className="mt-2 text-[12px] text-zinc-500">
                The <strong>Master</strong> sheet ({overview.master.rows} products) is used
                as the product mapping reference for every marketplace. It is not sales
                data and is never imported as such.
              </p>
            ) : (
              <p className="mt-2 text-[12px] text-amber-700">
                No <strong>Master</strong> sheet in this workbook. Marketplaces that rely on
                it to reach an EAN will not match ERP products.
              </p>
            )}

            <button
              type="button"
              onClick={process}
              disabled={selected.size === 0}
              className="mt-3 w-full rounded bg-zinc-900 px-4 py-2.5 text-[13px] font-medium text-white hover:bg-zinc-800 disabled:opacity-40"
            >
              {selected.size === 0 ? "Select at least one marketplace" : buttonLabel}
            </button>
          </div>
        ) : null}

        {processing ? (
          <div className="px-4 py-4">
            <p className="flex items-center gap-2 text-[13px] font-medium text-zinc-900">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              Processing workbook
            </p>

            <ul className="mt-3 flex flex-col gap-2">
              {Object.entries(sheetStates).map(([sheet, state]) => (
                <li key={sheet} className="flex items-start gap-2.5 text-[13px]">
                  {state.stage === "done" ? (
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
                  ) : state.stage === "failed" ? (
                    <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" aria-hidden />
                  ) : state.stage === "pending" ? (
                    <span
                      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-200"
                      aria-hidden
                    />
                  ) : (
                    <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-zinc-500" aria-hidden />
                  )}

                  <span className="min-w-0 flex-1">
                    <span
                      className={
                        state.stage === "pending" ? "text-zinc-400" : "text-zinc-900"
                      }
                    >
                      {sheet}
                    </span>
                    <span className="block text-[12px] text-zinc-500">
                      {state.stage === "pending"
                        ? "Waiting"
                        : state.stage === "parsing"
                          ? "Parsing"
                          : state.stage === "parsed"
                            ? `${state.rows.toLocaleString("en-IN")} rows`
                            : state.stage === "saving"
                              ? "Saving"
                              : state.stage === "failed"
                                ? state.error
                                : `${state.rows.toLocaleString("en-IN")} rows${
                                    state.period
                                      ? ` · ${state.period.from} – ${state.period.to}`
                                      : ""
                                  }`}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {error ? (
          <div className="flex gap-2.5 border-t border-zinc-200 bg-red-50 px-4 py-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden />
            <div>
              <p className="text-[13px] font-medium text-red-900">{error.message}</p>
              {error.hint ? (
                <p className="mt-0.5 text-[12px] text-red-800">{error.hint}</p>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setFile(null);
                  resetAll();
                }}
                className="mt-2 rounded border border-red-200 bg-white px-2.5 py-1 text-[12px] text-red-900 hover:bg-red-50"
              >
                Try another file
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <FileInput inputRef={inputRef} onPick={inspect} />
    </>
  );
}

function FileInput({
  inputRef,
  onPick,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onPick: (file: File) => void;
}) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept=".xlsx,.xls"
      className="hidden"
      onChange={(event) => {
        const picked = event.target.files?.[0];
        if (picked) onPick(picked);
      }}
    />
  );
}

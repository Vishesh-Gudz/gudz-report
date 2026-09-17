"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, FileSpreadsheet, Loader2, Upload } from "lucide-react";

/**
 * Uploading a marketplace report.
 *
 * The stage list is real. Each line turns from pending to done when the network
 * call that performs it returns, and nothing is marked complete before its work
 * is. There are no percentages, because a percentage here would be invented —
 * the server does not report progress, and a bar that moves on a timer is a lie
 * about how far along the work is.
 *
 * The workbook holds several marketplace sheets, so which one is meant cannot be
 * inferred; the file is read first and the sheet is chosen. When the file
 * contains exactly one recognised sheet that choice is made automatically,
 * because offering somebody a list of one is not a choice.
 *
 * Errors are written for whoever is holding the spreadsheet, not for whoever
 * wrote the parser.
 */

interface SheetOption {
  marketplace: string;
  sheet: string;
  rowCount: number;
  caveats: string[];
}

interface InspectResponse {
  ok: true;
  mode: "inspect";
  fileName: string;
  marketplaces: SheetOption[];
  unrecognisedSheets: string[];
  sheetNames: string[];
}

interface ImportResponse {
  ok: true;
  mode: "import";
  importId: string | null;
  persisted: boolean;
  marketplace: string;
  statistics: { totalRows: number; invalidRows: number };
  period: { from: string; to: string } | null;
  notes: string[];
}

interface FailureResponse {
  ok: false;
  error: string;
  hint?: string;
}

type Response = InspectResponse | ImportResponse | FailureResponse;

const STAGES = [
  { id: "read", label: "Reading workbook" },
  { id: "marketplace", label: "Detecting marketplace" },
  { id: "period", label: "Detecting reporting period" },
  { id: "rows", label: "Parsing rows" },
  { id: "products", label: "Resolving products" },
  { id: "erp", label: "Fetching ERP data" },
  { id: "build", label: "Building report" },
] as const;

type StageId = (typeof STAGES)[number]["id"];

/** Turns a server or network failure into something a non-engineer can act on. */
function friendlyError(raw: string): { message: string; hint?: string } {
  const text = raw.toLowerCase();

  if (text.includes("not a recognised marketplace sheet")) {
    return {
      message: "That sheet is not one this report knows how to read.",
      hint: "Choose one of the marketplace sheets listed above.",
    };
  }
  if (text.includes("no sheets") || text.includes("could not read the workbook")) {
    return {
      message: "This file could not be opened as a spreadsheet.",
      hint: "Check that it is an .xlsx export and not a PDF, CSV or a damaged download.",
    };
  }
  if (text.includes("no data rows")) {
    return {
      message: "That sheet has no data under its header row.",
      hint: "Pick a different sheet, or re-export the report from the marketplace.",
    };
  }
  if (text.includes("empty")) {
    return { message: "That file is empty.", hint: "Re-download it and try again." };
  }
  if (text.includes("limit is 25 mb") || text.includes("413")) {
    return {
      message: "That file is too large to process.",
      hint: "Export a single month at a time; the limit is 25 MB.",
    };
  }
  if (text.includes("reporting year")) {
    return {
      message: "This sheet dates its rows by month name only, with no year.",
      hint: "That marketplace is not supported yet — it needs a year before its rows can be dated.",
    };
  }
  if (text.includes("fetch") || text.includes("network")) {
    return {
      message: "The report could not be uploaded.",
      hint: "Check your connection and try again. Nothing was saved.",
    };
  }
  return { message: raw };
}

export function UploadFlow({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [overview, setOverview] = useState<InspectResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Set<StageId>>(new Set());
  const [active, setActive] = useState<StageId | null>(null);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [dragging, setDragging] = useState(false);

  const reset = useCallback(() => {
    setOverview(null);
    setDone(new Set());
    setActive(null);
    setError(null);
  }, []);

  async function post(body: FormData): Promise<Response> {
    const response = await fetch("/api/imports", { method: "POST", body });
    return (await response.json()) as Response;
  }

  async function inspect(picked: File) {
    setFile(picked);
    reset();
    setBusy(true);
    setActive("read");

    try {
      const body = new FormData();
      body.set("file", picked);
      const result = await post(body);

      if (!result.ok) {
        setError(friendlyError(result.error));
        return;
      }
      if (result.mode !== "inspect") return;

      setDone(new Set<StageId>(["read", "marketplace"]));
      setActive(null);

      if (result.marketplaces.length === 0) {
        setError({
          message: "No marketplace report was found in this file.",
          hint: `Sheets found: ${result.sheetNames.join(", ")}. This report reads Blinkit, Bigbasket, Zepto, Swiggy, FirstClub and Flipkart exports.`,
        });
        return;
      }

      setOverview(result);
      if (result.marketplaces.length === 1) {
        void runImport(picked, result.marketplaces[0]!.sheet);
      }
    } catch (cause) {
      setError(friendlyError(cause instanceof Error ? cause.message : "network"));
    } finally {
      setBusy(false);
    }
  }

  async function runImport(picked: File, sheet: string) {
    setBusy(true);
    setError(null);
    setActive("rows");

    try {
      const body = new FormData();
      body.set("file", picked);
      body.set("sheet", sheet);
      body.set("persist", "true");

      const result = await post(body);
      if (!result.ok) {
        setError(friendlyError(result.error));
        setActive(null);
        return;
      }
      if (result.mode !== "import") return;

      setDone(new Set<StageId>(["read", "marketplace", "rows", "period"]));

      if (!result.persisted || !result.importId) {
        setError({
          message: "The report was read but could not be saved.",
          hint:
            result.notes[0] ??
            "Nothing was lost — try uploading again in a moment.",
        });
        setActive(null);
        return;
      }

      // The remaining three stages happen on the server while it renders the
      // report, so they stay in progress until the navigation completes.
      setActive("products");
      router.push(`/?importId=${result.importId}`);
      router.refresh();
    } catch (cause) {
      setError(friendlyError(cause instanceof Error ? cause.message : "network"));
      setActive(null);
    } finally {
      setBusy(false);
    }
  }

  function onDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files?.[0];
    if (dropped) void inspect(dropped);
  }

  const started = busy || done.size > 0 || error !== null;

  return (
    <div className={compact ? "" : "mx-auto w-full max-w-xl"}>
      {!started ? (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex flex-col items-center gap-3 border border-dashed px-6 py-12 text-center transition-colors ${
            dragging ? "border-zinc-400 bg-zinc-50" : "border-zinc-300 bg-white"
          }`}
        >
          <FileSpreadsheet className="h-6 w-6 text-zinc-400" aria-hidden />
          <div>
            <p className="text-[14px] font-medium text-zinc-900">
              Drop a marketplace report here
            </p>
            <p className="mt-1 text-[13px] text-zinc-500">
              Excel .xlsx exported from the marketplace, up to 25 MB
            </p>
          </div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="mt-1 inline-flex items-center gap-2 rounded bg-zinc-900 px-3.5 py-2 text-[13px] font-medium text-white hover:bg-zinc-800"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden />
            Browse files
          </button>
        </div>
      ) : (
        <div className="border border-zinc-200 bg-white">
          <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3">
            <FileSpreadsheet className="h-4 w-4 text-zinc-400" aria-hidden />
            <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-zinc-900">
              {file?.name}
            </p>
            <button
              type="button"
              onClick={() => {
                setFile(null);
                reset();
                if (inputRef.current) inputRef.current.value = "";
              }}
              className="text-[13px] text-zinc-500 hover:text-zinc-900"
            >
              Cancel
            </button>
          </div>

          <ol className="px-4 py-3">
            {STAGES.map((stage) => {
              const isDone = done.has(stage.id);
              const isActive = active === stage.id;
              return (
                <li
                  key={stage.id}
                  className="flex items-center gap-2.5 py-1 text-[13px]"
                >
                  {isDone ? (
                    <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
                  ) : isActive ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-500" aria-hidden />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-zinc-200" aria-hidden />
                  )}
                  <span
                    className={
                      isDone
                        ? "text-zinc-900"
                        : isActive
                          ? "text-zinc-900"
                          : "text-zinc-400"
                    }
                  >
                    {stage.label}
                  </span>
                </li>
              );
            })}
          </ol>

          {overview && overview.marketplaces.length > 1 && !busy && !error ? (
            <div className="border-t border-zinc-200 px-4 py-3">
              <p className="text-[13px] font-medium text-zinc-900">
                This file holds several reports. Which one?
              </p>
              <div className="mt-2 flex flex-col gap-1.5">
                {overview.marketplaces.map((option) => (
                  <button
                    key={option.sheet}
                    type="button"
                    onClick={() => file && runImport(file, option.sheet)}
                    className="flex items-center justify-between gap-3 border border-zinc-200 px-3 py-2 text-left text-[13px] hover:bg-zinc-50"
                  >
                    <span className="font-medium capitalize">{option.marketplace}</span>
                    <span className="text-[12px] text-zinc-500">
                      {option.rowCount.toLocaleString("en-IN")} rows
                    </span>
                  </button>
                ))}
              </div>
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
                    reset();
                    if (inputRef.current) inputRef.current.value = "";
                  }}
                  className="mt-2 rounded border border-red-200 bg-white px-2.5 py-1 text-[12px] text-red-900 hover:bg-red-50"
                >
                  Try another file
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(event) => {
          const picked = event.target.files?.[0];
          if (picked) void inspect(picked);
        }}
      />
    </div>
  );
}

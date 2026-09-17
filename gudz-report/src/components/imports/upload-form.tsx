"use client";

import { useState } from "react";
import { Upload } from "lucide-react";

/**
 * Workbook upload and parse preview.
 *
 * The file is posted to a server route that owns the parsing, so nothing about
 * interpreting a marketplace export lives in the browser.
 *
 * The result is shown before anything is trusted: detected sheet, headers, the
 * suggested column mapping, the reporting period the dates imply, and every row
 * that failed with its spreadsheet row number. A workbook whose columns cannot
 * be mapped is a conversation, not a silent zero-row import.
 */

interface ParseError {
  sourceRow: number;
  field: string;
  message: string;
}

interface UploadResult {
  ok: boolean;
  error?: string;
  hint?: string;
  problems?: { field: string; message: string }[];
  importId?: string | null;
  persisted?: boolean;
  fileName?: string;
  sheetNames?: string[];
  selectedSheet?: string;
  headers?: string[];
  suggestedMapping?: Record<string, string | undefined>;
  statistics?: {
    totalRows: number;
    validRows: number;
    invalidRows: number;
    minDate: string | null;
    maxDate: string | null;
  };
  period?: { from: string; to: string } | null;
  errors?: ParseError[];
  errorCount?: number;
  notes?: string[];
}

const num = new Intl.NumberFormat("en-IN");

export function UploadForm() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setResult(null);

    try {
      const response = await fetch("/api/imports", { method: "POST", body: form });
      setResult((await response.json()) as UploadResult);
    } catch (cause) {
      setResult({
        ok: false,
        error: cause instanceof Error ? cause.message : "Upload failed",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={onSubmit}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-500">Marketplace workbook</span>
          <input
            type="file"
            name="file"
            accept=".xlsx,.xls,.csv"
            required
            className="text-sm file:mr-3 file:rounded file:border-0 file:bg-zinc-900 file:px-3 file:py-1.5 file:text-sm file:text-white dark:file:bg-zinc-100 dark:file:text-zinc-900"
          />
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="persist" value="true" defaultChecked />
          <span>Save to Convex</span>
        </label>

        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-2 rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          <Upload className="h-4 w-4" aria-hidden />
          {busy ? "Parsing…" : "Upload and parse"}
        </button>
      </form>

      {result && !result.ok ? (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm dark:border-red-900 dark:bg-red-950">
          <p className="font-medium">{result.error}</p>
          {result.hint ? <p className="mt-1">{result.hint}</p> : null}
          {result.problems?.length ? (
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {result.problems.map((problem) => (
                <li key={problem.field}>
                  <code>{problem.field}</code> — {problem.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {result?.ok && result.statistics ? (
        <div className="flex flex-col gap-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-medium">{result.fileName}</h2>
            <p className="text-sm text-zinc-500">
              Sheet <code>{result.selectedSheet}</code>
              {result.sheetNames && result.sheetNames.length > 1
                ? ` of ${result.sheetNames.length}`
                : ""}
              {result.persisted ? " · saved" : " · not saved"}
            </p>
          </div>

          {result.notes?.map((note) => (
            <p
              key={note}
              className="rounded border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950"
            >
              {note}
            </p>
          ))}

          <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
            {[
              ["Rows", num.format(result.statistics.totalRows)],
              ["Valid", num.format(result.statistics.validRows)],
              ["Invalid", num.format(result.statistics.invalidRows)],
              ["Min date", result.statistics.minDate ?? "—"],
              ["Max date", result.statistics.maxDate ?? "—"],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <dt className="text-zinc-500">{label}</dt>
                <dd className="mt-1 font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>

          {result.period ? (
            <p className="text-sm">
              Detected reporting period{" "}
              <strong>
                {result.period.from} → {result.period.to}
              </strong>
              . The dashboard will request ERP sales-order lines for exactly this
              range.{" "}
              <a
                href={`/dashboard?from=${result.period.from}&to=${result.period.to}${
                  result.importId ? `&importId=${result.importId}` : ""
                }`}
                className="underline underline-offset-4"
              >
                Open the report
              </a>
            </p>
          ) : (
            <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950">
              No usable dates were found, so no reporting period could be
              determined. Check that the date column is mapped and holds real
              date cells — ambiguous text such as <code>03/04/2026</code> is
              refused rather than guessed.
            </p>
          )}

          <details>
            <summary className="cursor-pointer text-sm font-medium">
              Detected columns and suggested mapping
            </summary>
            <div className="mt-2 grid gap-3 text-sm md:grid-cols-2">
              <div>
                <p className="text-zinc-500">Headers</p>
                <p className="mt-1 font-mono text-xs">
                  {result.headers?.join(" · ") ?? "—"}
                </p>
              </div>
              <div>
                <p className="text-zinc-500">Mapping</p>
                <ul className="mt-1 font-mono text-xs">
                  {Object.entries(result.suggestedMapping ?? {}).map(([field, header]) => (
                    <li key={field}>
                      {field} → {header ?? "(unmapped)"}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </details>

          {result.errors?.length ? (
            <details open>
              <summary className="cursor-pointer text-sm font-medium">
                {num.format(result.errorCount ?? result.errors.length)} row problem
                {(result.errorCount ?? result.errors.length) === 1 ? "" : "s"}
              </summary>
              <div className="mt-2 overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 text-left dark:bg-zinc-900">
                    <tr>
                      <th className="px-3 py-2 font-medium">Row</th>
                      <th className="px-3 py-2 font-medium">Field</th>
                      <th className="px-3 py-2 font-medium">Problem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.errors.map((error) => (
                      <tr
                        key={`${error.sourceRow}-${error.field}`}
                        className="border-t border-zinc-200 dark:border-zinc-800"
                      >
                        {/* The spreadsheet row number, so the file can be opened
                            at the line that failed. */}
                        <td className="px-3 py-2 tabular-nums">{error.sourceRow}</td>
                        <td className="px-3 py-2 font-mono text-xs">{error.field}</td>
                        <td className="px-3 py-2">{error.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

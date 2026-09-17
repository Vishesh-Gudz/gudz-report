"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";

/**
 * Workbook upload, in two deliberate steps.
 *
 * **Inspect, then import one sheet.** The Healthy Master workbook holds a
 * `Master` product table and six marketplace sheets with nothing in common, so
 * "the sheet" is not a thing a parser can infer. The first version tried, chose
 * `Master`, and reported that it had no date column — a correct complaint about
 * a sheet nobody meant to import. Now the file is described first and a human
 * picks.
 *
 * Parsing itself lives on the server; this screen only shows what came back.
 * Everything that could not be read is shown before anything is trusted:
 * detected period, rows that failed with their spreadsheet row number, and how
 * many products could not be resolved to an EAN.
 */

interface ParseError {
  sourceRow: number;
  field: string;
  message: string;
}

interface SheetOption {
  marketplace: string;
  sheet: string;
  rowCount: number;
  caveats: string[];
}

interface InspectResult {
  ok: true;
  mode: "inspect";
  fileName: string;
  hasMasterSheet: boolean;
  master: { rows: number; withEan: number; active: number } | null;
  marketplaces: SheetOption[];
  unrecognisedSheets: string[];
  sheetNames: string[];
}

interface ImportResult {
  ok: true;
  mode: "import";
  importId: string | null;
  persisted: boolean;
  fileName: string;
  marketplace: string;
  selectedSheet: string;
  statistics: {
    totalRows: number;
    validRows: number;
    invalidRows: number;
    minDate: string | null;
    maxDate: string | null;
  };
  period: { from: string; to: string } | null;
  identifiers: { fromSheet: number; fromMasterLookup: number; unresolved: number };
  master: { rows: number; withEan: number; active: number } | null;
  caveats: string[];
  errors: ParseError[];
  errorCount: number;
  notes: string[];
}

interface FailedResult {
  ok: false;
  error: string;
  hint?: string;
}

type UploadResult = InspectResult | ImportResult | FailedResult;

const num = new Intl.NumberFormat("en-IN");

/** Sheets whose only date is a bare month name need a year supplied. */
const NEEDS_YEAR = new Set(["flipkart"]);

export function UploadForm() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<false | "inspect" | "import">(false);
  const [overview, setOverview] = useState<InspectResult | null>(null);
  const [imported, setImported] = useState<ImportResult | null>(null);
  const [failure, setFailure] = useState<FailedResult | null>(null);
  const [sheet, setSheet] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [persist, setPersist] = useState(true);

  const selected = overview?.marketplaces.find((entry) => entry.sheet === sheet) ?? null;
  const needsYear = selected ? NEEDS_YEAR.has(selected.marketplace) : false;

  async function post(body: FormData): Promise<UploadResult> {
    const response = await fetch("/api/imports", { method: "POST", body });
    return (await response.json()) as UploadResult;
  }

  function currentFile(): File | null {
    return fileRef.current?.files?.[0] ?? null;
  }

  async function onInspect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = currentFile();
    if (!file) return;

    setBusy("inspect");
    setOverview(null);
    setImported(null);
    setFailure(null);
    setSheet("");

    try {
      const body = new FormData();
      body.set("file", file);
      const result = await post(body);
      if (!result.ok) setFailure(result);
      else if (result.mode === "inspect") {
        setOverview(result);
        // Preselect only when there is no choice to make.
        if (result.marketplaces.length === 1) setSheet(result.marketplaces[0]!.sheet);
      }
    } catch (cause) {
      setFailure({
        ok: false,
        error: cause instanceof Error ? cause.message : "Upload failed",
      });
    } finally {
      setBusy(false);
    }
  }

  async function onImport() {
    const file = currentFile();
    if (!file || !sheet) return;

    setBusy("import");
    setImported(null);
    setFailure(null);

    try {
      const body = new FormData();
      body.set("file", file);
      body.set("sheet", sheet);
      body.set("persist", persist ? "true" : "false");
      if (needsYear) body.set("year", year);

      const result = await post(body);
      if (!result.ok) setFailure(result);
      else if (result.mode === "import") setImported(result);
    } catch (cause) {
      setFailure({
        ok: false,
        error: cause instanceof Error ? cause.message : "Import failed",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={onInspect}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-500">Marketplace workbook</span>
          <input
            ref={fileRef}
            type="file"
            name="file"
            accept=".xlsx,.xls,.csv"
            required
            onChange={() => {
              setOverview(null);
              setImported(null);
              setFailure(null);
              setSheet("");
            }}
            className="text-sm file:mr-3 file:rounded file:border-0 file:bg-zinc-900 file:px-3 file:py-1.5 file:text-sm file:text-white dark:file:bg-zinc-100 dark:file:text-zinc-900"
          />
        </label>

        <button
          type="submit"
          disabled={busy !== false}
          className="inline-flex items-center gap-2 rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          <Upload className="h-4 w-4" aria-hidden />
          {busy === "inspect" ? "Reading…" : "Read workbook"}
        </button>

        <p className="w-full text-xs text-zinc-500">
          The file is read first and nothing is imported until you choose a sheet.
          One workbook holds several marketplaces, and which one is meant is not
          something a parser can infer.
        </p>
      </form>

      {failure ? (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm dark:border-red-900 dark:bg-red-950">
          <p className="font-medium">{failure.error}</p>
          {failure.hint ? <p className="mt-1">{failure.hint}</p> : null}
        </div>
      ) : null}

      {overview ? (
        <section className="flex flex-col gap-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-medium">{overview.fileName}</h2>
            <p className="text-sm text-zinc-500">
              {overview.sheetNames.length} sheets ·{" "}
              {overview.marketplaces.length} recognised
            </p>
          </div>

          {overview.master ? (
            <p className="rounded border border-zinc-200 p-3 text-sm dark:border-zinc-800">
              <strong>Master</strong> product table: {num.format(overview.master.rows)}{" "}
              rows, {num.format(overview.master.withEan)} with an EAN,{" "}
              {num.format(overview.master.active)} active. This is what turns a
              marketplace&rsquo;s own product id into an EAN, which is how a row
              reaches an ERP item.
            </p>
          ) : (
            <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950">
              No usable <strong>Master</strong> sheet was found. Sheets that carry
              their own EAN still reconcile; the rest cannot be matched to ERP
              items.
            </p>
          )}

          {overview.marketplaces.length === 0 ? (
            <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950">
              None of this workbook&rsquo;s sheets match a known marketplace
              layout. Sheets found: {overview.sheetNames.join(", ")}.
            </p>
          ) : (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">Choose a sheet to import</legend>
              {overview.marketplaces.map((entry) => (
                <label
                  key={entry.sheet}
                  className="flex cursor-pointer items-start gap-3 rounded border border-zinc-200 p-3 text-sm dark:border-zinc-800"
                >
                  <input
                    type="radio"
                    name="sheet"
                    className="mt-1"
                    checked={sheet === entry.sheet}
                    onChange={() => setSheet(entry.sheet)}
                  />
                  <span className="flex flex-col gap-1">
                    <span>
                      <strong>{entry.sheet}</strong>{" "}
                      <span className="text-zinc-500">
                        · {num.format(entry.rowCount)} rows
                      </span>
                    </span>
                    {entry.caveats.map((caveat) => (
                      <span key={caveat} className="text-xs text-amber-700 dark:text-amber-500">
                        {caveat}
                      </span>
                    ))}
                  </span>
                </label>
              ))}
            </fieldset>
          )}

          {overview.unrecognisedSheets.length > 0 ? (
            <p className="text-xs text-zinc-500">
              Not imported, no known layout: {overview.unrecognisedSheets.join(", ")}.
            </p>
          ) : null}

          <div className="flex flex-wrap items-end gap-3">
            {needsYear ? (
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-zinc-500">Reporting year</span>
                <input
                  type="number"
                  value={year}
                  onChange={(event) => setYear(event.target.value)}
                  className="w-28 rounded border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                />
                <span className="text-xs text-zinc-500">
                  This sheet dates rows by month name only.
                </span>
              </label>
            ) : null}

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={persist}
                onChange={(event) => setPersist(event.target.checked)}
              />
              <span>Save to Convex</span>
            </label>

            <button
              type="button"
              onClick={onImport}
              disabled={busy !== false || !sheet}
              className="inline-flex items-center gap-2 rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {busy === "import" ? "Importing…" : "Import this sheet"}
            </button>
          </div>
        </section>
      ) : null}

      {imported ? (
        <div className="flex flex-col gap-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-medium">
              {imported.fileName} · <code>{imported.selectedSheet}</code>
            </h2>
            <p className="text-sm text-zinc-500">
              {imported.marketplace}
              {imported.persisted ? " · saved" : " · not saved"}
            </p>
          </div>

          {imported.notes.map((note) => (
            <p
              key={note}
              className="rounded border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950"
            >
              {note}
            </p>
          ))}

          {imported.caveats.map((caveat) => (
            <p
              key={caveat}
              className="rounded border border-zinc-200 p-3 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400"
            >
              {caveat}
            </p>
          ))}

          <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
            {[
              ["Rows", num.format(imported.statistics.totalRows)],
              ["Valid", num.format(imported.statistics.validRows)],
              ["Invalid", num.format(imported.statistics.invalidRows)],
              ["Min date", imported.statistics.minDate ?? "—"],
              ["Max date", imported.statistics.maxDate ?? "—"],
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

          {/* How each row reached an EAN. A row that reached none is a row the
              reconciliation will report as a one-sided gap, so it is stated
              here rather than discovered later in the report. */}
          <dl className="grid grid-cols-3 gap-3 text-sm">
            {[
              ["EAN on the sheet", num.format(imported.identifiers.fromSheet)],
              ["Resolved via Master", num.format(imported.identifiers.fromMasterLookup)],
              ["Unresolved", num.format(imported.identifiers.unresolved)],
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

          {imported.period ? (
            <p className="text-sm">
              Detected reporting period{" "}
              <strong>
                {imported.period.from} → {imported.period.to}
              </strong>
              . The dashboard will request ERP sales-order lines for exactly this
              range.{" "}
              <a
                href={`/dashboard?from=${imported.period.from}&to=${imported.period.to}${
                  imported.importId ? `&importId=${imported.importId}` : ""
                }`}
                className="underline underline-offset-4"
              >
                Open the report
              </a>
            </p>
          ) : (
            <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950">
              No usable dates were found, so no reporting period could be
              determined.
            </p>
          )}

          {imported.errors.length > 0 ? (
            <details open>
              <summary className="cursor-pointer text-sm font-medium">
                {num.format(imported.errorCount)} row problem
                {imported.errorCount === 1 ? "" : "s"}
                {imported.errorCount > imported.errors.length
                  ? ` (showing the first ${imported.errors.length})`
                  : ""}
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
                    {imported.errors.map((error) => (
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

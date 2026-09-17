"use client";

import { useRouter, useSearchParams } from "next/navigation";

/**
 * Which import, and which marketplace.
 *
 * Both are URL parameters rather than component state, so a report is a link:
 * the exact view someone is looking at can be pasted into a message and opened
 * by somebody else. That matters more than it sounds for a reconciliation — the
 * usual next step after finding a variance is showing it to a person.
 *
 * The marketplace defaults to whatever the import recorded and is only
 * overridden deliberately. Picking a marketplace whose GSTINs do not match the
 * sheet is a legitimate thing to do while configuring, and the page says so
 * rather than preventing it.
 */

interface ImportOption {
  _id: string;
  fileName: string;
  marketplace?: string | null;
  sheetName?: string | null;
  status: string;
  minDate: string | null;
  maxDate: string | null;
  totalRows: number;
}

const num = new Intl.NumberFormat("en-IN");

export function ReportSelector({
  imports,
  selectedImportId,
  marketplaces,
  selectedMarketplace,
}: {
  imports: ImportOption[];
  selectedImportId: string | null;
  marketplaces: string[];
  selectedMarketplace: string | null;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function set(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`/dashboard?${next.toString()}`);
  }

  const usable = imports.filter((entry) => entry.status === "completed");

  return (
    <section className="flex flex-wrap items-end gap-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-zinc-500">Import</span>
        <select
          value={selectedImportId ?? ""}
          onChange={(event) => set("importId", event.target.value)}
          className="min-w-[24rem] rounded border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700"
        >
          <option value="">Most recent</option>
          {usable.map((entry) => (
            <option key={entry._id} value={entry._id}>
              {entry.sheetName ?? entry.marketplace ?? "sheet"} ·{" "}
              {entry.minDate ?? "?"} → {entry.maxDate ?? "?"} ·{" "}
              {num.format(entry.totalRows)} rows · {entry.fileName}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-zinc-500">Marketplace</span>
        <select
          value={selectedMarketplace ?? ""}
          onChange={(event) => set("marketplace", event.target.value)}
          className="rounded border border-zinc-300 bg-transparent px-2 py-1.5 text-sm capitalize dark:border-zinc-700"
        >
          <option value="">From the import</option>
          {marketplaces.map((marketplace) => (
            <option key={marketplace} value={marketplace}>
              {marketplace}
            </option>
          ))}
        </select>
      </label>

      <p className="max-w-md text-xs text-zinc-500">
        The marketplace decides which customer GSTINs the ERP is queried for. It
        comes from the marketplace configuration, not from the sheet.
      </p>
    </section>
  );
}

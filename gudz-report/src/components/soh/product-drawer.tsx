"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

import type { SnapshotRow } from "@/lib/report/snapshot-model";
import { monthLabel } from "./soh-table";
import {
  CURRENT_SOH,
  DAMAGE,
  GRN,
  MAPPING_LABELS,
  RETURNED,
  SALES_QUANTITY,
} from "@/lib/report/vocabulary";

/**
 * One product on one marketplace.
 *
 * The clicked month's figures lead, because that is the row that was clicked.
 * Every month for the product follows underneath, since the question after
 * "what was August" is almost always "and the months before it".
 *
 * Current SOH sits in its own group. It belongs to the product rather than to
 * any month, and listing it among them would invite it to be read as month-end
 * stock.
 */

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const num = new Intl.NumberFormat("en-IN");

function Figure({ value }: { value: number | null }) {
  if (value === null) return <span className="text-zinc-400">—</span>;
  return <>{num.format(value)}</>;
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-1.5">
      <dt className="shrink-0 text-[12px] text-zinc-500">{label}</dt>
      <dd
        className={`min-w-0 text-right text-[13px] text-zinc-900 ${
          mono ? "font-mono text-[11px] break-all" : "font-medium"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function Group({ children }: { children: React.ReactNode }) {
  return <dl className="border-t border-zinc-100 px-5 py-3 first:border-t-0">{children}</dl>;
}

export function ProductDrawer({
  row,
  siblings,
  onClose,
}: {
  row: SnapshotRow | null;
  /** Every month of the same product on the same marketplace. */
  siblings: SnapshotRow[];
  onClose: () => void;
}) {
  // Escape closes it. A panel dismissible only by mouse traps anyone working
  // through the list with the keyboard.
  useEffect(() => {
    if (!row) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [row, onClose]);

  if (!row) return null;

  const months = [...siblings].sort((a, b) => a.month.localeCompare(b.month));

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close product detail"
        onClick={onClose}
        className="flex-1 bg-zinc-900/20"
      />

      <aside className="drawer-panel flex h-full w-full max-w-sm flex-col overflow-y-auto border-l border-zinc-200 bg-white">
        <header className="sticky top-0 z-10 flex items-start gap-3 border-b border-zinc-200 bg-white px-5 py-4">
          <h2 className="min-w-0 flex-1 text-[14px] leading-snug font-semibold text-zinc-900">
            {row.productName}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <Group>
          <Field label="SKU" value={row.sku} mono />
          <Field label="EAN" value={row.ean ?? "—"} mono />
          <Field label="Marketplace" value={<span className="capitalize">{row.marketplace}</span>} />
          <Field label="Month" value={monthLabel(row.month)} />
        </Group>

        <Group>
          <Field label={CURRENT_SOH.label} value={<Figure value={row.currentSoh} />} />
          <Field
            label={GRN.label}
            value={<Figure value={row.grn} />}
          />
          <Field label={SALES_QUANTITY.label} value={num.format(row.salesQuantity)} />
          <Field label="Sales value" value={inr.format(row.salesValue)} />
          <Field label={DAMAGE.label} value={num.format(row.damage)} />
          <Field label={RETURNED.label} value={num.format(row.returned)} />
          <Field label="Status" value={MAPPING_LABELS[row.mappingStatus]} />
        </Group>

        {months.length > 1 ? (
          <section className="border-t border-zinc-100 px-5 py-3">
            <h3 className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
              All months
            </h3>
            <table className="mt-2 w-full text-[12px]">
              <thead>
                <tr className="text-[11px] text-zinc-400">
                  <th className="pb-1 text-left font-medium">Month</th>
                  <th className="pb-1 text-right font-medium">{GRN.label}</th>
                  <th className="pb-1 text-right font-medium">Sales</th>
                  <th className="pb-1 text-right font-medium">Value</th>
                </tr>
              </thead>
              <tbody>
                {months.map((entry) => (
                  <tr
                    key={entry.id}
                    className={`border-t border-zinc-100 ${
                      entry.id === row.id ? "font-medium text-zinc-900" : "text-zinc-600"
                    }`}
                  >
                    <td className="py-1">{monthLabel(entry.month)}</td>
                    <td className="py-1 text-right">
                      <Figure value={entry.grn} />
                    </td>
                    <td className="py-1 text-right">{num.format(entry.salesQuantity)}</td>
                    <td className="py-1 text-right">{inr.format(entry.salesValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        <p className="mt-auto border-t border-zinc-100 px-5 py-3 text-[11px] leading-relaxed text-zinc-400">
          {CURRENT_SOH.label} is Healthy Master&rsquo;s live position, not month-end stock.
        </p>
      </aside>
    </div>
  );
}

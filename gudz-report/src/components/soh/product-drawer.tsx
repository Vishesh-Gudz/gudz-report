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
 * One product on one marketplace, month by month.
 *
 * Opening a row shows every month for that product rather than only the month
 * clicked — the question behind a click is almost always "how did this move
 * across the period", and answering it with one month means closing the panel
 * and opening two more.
 *
 * Current SOH sits apart from the months on purpose. It is a live figure that
 * belongs to the product, not to any month in the table, and putting it in the
 * monthly list would invite it to be read as month-end stock.
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

function Row({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-zinc-100 py-1.5 last:border-0">
      <dt className="text-[13px] text-zinc-500">
        {label}
        {hint ? <span className="block text-[11px] text-zinc-400">{hint}</span> : null}
      </dt>
      <dd className="text-[13px] font-medium text-zinc-900">{value}</dd>
    </div>
  );
}

function Section({
  title,
  source,
  children,
}: {
  title: string;
  source?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-zinc-100 px-5 py-4 first:border-t-0">
      <h3 className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
        {title}
      </h3>
      {source ? <p className="mt-0.5 text-[11px] text-zinc-400">{source}</p> : null}
      <div className="mt-2">{children}</div>
    </section>
  );
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
  const totalSales = months.reduce((total, entry) => total + entry.salesQuantity, 0);
  const totalValue = months.reduce((total, entry) => total + entry.salesValue, 0);

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close product detail"
        onClick={onClose}
        className="flex-1 bg-zinc-900/20"
      />

      <aside className="flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-zinc-200 bg-white shadow-xl">
        <header className="sticky top-0 z-10 flex items-start gap-3 border-b border-zinc-200 bg-white px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] leading-snug font-semibold text-zinc-900">
              {row.productName}
            </h2>
            <p className="mt-1 font-mono text-[11px] break-all text-zinc-500">{row.sku}</p>
            {row.ean ? (
              <p className="font-mono text-[11px] text-zinc-500">{row.ean}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <Section title="By month" source={`${GRN.source} · ${SALES_QUANTITY.source}`}>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] text-zinc-400">
                <th className="pb-1 font-medium">Month</th>
                <th className="pb-1 text-right font-medium">{GRN.label}</th>
                <th className="pb-1 text-right font-medium">{SALES_QUANTITY.label}</th>
                <th className="pb-1 text-right font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
              {months.map((entry) => (
                <tr
                  key={entry.id}
                  className={`border-t border-zinc-100 ${
                    entry.id === row.id ? "font-medium text-zinc-900" : "text-zinc-700"
                  }`}
                >
                  <td className="py-1.5">{monthLabel(entry.month)}</td>
                  <td className="py-1.5 text-right">
                    <Figure value={entry.grn} />
                  </td>
                  <td className="py-1.5 text-right">{num.format(entry.salesQuantity)}</td>
                  <td className="py-1.5 text-right">{inr.format(entry.salesValue)}</td>
                </tr>
              ))}
            </tbody>
            {months.length > 1 ? (
              <tfoot>
                <tr className="border-t border-zinc-300 font-medium text-zinc-900">
                  <td className="py-1.5">Total</td>
                  <td className="py-1.5 text-right">
                    <Figure
                      value={
                        months.some((entry) => entry.grn !== null)
                          ? months.reduce((total, entry) => total + (entry.grn ?? 0), 0)
                          : null
                      }
                    />
                  </td>
                  <td className="py-1.5 text-right">{num.format(totalSales)}</td>
                  <td className="py-1.5 text-right">{inr.format(totalValue)}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
          {row.grn === null ? (
            <p className="mt-2 text-[11px] text-zinc-500">{GRN.awaiting}.</p>
          ) : null}
        </Section>

        <Section title={CURRENT_SOH.label} source={CURRENT_SOH.source}>
          <dl>
            <Row
              label="Available now"
              value={<Figure value={row.currentSoh} />}
              hint="Healthy Master's own stock, not the marketplace's"
            />
          </dl>
          <p className="mt-2 text-[11px] text-zinc-400">
            {row.currentSoh === null
              ? "No live stock position is held for this product in the ERP."
              : "A live position, not the stock held at the end of any month above."}
          </p>
        </Section>

        <Section title="Adjustments">
          <dl>
            <Row label={DAMAGE.label} value={num.format(row.damage)} hint={DAMAGE.description} />
            <Row
              label={RETURNED.label}
              value={num.format(row.returned)}
              hint={RETURNED.description}
            />
          </dl>
        </Section>

        <Section title="Source">
          <dl>
            <Row label="Marketplace" value={<span className="capitalize">{row.marketplace}</span>} />
            <Row label="Marketplace item ID" value={row.marketplaceItemId ?? "—"} />
            <Row
              label="ERP item"
              value={
                row.erpItemId ? (
                  <span className="font-mono text-[11px] break-all">{row.erpItemId}</span>
                ) : (
                  "—"
                )
              }
            />
            <Row label="Mapping" value={MAPPING_LABELS[row.mappingStatus]} />
            <Row
              label="Report rows"
              value={num.format(months.reduce((total, entry) => total + entry.sourceRows, 0))}
              hint="lines aggregated from the uploaded report"
            />
          </dl>
          <p className="mt-2 text-[12px] text-zinc-500">{row.mappingReason}</p>
        </Section>
      </aside>
    </div>
  );
}

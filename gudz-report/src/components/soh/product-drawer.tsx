"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

import type { SohProductRow } from "@/lib/report/soh-rows";
import {
  SELL_IN,
  SELL_OUT,
  SKU_STATUS_HINTS,
  SKU_STATUS_LABELS,
  STOCK_ON_HAND,
} from "@/lib/report/vocabulary";

/**
 * One product, and where every number on its row came from.
 *
 * The question this panel exists to answer is "can I quote this?", so it is
 * organised by provenance rather than by prettiness: the identifiers that tie
 * the two sides together, then each measure with its source named, then the
 * actual sales orders and spreadsheet rows underneath the totals.
 *
 * A panel rather than a page. The comparison a reader is making is against the
 * rows still visible behind it, and a navigation would take those away and make
 * them scroll back to their place afterwards.
 */

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const num = new Intl.NumberFormat("en-IN");
const pct = new Intl.NumberFormat("en-IN", {
  style: "percent",
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});

function Delta({ value, money }: { value: number; money?: boolean }) {
  if (value === 0) return <span className="text-zinc-400">0</span>;
  return (
    <span className={value > 0 ? "text-amber-700" : "text-sky-700"}>
      {value > 0 ? "+" : "−"}
      {money ? inr.format(Math.abs(value)) : num.format(Math.abs(value))}
    </span>
  );
}

function Row({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
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
    <section className="px-5 py-4">
      <h3 className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
        {title}
      </h3>
      {source ? <p className="mt-0.5 text-[11px] text-zinc-400">{source}</p> : null}
      <dl className="mt-2">{children}</dl>
    </section>
  );
}

export function ProductDrawer({
  row,
  period,
  marketplace,
  onClose,
}: {
  row: SohProductRow | null;
  period: { from: string; to: string };
  marketplace: string;
  onClose: () => void;
}) {
  // Escape closes it. A panel that can only be dismissed with the mouse is a
  // panel that traps somebody working through a list with the keyboard.
  useEffect(() => {
    if (!row) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [row, onClose]);

  if (!row) return null;

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

        <Section title="Identity">
          <Row label="EAN" value={row.ean ?? "—"} />
          <Row label="Marketplace" value={<span className="capitalize">{marketplace}</span>} />
          <Row label="Marketplace item ID" value={row.marketplaceItemId ?? "—"} />
          <Row label="ERP item ID" value={
            row.erpItemId ? (
              <span className="font-mono text-[11px] break-all">{row.erpItemId}</span>
            ) : (
              "—"
            )
          } />
          <Row label="Reporting period" value={`${period.from} → ${period.to}`} />
        </Section>

        <div className="h-px bg-zinc-100" />

        <Section title={STOCK_ON_HAND.label} source={STOCK_ON_HAND.source}>
          {row.stockAvailable === null ? (
            <p className="py-1.5 text-[13px] text-zinc-500">
              No live stock position is held for this product in the ERP.
            </p>
          ) : (
            <>
              <Row label="Available" value={num.format(row.stockAvailable)} hint="after blocked stock" />
              <Row label="On hand" value={num.format(row.stockOnHand ?? 0)} />
              <Row label="Blocked" value={num.format(row.stockBlocked ?? 0)} hint="open orders and picklists" />
              {row.stockLocations.map((location) => (
                <Row
                  key={location.name}
                  label={location.name}
                  value={`${num.format(location.available)} available`}
                />
              ))}
              {row.stockUpdatedAt ? (
                <Row
                  label="Position read"
                  value={new Date(row.stockUpdatedAt).toLocaleString("en-GB", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                />
              ) : null}
              <p className="mt-2 text-[11px] text-zinc-400">
                Live position today, not the stock held at the end of the reporting
                period.
              </p>
            </>
          )}
        </Section>

        <div className="h-px bg-zinc-100" />

        <Section title="Quantity" source={`${SELL_IN.source} · ${SELL_OUT.source}`}>
          <Row label={SELL_IN.label} value={num.format(row.sellIn)} hint="invoiced to the marketplace" />
          <Row label={SELL_OUT.label} value={num.format(row.sellOut)} hint="sold to consumers" />
          <Row label="Variance" value={<Delta value={row.quantityVariance} />} hint="sell-out minus sell-in" />
          <Row
            label="Variance %"
            value={
              row.quantityVariancePct === null ? (
                <span className="text-zinc-400">—</span>
              ) : (
                <span className={row.quantityVariancePct > 0 ? "text-amber-700" : "text-sky-700"}>
                  {pct.format(row.quantityVariancePct)}
                </span>
              )
            }
          />
        </Section>

        <div className="h-px bg-zinc-100" />

        <Section title="Value">
          <Row label={`${SELL_IN.label} revenue`} value={inr.format(row.sellInRevenue)} />
          <Row label={`${SELL_OUT.label} revenue`} value={inr.format(row.sellOutRevenue)} />
          <Row label="Variance" value={<Delta value={row.revenueVariance} money />} />
        </Section>

        <div className="h-px bg-zinc-100" />

        <Section title="Status and mapping">
          <Row label="Status" value={SKU_STATUS_LABELS[row.status]} />
          <p className="py-1.5 text-[12px] text-zinc-500">{SKU_STATUS_HINTS[row.status]}</p>
          <Row
            label="Mapping"
            value={
              row.mapping === "confirmed"
                ? "Confirmed by a person"
                : row.mapping === "matched"
                  ? "Matched on an identifier"
                  : row.mapping === "unresolved"
                    ? "Needs review"
                    : "ERP product"
            }
          />
          <p className="py-1.5 text-[12px] text-zinc-500">{row.mappingReason}</p>
        </Section>

        {row.erpOrderRefs.length > 0 ? (
          <>
            <div className="h-px bg-zinc-100" />
            <Section
              title={`${SELL_IN.label} orders`}
              source={`${num.format(row.erpOrders)} order${row.erpOrders === 1 ? "" : "s"} · ${num.format(row.erpLines)} line${row.erpLines === 1 ? "" : "s"}`}
            >
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-[11px] text-zinc-400">
                    <th className="pb-1 font-medium">Order</th>
                    <th className="pb-1 font-medium">Date</th>
                    <th className="pb-1 text-right font-medium">Qty</th>
                    <th className="pb-1 text-right font-medium">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {row.erpOrderRefs.map((order) => (
                    <tr key={order.salesOrderId} className="border-t border-zinc-100">
                      <td className="py-1 font-mono text-[11px]">{order.soNumber}</td>
                      <td className="py-1">{order.orderDate.slice(0, 10)}</td>
                      <td className="py-1 text-right">{num.format(order.quantity)}</td>
                      <td className="py-1 text-right">{inr.format(order.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          </>
        ) : null}

        {row.sourceRows > 0 ? (
          <>
            <div className="h-px bg-zinc-100" />
            <Section
              title={`${SELL_OUT.label} source rows`}
              source={`${num.format(row.sourceRows)} row${row.sourceRows === 1 ? "" : "s"} in the uploaded report`}
            >
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-[11px] text-zinc-400">
                    <th className="pb-1 font-medium">Row</th>
                    <th className="pb-1 font-medium">Date</th>
                    <th className="pb-1 text-right font-medium">Qty</th>
                    <th className="pb-1 text-right font-medium">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {row.sourceRowRefs.map((source) => (
                    <tr key={source.sourceRow} className="border-t border-zinc-100">
                      <td className="py-1">{source.sourceRow}</td>
                      <td className="py-1">{source.orderDate ?? "—"}</td>
                      <td className="py-1 text-right">
                        {source.quantity === null ? "—" : num.format(source.quantity)}
                      </td>
                      <td className="py-1 text-right">
                        {source.amount === null ? "—" : inr.format(source.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {row.sourceRows > row.sourceRowRefs.length ? (
                <p className="mt-2 text-[11px] text-zinc-400">
                  Showing the first {num.format(row.sourceRowRefs.length)} of{" "}
                  {num.format(row.sourceRows)} rows. The totals above cover all of them.
                </p>
              ) : null}
            </Section>
          </>
        ) : null}
      </aside>
    </div>
  );
}

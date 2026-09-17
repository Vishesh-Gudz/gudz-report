"use client";

import { useMemo, useState } from "react";

import { ProductDrawer } from "./product-drawer";
import { SohTable } from "./soh-table";
import { SummaryStrip } from "./summary-strip";
import { totalsFor, type SnapshotRow } from "@/lib/report/snapshot-model";

/**
 * Holds the report's interaction state: which marketplace, which month, which
 * product is open.
 *
 * Filtering happens here rather than inside the table so the summary above can
 * describe exactly what is on screen — a total that silently means something
 * other than the rows under it is how a figure gets quoted out of context.
 */

export function ReportView({
  rows,
  marketplaces,
  months,
}: {
  rows: SnapshotRow[];
  marketplaces: string[];
  months: string[];
}) {
  const [selected, setSelected] = useState<SnapshotRow | null>(null);
  const [marketplace, setMarketplace] = useState("");
  const [month, setMonth] = useState("");

  const visible = useMemo(
    () =>
      rows.filter((row) => {
        if (marketplace && row.marketplace !== marketplace) return false;
        if (month && row.month !== month) return false;
        return true;
      }),
    [rows, marketplace, month],
  );

  // Every month of the same product on the same marketplace, so the detail
  // panel can show the run rather than the single month that was clicked.
  const siblings = useMemo(() => {
    if (!selected) return [];
    return rows.filter(
      (row) => row.marketplace === selected.marketplace && row.sku === selected.sku,
    );
  }, [rows, selected]);

  const totals = totalsFor(visible);

  return (
    <>
      <SummaryStrip
        totals={totals}
        marketplaceCount={marketplace ? 1 : marketplaces.length}
        monthCount={month ? 1 : months.length}
      />

      <SohTable
        rows={visible}
        marketplaces={marketplaces}
        marketplace={marketplace}
        onMarketplaceChange={(value) => {
          setMarketplace(value);
          setSelected(null);
        }}
        months={months}
        month={month}
        onMonthChange={(value) => {
          setMonth(value);
          setSelected(null);
        }}
        onSelect={(row) => setSelected(row)}
        selectedId={selected?.id ?? null}
      />

      <ProductDrawer row={selected} siblings={siblings} onClose={() => setSelected(null)} />
    </>
  );
}

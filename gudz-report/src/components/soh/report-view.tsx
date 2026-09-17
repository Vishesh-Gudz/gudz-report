"use client";

import { useState } from "react";

import { ProductDrawer } from "./product-drawer";
import { SohTable } from "./soh-table";
import type { SohProductRow } from "@/lib/report/soh-rows";

/**
 * Holds the one piece of state the report has: which product is open.
 *
 * It lives here rather than in the table so the drawer is a sibling of the
 * table and not a descendant of a row — a drawer rendered inside a `<tr>` is a
 * drawer that unmounts when its page changes underneath it.
 */

export function ReportView({
  rows,
  marketplaces,
}: {
  rows: SohProductRow[];
  marketplaces: string[];
}) {
  const [selected, setSelected] = useState<SohProductRow | null>(null);
  const [marketplace, setMarketplace] = useState("");

  // Filtering here rather than inside the table so the totals strip above can
  // be told what is on screen without the table having to report upward.
  const visible = marketplace
    ? rows.filter((row) => row.marketplace === marketplace)
    : rows;

  return (
    <>
      <SohTable
        rows={visible}
        marketplaces={marketplaces}
        marketplace={marketplace}
        onMarketplaceChange={(value) => {
          setMarketplace(value);
          setSelected(null);
        }}
        onSelect={(row) => setSelected(row)}
        selectedId={selected?.id ?? null}
      />
      <ProductDrawer row={selected} onClose={() => setSelected(null)} />
    </>
  );
}

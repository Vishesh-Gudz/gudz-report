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
  period,
  marketplace,
}: {
  rows: SohProductRow[];
  period: { from: string; to: string };
  marketplace: string;
}) {
  const [selected, setSelected] = useState<SohProductRow | null>(null);

  return (
    <>
      <SohTable
        rows={rows}
        onSelect={(row) => setSelected(row)}
        selectedSku={selected?.sku ?? null}
      />
      <ProductDrawer
        row={selected}
        period={period}
        marketplace={marketplace}
        onClose={() => setSelected(null)}
      />
    </>
  );
}

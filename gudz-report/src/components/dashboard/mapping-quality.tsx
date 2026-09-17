import type {
  MarketplaceReport,
  UnmappedReportRow,
} from "@/lib/report/marketplace-report";

/**
 * Where the report is not trustworthy, stated plainly.
 *
 * This section is the reason the numbers above can be believed. A reconciliation
 * that showed only the SKUs it managed to match would look excellent and mean
 * nothing — the interesting rows are exactly the ones that did not match, and
 * every one of them is listed here with a reason and its spreadsheet row number.
 *
 * Nothing is hidden and nothing is quietly resolved. A barcode shared by several
 * catalogue items is shown as ambiguous with all its candidates, because picking
 * one would produce a number that is confidently wrong, which is worse than a
 * gap somebody can go and fix.
 */

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const num = new Intl.NumberFormat("en-IN");

const ROUTE_LABELS: Record<string, string> = {
  channelMapping: "ERP channel mapping",
  barcode: "EAN matched a catalogue barcode",
  sku: "Row carried the ERP SKU",
  nameSuggestion: "Name similarity (unconfirmed)",
};

export function MappingQuality({ report }: { report: MarketplaceReport }) {
  const { excel, reconciliation, catalog, unmappedRows } = report;
  const mapping = excel.mapping;

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Data quality</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Every row the report could not place, and why. These are the rows whose
          quantity and revenue are counted in the totals but cannot be compared
          against the ERP.
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3 xl:grid-cols-6">
        <Tile label="Mapped rows" value={mapping ? num.format(mapping.mapped) : "—"} />
        <Tile
          label="Ambiguous rows"
          value={mapping ? num.format(mapping.ambiguous) : "—"}
          tone={mapping && mapping.ambiguous > 0 ? "warn" : undefined}
        />
        <Tile
          label="Unmapped rows"
          value={mapping ? num.format(mapping.unmapped) : "—"}
          tone={mapping && mapping.unmapped > 0 ? "warn" : undefined}
        />
        <Tile label="ERP-only SKUs" value={num.format(reconciliation.counts.skusErpOnly)} />
        <Tile
          label="Report-only SKUs"
          value={num.format(reconciliation.counts.skusExcelOnly)}
        />
        <Tile
          label="Unreconciled units"
          value={mapping ? num.format(mapping.unmappedQuantity) : "—"}
          hint={mapping ? inr.format(mapping.unmappedRevenue) : undefined}
          tone={mapping && mapping.unmappedQuantity > 0 ? "warn" : undefined}
        />
      </dl>

      {mapping ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {num.format(mapping.distinctMapped)} of{" "}
          {num.format(mapping.distinctProducts)} distinct products in this sheet
          reached an ERP item. Routes used:{" "}
          {Object.entries(mapping.byRoute)
            .filter(([, count]) => count > 0)
            .map(([route, count]) => `${ROUTE_LABELS[route] ?? route} ${num.format(count)}`)
            .join(" · ") || "none"}
          .
        </p>
      ) : null}

      {catalog ? (
        <p className="text-sm text-zinc-500">
          ERP catalogue: {num.format(catalog.items)} items,{" "}
          {num.format(catalog.withBarcode)} with a barcode,{" "}
          {num.format(catalog.withChannelMapping)} with a channel mapping.
          {catalog.duplicateBarcodes > 0 ? (
            <>
              {" "}
              {num.format(catalog.duplicateBarcodes)} barcodes are shared by more
              than one item — rows hitting those are reported as ambiguous rather
              than assigned to one of them.
            </>
          ) : null}
        </p>
      ) : null}

      {unmappedRows.length > 0 ? (
        <UnmappedTable rows={unmappedRows} />
      ) : mapping ? (
        <p className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950">
          Every row in this sheet reached an ERP product.
        </p>
      ) : null}
    </section>
  );
}

function UnmappedTable({ rows }: { rows: UnmappedReportRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="w-full min-w-[64rem] text-sm">
        <caption className="px-3 py-2 text-left text-sm text-zinc-500">
          Grouped per distinct product. Quantity and revenue are the totals across
          every row for that product; the row number is the first occurrence, so
          the file can be opened at it.
        </caption>
        <thead className="bg-zinc-50 text-left dark:bg-zinc-900">
          <tr>
            <th className="px-3 py-2 font-medium">Row</th>
            <th className="px-3 py-2 font-medium">Rows</th>
            <th className="px-3 py-2 font-medium">Date</th>
            <th className="px-3 py-2 font-medium">Product</th>
            <th className="px-3 py-2 font-medium">Item ID</th>
            <th className="px-3 py-2 font-medium">EAN / SKU</th>
            <th className="px-3 py-2 text-right font-medium">Qty</th>
            <th className="px-3 py-2 text-right font-medium">Revenue</th>
            <th className="px-3 py-2 font-medium">Why</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.sourceRow}-${row.sku ?? row.marketplaceItemId ?? "x"}`}
              className="border-t border-zinc-200 align-top dark:border-zinc-800"
            >
              <td className="px-3 py-2 tabular-nums">{row.sourceRow}</td>
              <td className="px-3 py-2 tabular-nums">{num.format(row.rowCount)}</td>
              <td className="px-3 py-2 whitespace-nowrap">{row.orderDate ?? "—"}</td>
              <td className="max-w-[18rem] px-3 py-2">{row.productName ?? "—"}</td>
              <td className="px-3 py-2 font-mono text-xs">
                {row.marketplaceItemId ?? "—"}
              </td>
              <td className="px-3 py-2 font-mono text-xs">{row.sku ?? "—"}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {row.quantity === null ? "—" : num.format(row.quantity)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {row.amount === null ? "—" : inr.format(row.amount)}
              </td>
              <td className="px-3 py-2">
                <span
                  className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                    row.status === "ambiguous"
                      ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                      : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                  }`}
                >
                  {row.status === "ambiguous" ? "Ambiguous" : "Unmapped"}
                </span>
                <p className="mt-1 max-w-[26rem] text-xs text-zinc-600 dark:text-zinc-400">
                  {row.reason}
                </p>
                {row.candidates.length > 0 ? (
                  <ul className="mt-1 list-disc pl-4 text-xs text-zinc-500">
                    {row.candidates.map((candidate) => (
                      <li key={candidate.sku}>
                        <code>{candidate.sku}</code> — {candidate.name}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "warn";
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        tone === "warn"
          ? "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950"
          : "border-zinc-200 dark:border-zinc-800"
      }`}
    >
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
      {hint ? <p className="mt-0.5 text-xs text-zinc-500">{hint}</p> : null}
    </div>
  );
}

import type { ReportKpis, UnmatchedRow } from "@/lib/report/aggregate";

/**
 * Import summary and the rows that did not reconcile.
 *
 * This section is the point of the report as much as the totals are. A
 * reconciliation that silently omits the rows it could not explain balances
 * perfectly and tells you nothing; every unmatched row is shown with its
 * spreadsheet row number and a reason someone can act on.
 */

const num = new Intl.NumberFormat("en-IN");
const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export function DataQuality({
  kpis,
  unmatched,
  limit = 200,
}: {
  kpis: ReportKpis;
  unmatched: UnmatchedRow[];
  limit?: number;
}) {
  const shown = unmatched.slice(0, limit);
  const totalUnmatched = kpis.unmatchedLines + kpis.ambiguousLines;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Import summary</h2>

      <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <dt className="text-zinc-500">Excel rows</dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums">
            {num.format(kpis.excelRows)}
          </dd>
        </div>
        <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <dt className="text-zinc-500">Matched</dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums">
            {num.format(kpis.matchedLines)}
          </dd>
        </div>
        <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <dt className="text-zinc-500">Unmatched</dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums">
            {num.format(totalUnmatched)}
          </dd>
        </div>
        <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <dt className="text-zinc-500">ERP lines with no Excel row</dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums">
            {num.format(kpis.erpOnlyLines)}
          </dd>
        </div>
      </dl>

      {kpis.unattributedLines > 0 ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950">
          <p className="font-medium">
            {num.format(kpis.unattributedLines)} line
            {kpis.unattributedLines === 1 ? "" : "s"} could not be attributed to a
            marketplace
          </p>
          <p className="mt-1 text-zinc-700 dark:text-zinc-300">
            The order carried no customer GSTIN, or its GSTIN is not configured
            against a marketplace. These rows are counted and shown under{" "}
            <strong>Unattributed</strong> — never dropped. Add the GSTIN to a
            marketplace in configuration to attribute them.
          </p>
        </div>
      ) : null}

      {shown.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="font-medium">Unmatched Excel rows</h3>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full min-w-[56rem] text-sm">
              <thead className="bg-zinc-50 text-left dark:bg-zinc-900">
                <tr>
                  {[
                    "Source row",
                    "Date",
                    "Marketplace",
                    "SKU",
                    "Product",
                    "Qty",
                    "Amount",
                    "Reason",
                  ].map((header) => (
                    <th
                      key={header}
                      scope="col"
                      className="whitespace-nowrap px-3 py-2 font-medium text-zinc-600 dark:text-zinc-400"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr
                    key={`${row.sourceRow}-${row.sku ?? "none"}`}
                    className="border-t border-zinc-200 dark:border-zinc-800"
                  >
                    {/* The spreadsheet row number, so a human can open the file
                        and look at the line that failed. */}
                    <td className="px-3 py-2 tabular-nums">{row.sourceRow}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {row.orderDate ?? "—"}
                    </td>
                    <td className="px-3 py-2">{row.marketplace}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                      {row.sku ?? "—"}
                    </td>
                    <td className="px-3 py-2">{row.productName ?? "—"}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {row.quantity === null ? "—" : num.format(row.quantity)}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {row.amount === null ? "—" : inr.format(row.amount)}
                    </td>
                    <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                      {row.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {unmatched.length > shown.length ? (
            <p className="text-xs text-zinc-500">
              Showing the first {num.format(shown.length)} of{" "}
              {num.format(unmatched.length)}. The counts above are exact.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

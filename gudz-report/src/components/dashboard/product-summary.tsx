import type { SkuReconciliationRow } from "@/lib/report/sku-reconciliation";

/**
 * Per-product reconciliation — the table a client reads first, and the primary
 * reconciliation in this report.
 *
 * SKU-level rather than line-level because that is what a month of real data
 * supports: the same product appears on dozens of ERP lines, so a line-to-line
 * join can only report ambiguity. Comparing totals per SKU is also the question
 * being asked — "we sold 14,978 of this; does the ERP agree?"
 *
 * Grouped by SKU, not product name: names drift between the marketplace's
 * spelling and the ERP's, and grouping on them splits one product into two rows
 * that each look half-right.
 *
 * A server component — a static aggregate with no interaction has no reason to
 * ship a table runtime to the browser.
 */

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const num = new Intl.NumberFormat("en-IN");

function Variance({ value, money }: { value: number; money?: boolean }) {
  if (value === 0) return <span className="text-zinc-400">0</span>;
  return (
    <span className={value > 0 ? "text-amber-600" : "text-blue-600"}>
      {value > 0 ? "+" : ""}
      {money ? inr.format(value) : num.format(value)}
    </span>
  );
}

export function ProductSummary({
  rows,
  limit = 100,
}: {
  rows: SkuReconciliationRow[];
  limit?: number;
}) {
  const shown = rows.slice(0, limit);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Product summary</h2>
        <p className="text-sm text-zinc-500">
          {num.format(rows.length)} product{rows.length === 1 ? "" : "s"}
          {rows.length > shown.length
            ? ` — showing top ${num.format(shown.length)} by ERP revenue`
            : ""}
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full min-w-[64rem] text-sm">
          <thead className="bg-zinc-50 text-left dark:bg-zinc-900">
            <tr>
              {[
                "Product",
                "SKU",
                "Status",
                "Orders",
                "ERP Qty",
                "Excel Qty",
                "ERP Revenue",
                "Excel Revenue",
                "Qty Variance",
                "Amount Variance",
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
            {shown.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-zinc-500">
                  No products for this period and filter set.
                </td>
              </tr>
            ) : (
              shown.map((row) => (
                <tr
                  key={row.sku}
                  className="border-t border-zinc-200 dark:border-zinc-800"
                >
                  <td className="px-3 py-2">{row.productName}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                    {row.sku}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {row.status === "matched" ? (
                      <span className="text-zinc-600 dark:text-zinc-400">Both</span>
                    ) : row.status === "erpOnly" ? (
                      <span className="text-blue-600">ERP only</span>
                    ) : (
                      <span className="text-amber-600">Excel only</span>
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{num.format(row.erpOrders)}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {num.format(row.erpQuantity)}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {num.format(row.excelQuantity)}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{inr.format(row.erpRevenue)}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {inr.format(row.excelRevenue)}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    <Variance value={row.quantityVariance} />
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    <Variance value={row.amountVariance} money />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

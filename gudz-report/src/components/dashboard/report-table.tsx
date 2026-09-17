"use client";

import { useMemo } from "react";
import {
  createColumnHelper,
  createPaginatedRowModel,
  createSortedRowModel,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";

import type { ReportLineRow } from "@/lib/report/aggregate";

/**
 * The main report table.
 *
 * TanStack Table v9: `useTable`, and row models registered as feature slots
 * inside `tableFeatures` rather than passed as options. v8's `useReactTable` +
 * `getSortedRowModel()` does not exist in this version.
 *
 * Only sorting and pagination are enabled. Filtering happens on the server
 * against the full result set — a client-side filter would only ever see the
 * current page and would quietly disagree with the KPI cards above it.
 */

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
});

const helper = createColumnHelper<typeof features, ReportLineRow>();

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});
const num = new Intl.NumberFormat("en-IN");

function formatDay(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toISOString().slice(0, 10);
}

/** Variance reads as a signed number; zero is shown as a dash, not as 0. */
function Variance({ value, money }: { value: number | null; money?: boolean }) {
  if (value === null) return <span className="text-zinc-400">—</span>;
  if (value === 0) return <span className="text-zinc-400">0</span>;
  const text = money ? inr.format(value) : num.format(value);
  return (
    <span className={value > 0 ? "text-amber-600" : "text-blue-600"}>
      {value > 0 ? "+" : ""}
      {text}
    </span>
  );
}

const MATCH_LABELS: Record<ReportLineRow["matchStatus"], string> = {
  matched: "Matched",
  unmatched: "Unmatched",
  ambiguous: "Ambiguous",
  erpOnly: "ERP only",
};

const columns = helper.columns([
  helper.accessor("soNumber", { header: "SO Number" }),
  helper.accessor("orderDate", {
    header: "Order Date",
    cell: (info) => formatDay(info.getValue()),
  }),
  helper.accessor("customerName", { header: "Customer" }),
  helper.accessor("marketplace", { header: "Marketplace" }),
  helper.accessor("productName", { header: "Product" }),
  helper.accessor("sku", { header: "SKU" }),
  helper.accessor("orderedQuantity", {
    header: "Ordered Qty",
    cell: (info) => num.format(info.getValue()),
  }),
  helper.accessor("unitPrice", {
    header: "Unit Price",
    cell: (info) => inr.format(info.getValue()),
  }),
  helper.accessor("lineTotal", {
    header: "Line Total",
    cell: (info) => inr.format(info.getValue()),
  }),
  helper.accessor("status", { header: "Status" }),
  helper.accessor("matchStatus", {
    header: "Match",
    cell: (info) => MATCH_LABELS[info.getValue()],
  }),
  helper.accessor("quantityVariance", {
    header: "Qty Var",
    cell: (info) => <Variance value={info.getValue()} />,
  }),
  helper.accessor("amountVariance", {
    header: "Amt Var",
    cell: (info) => <Variance value={info.getValue()} money />,
  }),
]);

export function ReportTable({ rows }: { rows: ReportLineRow[] }) {
  // Memoised so a re-render does not hand the table a new array identity and
  // make it rebuild every row model.
  const data = useMemo(() => rows, [rows]);

  // Uncontrolled pagination — the table owns the slice. Passing
  // `state.pagination` without a real `onPaginationChange` would pin the page
  // index, so Next and Previous would render as enabled and do nothing.
  //
  // The second argument is v9's state selector: it declares which slices this
  // component rerenders on and is what puts them on `table.state`. There is no
  // `getState()` in v9.
  const table = useTable(
    {
      features,
      columns,
      data,
      initialState: { pagination: { pageIndex: 0, pageSize: 50 } },
    },
    (state) => ({ pagination: state.pagination }),
  );

  const { pageIndex, pageSize } = table.state.pagination;
  const paginated = table.getPaginatedRowModel().rows;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-sm">
        <p className="text-zinc-500">
          {num.format(rows.length)} line{rows.length === 1 ? "" : "s"}
        </p>
        <label className="flex items-center gap-2">
          <span className="text-zinc-500">Rows</span>
          <select
            value={pageSize}
            onChange={(event) => table.setPageSize(Number(event.target.value))}
            className="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
          >
            {[25, 50, 100, 250].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full min-w-[80rem] text-sm">
          <thead className="bg-zinc-50 text-left dark:bg-zinc-900">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  <th
                    key={header.id}
                    scope="col"
                    className="cursor-pointer whitespace-nowrap px-3 py-2 font-medium text-zinc-600 select-none dark:text-zinc-400"
                    onClick={() => header.column.toggleSorting()}
                  >
                    {header.isPlaceholder ? null : (
                      <span className="inline-flex items-center gap-1">
                        <table.FlexRender header={header} />
                        {{ asc: "▲", desc: "▼" }[
                          header.column.getIsSorted() as "asc" | "desc"
                        ] ?? null}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {paginated.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-8 text-center text-zinc-500"
                >
                  No lines for this period and filter set.
                </td>
              </tr>
            ) : (
              paginated.map((row) => (
                <tr
                  key={row.id}
                  className="border-t border-zinc-200 dark:border-zinc-800"
                >
                  {row.getAllCells().map((cell) => (
                    <td key={cell.id} className="whitespace-nowrap px-3 py-2">
                      <table.FlexRender cell={cell} />
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <button
          type="button"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
          className="rounded border border-zinc-300 px-3 py-1 disabled:opacity-40 dark:border-zinc-700"
        >
          Previous
        </button>
        <span className="text-zinc-500">
          Page {pageIndex + 1} of {Math.max(1, table.getPageCount())}
        </span>
        <button
          type="button"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
          className="rounded border border-zinc-300 px-3 py-1 disabled:opacity-40 dark:border-zinc-700"
        >
          Next
        </button>
      </div>
    </div>
  );
}

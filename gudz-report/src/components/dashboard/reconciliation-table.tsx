"use client";

import { Fragment, useMemo, useState } from "react";
import {
  columnFilteringFeature,
  createColumnHelper,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_equalsString,
  filterFn_includesString,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { ChevronDown, ChevronRight } from "lucide-react";

import type {
  SkuMatchStatus,
  SkuReconciliationRow,
} from "@/lib/report/sku-reconciliation";

/**
 * The main reconciliation table: one row per SKU, both sides, and the gap.
 *
 * TanStack Table v9 — `useTable`, with row models registered as feature slots
 * inside `tableFeatures`. v8's `useReactTable` + `getCoreRowModel()` does not
 * exist in this version and examples written against it will not compile.
 *
 * Filtering and sorting are client-side *here specifically*, which is the
 * opposite of the line table's rule and for a reason: the reconciliation is a
 * few hundred SKUs at most and the whole set is already in the page, so a filter
 * sees every row rather than one server page. The totals row below states what
 * it is totalling so a filtered view can never be mistaken for the period total.
 *
 * Rows expand rather than navigate. The contributing ERP orders and spreadsheet
 * rows are what turn "this SKU is 510 units short" into something actionable,
 * and they are already loaded — a detail page would be a second round trip to
 * show data the browser is holding.
 */

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  columnFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
  // Registered individually rather than pulling in the whole `filterFns`
  // registry, which would bundle every built-in filter for the two we use.
  filterFns: {
    includesString: filterFn_includesString,
    equalsString: filterFn_equalsString,
  },
});

const helper = createColumnHelper<typeof features, SkuReconciliationRow>();

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

const STATUS_LABELS: Record<SkuMatchStatus, string> = {
  matched: "Matched",
  variance: "Variance",
  erpOnly: "ERP only",
  excelOnly: "Report only",
};

const STATUS_CLASSES: Record<SkuMatchStatus, string> = {
  matched: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  variance: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  erpOnly: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  excelOnly: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300",
};

function StatusBadge({ status }: { status: SkuMatchStatus }) {
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

/** A signed number. Zero reads as a dash, not as a suspicious "0". */
function Variance({
  value,
  money,
  percent,
}: {
  value: number | null;
  money?: boolean;
  percent?: boolean;
}) {
  if (value === null) return <span className="text-zinc-400">—</span>;
  if (value === 0) return <span className="text-zinc-400">0</span>;

  const text = percent
    ? pct.format(value)
    : money
      ? inr.format(value)
      : `${value > 0 ? "+" : ""}${num.format(value)}`;

  return (
    <span className={value > 0 ? "text-amber-600" : "text-blue-600"}>{text}</span>
  );
}

const columns = helper.columns([
  helper.accessor("productName", {
    header: "Product",
    // Substring rather than exact: a human types "beetroot", not the full name.
    filterFn: "includesString",
    cell: (info) => (
      <span className="block max-w-[22rem] truncate" title={info.getValue()}>
        {info.getValue()}
      </span>
    ),
  }),
  helper.accessor("sku", {
    header: "SKU",
    filterFn: "includesString",
    cell: (info) => <span className="font-mono text-xs">{info.getValue()}</span>,
  }),
  helper.accessor("erpOrders", {
    header: "ERP Orders",
    cell: (info) => num.format(info.getValue()),
  }),
  helper.accessor("erpQuantity", {
    header: "ERP Qty",
    cell: (info) => num.format(info.getValue()),
  }),
  helper.accessor("excelQuantity", {
    header: "Report Qty",
    cell: (info) => num.format(info.getValue()),
  }),
  helper.accessor("quantityVariance", {
    header: "Qty Var",
    cell: (info) => <Variance value={info.getValue()} />,
  }),
  helper.accessor("quantityVariancePct", {
    header: "Qty Var %",
    cell: (info) => <Variance value={info.getValue()} percent />,
  }),
  helper.accessor("erpRevenue", {
    header: "ERP Revenue",
    cell: (info) => inr.format(info.getValue()),
  }),
  helper.accessor("excelRevenue", {
    header: "Report Revenue",
    cell: (info) => inr.format(info.getValue()),
  }),
  helper.accessor("amountVariance", {
    header: "Rev Var",
    cell: (info) => <Variance value={info.getValue()} money />,
  }),
  helper.accessor("amountVariancePct", {
    header: "Rev Var %",
    cell: (info) => <Variance value={info.getValue()} percent />,
  }),
  helper.accessor("status", {
    // Exact: the status filter is a select built from the same values, so a
    // substring match could only ever be wrong in a way nobody would notice.
    filterFn: "equalsString",
    header: "Status",
    cell: (info) => <StatusBadge status={info.getValue()} />,
  }),
]);

/** The contributing rows behind one SKU, on both sides. */
function ProductDetail({ row }: { row: SkuReconciliationRow }) {
  return (
    <div className="grid gap-6 bg-zinc-50 px-4 py-4 text-sm md:grid-cols-2 dark:bg-zinc-900">
      <div>
        <h4 className="font-medium">
          ERP · {num.format(row.erpOrders)} order{row.erpOrders === 1 ? "" : "s"} ·{" "}
          {num.format(row.erpQuantity)} units · {inr.format(row.erpRevenue)}
        </h4>
        {row.erpOrderRefs.length === 0 ? (
          <p className="mt-2 text-zinc-500">
            No ERP sales-order line in this period carries this SKU.
          </p>
        ) : (
          <table className="mt-2 w-full">
            <thead className="text-left text-xs text-zinc-500">
              <tr>
                <th className="py-1 font-medium">SO</th>
                <th className="py-1 font-medium">Date</th>
                <th className="py-1 font-medium">Status</th>
                <th className="py-1 text-right font-medium">Qty</th>
                <th className="py-1 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {row.erpOrderRefs.map((order) => (
                <tr key={order.salesOrderId} className="border-t border-zinc-200 dark:border-zinc-800">
                  <td className="py-1 font-mono text-xs">{order.soNumber}</td>
                  <td className="py-1">{order.orderDate.slice(0, 10)}</td>
                  <td className="py-1">{order.status}</td>
                  <td className="py-1 text-right tabular-nums">{num.format(order.quantity)}</td>
                  <td className="py-1 text-right tabular-nums">{inr.format(order.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div>
        <h4 className="font-medium">
          Report · {num.format(row.excelRows)} row{row.excelRows === 1 ? "" : "s"} ·{" "}
          {num.format(row.excelQuantity)} units · {inr.format(row.excelRevenue)}
        </h4>
        {row.excelRowRefs.length === 0 ? (
          <p className="mt-2 text-zinc-500">
            No spreadsheet row reached this SKU.
          </p>
        ) : (
          <>
            <table className="mt-2 w-full">
              <thead className="text-left text-xs text-zinc-500">
                <tr>
                  <th className="py-1 font-medium">Row</th>
                  <th className="py-1 font-medium">Date</th>
                  <th className="py-1 text-right font-medium">Qty</th>
                  <th className="py-1 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {row.excelRowRefs.map((source) => (
                  <tr
                    key={source.sourceRow}
                    className="border-t border-zinc-200 dark:border-zinc-800"
                  >
                    <td className="py-1 tabular-nums">{source.sourceRow}</td>
                    <td className="py-1">{source.orderDate ?? "—"}</td>
                    <td className="py-1 text-right tabular-nums">
                      {source.quantity === null ? "—" : num.format(source.quantity)}
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {source.amount === null ? "—" : inr.format(source.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {row.excelRows > row.excelRowRefs.length ? (
              <p className="mt-2 text-xs text-zinc-500">
                Showing the first {num.format(row.excelRowRefs.length)} of{" "}
                {num.format(row.excelRows)} rows. The totals above cover all of them.
              </p>
            ) : null}
          </>
        )}
      </div>

      <div className="md:col-span-2">
        <h4 className="font-medium">Reconciliation</h4>
        <p className="mt-1">
          Quantity variance <Variance value={row.quantityVariance} /> (
          <Variance value={row.quantityVariancePct} percent />) · revenue variance{" "}
          <Variance value={row.amountVariance} money /> (
          <Variance value={row.amountVariancePct} percent />) ·{" "}
          <StatusBadge status={row.status} />
        </p>
        {!row.mappedToErp && row.excelRows > 0 ? (
          <p className="mt-1 text-amber-700 dark:text-amber-500">
            These spreadsheet rows never reached an ERP product, so this SKU is the
            marketplace&rsquo;s own identifier rather than the ERP&rsquo;s. Its
            quantity and revenue are counted, but no ERP figure can be compared
            against them.
          </p>
        ) : null}
      </div>
    </div>
  );
}

const STATUS_ORDER: SkuMatchStatus[] = ["matched", "variance", "erpOnly", "excelOnly"];

export function ReconciliationTable({ rows }: { rows: SkuReconciliationRow[] }) {
  // Memoised so a re-render does not hand the table a new array identity and
  // make it rebuild every row model.
  const data = useMemo(() => rows, [rows]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<SkuMatchStatus | "">("");

  // The second argument is v9's state selector: it declares which slices this
  // component rerenders on and is what puts them on `table.state`. There is no
  // `getState()` in v9.
  const table = useTable(
    {
      features,
      columns,
      data,
      initialState: { pagination: { pageIndex: 0, pageSize: 25 } },
    },
    (state) => ({
      pagination: state.pagination,
      columnFilters: state.columnFilters,
    }),
  );

  const { pageIndex, pageSize } = table.state.pagination;
  const visible = table.getPaginatedRowModel().rows;
  const filteredRows = table.getFilteredRowModel().rows;

  // Totals describe the filtered set, and the caption says so. A total that
  // silently means something other than the rows above it is how a number ends
  // up quoted back at you out of context.
  const totals = filteredRows.reduce(
    (acc, row) => ({
      erpQuantity: acc.erpQuantity + row.original.erpQuantity,
      excelQuantity: acc.excelQuantity + row.original.excelQuantity,
      erpRevenue: acc.erpRevenue + row.original.erpRevenue,
      excelRevenue: acc.excelRevenue + row.original.excelRevenue,
    }),
    { erpQuantity: 0, excelQuantity: 0, erpRevenue: 0, excelRevenue: 0 },
  );

  function setFilter(columnId: string, value: string) {
    table.getColumn(columnId)?.setFilterValue(value || undefined);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-500">Product</span>
          <input
            type="search"
            placeholder="beetroot chips"
            onChange={(event) => setFilter("productName", event.target.value)}
            className="w-56 rounded border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-500">SKU</span>
          <input
            type="search"
            placeholder="SKU-8JL6USE9"
            onChange={(event) => setFilter("sku", event.target.value)}
            className="w-48 rounded border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-500">Status</span>
          <select
            value={statusFilter}
            onChange={(event) => {
              const value = event.target.value as SkuMatchStatus | "";
              setStatusFilter(value);
              setFilter("status", value);
            }}
            className="rounded border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700"
          >
            <option value="">All</option>
            {STATUS_ORDER.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>

        <label className="ml-auto flex items-center gap-2 text-sm">
          <span className="text-zinc-500">Rows</span>
          <select
            value={pageSize}
            onChange={(event) => table.setPageSize(Number(event.target.value))}
            className="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
          >
            {[10, 25, 50, 100].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full min-w-[86rem] text-sm">
          <thead className="bg-zinc-50 text-left dark:bg-zinc-900">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                <th className="w-8 px-2 py-2" aria-label="Expand" />
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
            {visible.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  className="px-3 py-8 text-center text-zinc-500"
                >
                  {rows.length === 0
                    ? "Nothing to reconcile yet. Import a marketplace sheet and pick its marketplace."
                    : "No SKU matches these filters."}
                </td>
              </tr>
            ) : (
              visible.map((row) => {
                const isOpen = expanded === row.original.sku;
                return (
                  <Fragment key={row.id}>
                    <tr
                      className="cursor-pointer border-t border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                      onClick={() => setExpanded(isOpen ? null : row.original.sku)}
                    >
                      <td className="px-2 py-2 text-zinc-400">
                        {isOpen ? (
                          <ChevronDown className="h-4 w-4" aria-hidden />
                        ) : (
                          <ChevronRight className="h-4 w-4" aria-hidden />
                        )}
                      </td>
                      {row.getAllCells().map((cell) => (
                        <td key={cell.id} className="whitespace-nowrap px-3 py-2 tabular-nums">
                          <table.FlexRender cell={cell} />
                        </td>
                      ))}
                    </tr>
                    {isOpen ? (
                      <tr className="border-t border-zinc-200 dark:border-zinc-800">
                        <td colSpan={columns.length + 1} className="p-0">
                          <ProductDetail row={row.original} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })
            )}
          </tbody>
          {filteredRows.length > 0 ? (
            <tfoot className="border-t-2 border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900">
              <tr>
                <td colSpan={4} className="px-3 py-2 font-medium">
                  {filteredRows.length === rows.length
                    ? `All ${num.format(rows.length)} SKUs`
                    : `${num.format(filteredRows.length)} of ${num.format(rows.length)} SKUs (filtered)`}
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">
                  {num.format(totals.erpQuantity)}
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">
                  {num.format(totals.excelQuantity)}
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">
                  <Variance value={totals.excelQuantity - totals.erpQuantity} />
                </td>
                <td />
                <td className="px-3 py-2 text-right font-semibold tabular-nums">
                  {inr.format(totals.erpRevenue)}
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">
                  {inr.format(totals.excelRevenue)}
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">
                  <Variance value={totals.excelRevenue - totals.erpRevenue} money />
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          ) : null}
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
        <span className="ml-auto text-zinc-500">
          Click a row to see the contributing orders and spreadsheet rows.
        </span>
      </div>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createColumnHelper,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_includesString,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown, Search, SlidersHorizontal } from "lucide-react";

import type { SohProductRow } from "@/lib/report/soh-rows";
import { SELL_IN, SELL_OUT, SKU_STATUS_HINTS, SKU_STATUS_LABELS, STOCK_ON_HAND } from "@/lib/report/vocabulary";

/**
 * The report. Everything else on the page exists to frame this.
 *
 * TanStack Table v9: `useTable`, with row models registered as feature slots in
 * `tableFeatures`. v8's `useReactTable` + `getCoreRowModel()` does not exist
 * here and examples written against it will not compile.
 *
 * Filtering and sorting run client-side, which is right for this dataset and
 * would be wrong for the line-level one: a report is tens of products, the whole
 * set is already on the page, so a filter sees every row rather than one server
 * page. The footer states what it is totalling so a filtered view can never be
 * mistaken for the period total.
 *
 * Columns are deliberately few. Marketplace ids, revenue and provenance live in
 * the detail panel — a table that shows everything is a table nobody can read
 * across, and the row that matters is found by scanning, not by squinting.
 */

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  columnVisibilityFeature,
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
  filterFns: { includesString: filterFn_includesString },
});

const helper = createColumnHelper<typeof features, SohProductRow>();

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const num = new Intl.NumberFormat("en-IN");
const pct = new Intl.NumberFormat("en-IN", {
  style: "percent",
  maximumFractionDigits: 0,
  signDisplay: "exceptZero",
});

const STATUS_STYLES: Record<SohProductRow["status"], string> = {
  matched: "border-emerald-200 bg-emerald-50 text-emerald-700",
  variance: "border-amber-200 bg-amber-50 text-amber-800",
  erpOnly: "border-sky-200 bg-sky-50 text-sky-700",
  excelOnly: "border-violet-200 bg-violet-50 text-violet-700",
};

function StatusPill({ status }: { status: SohProductRow["status"] }) {
  return (
    <span
      title={SKU_STATUS_HINTS[status]}
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${STATUS_STYLES[status]}`}
    >
      {SKU_STATUS_LABELS[status]}
    </span>
  );
}

const MAPPING_STYLES: Record<SohProductRow["mapping"], string> = {
  confirmed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  matched: "border-zinc-200 bg-zinc-50 text-zinc-600",
  unresolved: "border-amber-200 bg-amber-50 text-amber-800",
  erpSide: "border-zinc-200 bg-zinc-50 text-zinc-500",
};

const MAPPING_LABELS: Record<SohProductRow["mapping"], string> = {
  confirmed: "Confirmed",
  matched: "Matched",
  unresolved: "Needs review",
  erpSide: "ERP product",
};

function MappingPill({ row }: { row: SohProductRow }) {
  return (
    <span
      title={row.mappingReason}
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${MAPPING_STYLES[row.mapping]}`}
    >
      {MAPPING_LABELS[row.mapping]}
    </span>
  );
}

/** A signed number. Zero reads as a muted dash, not a suspicious "0". */
function Delta({ value, money }: { value: number; money?: boolean }) {
  if (value === 0) return <span className="text-zinc-300">0</span>;
  return (
    <span className={value > 0 ? "text-amber-700" : "text-sky-700"}>
      {value > 0 ? "+" : "−"}
      {money ? inr.format(Math.abs(value)) : num.format(Math.abs(value))}
    </span>
  );
}

const columns = helper.columns([
  helper.accessor("productName", {
    header: "Product",
    filterFn: "includesString",
    cell: (info) => (
      <span className="block max-w-[26rem] truncate font-medium text-zinc-900" title={info.getValue()}>
        {info.getValue()}
      </span>
    ),
  }),
  helper.accessor("sku", {
    header: "SKU",
    filterFn: "includesString",
    cell: (info) => (
      <span className="block max-w-[14rem] truncate font-mono text-[11px] text-zinc-500" title={info.getValue()}>
        {info.getValue()}
      </span>
    ),
  }),
  helper.accessor("ean", {
    header: "EAN",
    filterFn: "includesString",
    cell: (info) => (
      <span className="font-mono text-[11px] text-zinc-500">{info.getValue() ?? "—"}</span>
    ),
  }),
  helper.accessor("stockAvailable", {
    header: STOCK_ON_HAND.label,
    cell: (info) =>
      info.getValue() === null ? (
        <span className="text-zinc-300" title="No live stock position for this product">
          —
        </span>
      ) : (
        num.format(info.getValue()!)
      ),
  }),
  helper.accessor("sellIn", {
    header: SELL_IN.label,
    cell: (info) => num.format(info.getValue()),
  }),
  helper.accessor("sellOut", {
    header: SELL_OUT.label,
    cell: (info) => num.format(info.getValue()),
  }),
  helper.accessor("quantityVariance", {
    header: "Variance",
    cell: (info) => <Delta value={info.getValue()} />,
  }),
  helper.accessor("quantityVariancePct", {
    header: "Var %",
    cell: (info) =>
      info.getValue() === null ? (
        <span className="text-zinc-300">—</span>
      ) : (
        <span className={info.getValue()! > 0 ? "text-amber-700" : "text-sky-700"}>
          {pct.format(info.getValue()!)}
        </span>
      ),
  }),
  helper.accessor("status", {
    header: "Status",
    cell: (info) => <StatusPill status={info.getValue()} />,
  }),
  helper.accessor("mapping", {
    header: "Mapping",
    cell: (info) => <MappingPill row={info.row.original} />,
  }),
]);

/** Columns a reader can turn off. Identity and the headline numbers stay. */
const OPTIONAL_COLUMNS: { id: string; label: string }[] = [
  { id: "ean", label: "EAN" },
  { id: "stockAvailable", label: STOCK_ON_HAND.label },
  { id: "quantityVariancePct", label: "Var %" },
  { id: "mapping", label: "Mapping" },
];

type StatusFilter = "" | SohProductRow["status"];
type VarianceFilter = "" | "any" | "over" | "under";

export function SohTable({
  rows,
  onSelect,
  selectedSku,
}: {
  rows: SohProductRow[];
  onSelect: (row: SohProductRow) => void;
  selectedSku: string | null;
}) {
  // Memoised so a re-render does not hand the table a new array identity and
  // make it rebuild every row model.
  const data = useMemo(() => rows, [rows]);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [variance, setVariance] = useState<VarianceFilter>("");
  const [showColumns, setShowColumns] = useState(false);

  // Applied before the table sees the data. Variance direction is not a column
  // value, so it cannot be a column filter without inventing a hidden column.
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return data.filter((row) => {
      if (status && row.status !== status) return false;
      if (variance === "any" && row.quantityVariance === 0) return false;
      if (variance === "over" && row.quantityVariance <= 0) return false;
      if (variance === "under" && row.quantityVariance >= 0) return false;
      if (!needle) return true;
      return (
        row.productName.toLowerCase().includes(needle) ||
        row.sku.toLowerCase().includes(needle) ||
        (row.ean ?? "").toLowerCase().includes(needle) ||
        (row.marketplaceItemId ?? "").toLowerCase().includes(needle)
      );
    });
  }, [data, search, status, variance]);

  // The second argument is v9's state selector: it declares which slices this
  // component rerenders on and is what puts them on `table.state`. There is no
  // `getState()` in v9.
  const table = useTable(
    {
      features,
      columns,
      data: filtered,
      initialState: { pagination: { pageIndex: 0, pageSize: 25 } },
    },
    (state) => ({
      pagination: state.pagination,
      sorting: state.sorting,
      columnVisibility: state.columnVisibility,
    }),
  );

  const { pageIndex, pageSize } = table.state.pagination;
  const visible = table.getPaginatedRowModel().rows;

  const totals = filtered.reduce(
    (acc, row) => ({
      sellIn: acc.sellIn + row.sellIn,
      sellOut: acc.sellOut + row.sellOut,
      stock: acc.stock + (row.stockAvailable ?? 0),
    }),
    { sellIn: 0, sellOut: 0, stock: 0 },
  );

  const isFiltered = filtered.length !== rows.length;
  const visibility = table.state.columnVisibility ?? {};

  return (
    <section className="flex flex-col">
      <div className="flex flex-wrap items-center gap-2 border border-b-0 border-zinc-200 bg-white px-3 py-2.5">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400"
            aria-hidden
          />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search product, SKU, EAN or marketplace ID"
            aria-label="Search products"
            className="h-8 w-80 rounded border border-zinc-200 bg-white pr-2 pl-8 text-[13px] text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
          />
        </div>

        <select
          value={status}
          onChange={(event) => setStatus(event.target.value as StatusFilter)}
          aria-label="Filter by status"
          className="h-8 rounded border border-zinc-200 bg-white px-2 text-[13px] text-zinc-700 focus:border-zinc-400 focus:outline-none"
        >
          <option value="">All statuses</option>
          {(["matched", "variance", "erpOnly", "excelOnly"] as const).map((value) => (
            <option key={value} value={value}>
              {SKU_STATUS_LABELS[value]}
            </option>
          ))}
        </select>

        <select
          value={variance}
          onChange={(event) => setVariance(event.target.value as VarianceFilter)}
          aria-label="Filter by variance"
          className="h-8 rounded border border-zinc-200 bg-white px-2 text-[13px] text-zinc-700 focus:border-zinc-400 focus:outline-none"
        >
          <option value="">Any variance</option>
          <option value="any">Non-zero only</option>
          <option value="over">Sell-out above sell-in</option>
          <option value="under">Sell-in above sell-out</option>
        </select>

        {isFiltered ? (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setStatus("");
              setVariance("");
            }}
            className="h-8 rounded px-2 text-[13px] text-zinc-500 hover:text-zinc-900"
          >
            Clear
          </button>
        ) : null}

        <div className="relative ml-auto">
          <button
            type="button"
            onClick={() => setShowColumns((open) => !open)}
            className="inline-flex h-8 items-center gap-1.5 rounded border border-zinc-200 px-2 text-[13px] text-zinc-600 hover:bg-zinc-50"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
            Columns
          </button>
          {showColumns ? (
            <div className="absolute right-0 z-20 mt-1 w-52 rounded border border-zinc-200 bg-white p-1 shadow-sm">
              {OPTIONAL_COLUMNS.map((column) => (
                <label
                  key={column.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[13px] hover:bg-zinc-50"
                >
                  <input
                    type="checkbox"
                    checked={visibility[column.id] !== false}
                    onChange={(event) =>
                      table.setColumnVisibility({
                        ...visibility,
                        [column.id]: event.target.checked,
                      })
                    }
                  />
                  {column.label}
                </label>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="max-h-[calc(100vh-18rem)] min-h-[16rem] overflow-auto border border-zinc-200 bg-white">
        <table className="w-full min-w-[68rem] border-collapse text-[13px]">
          <thead className="sticky-head">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header, columnIndex) => {
                  const sorted = header.column.getIsSorted();
                  const numeric = columnIndex >= 3 && columnIndex <= 7;
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      onClick={() => header.column.toggleSorting()}
                      className={`cursor-pointer border-b border-zinc-200 bg-zinc-50 px-3 py-2 font-medium tracking-wide text-zinc-500 uppercase select-none hover:text-zinc-900 ${
                        numeric ? "text-right" : "text-left"
                      }`}
                      style={{ fontSize: "11px" }}
                    >
                      <span
                        className={`inline-flex items-center gap-1 ${numeric ? "flex-row-reverse" : ""}`}
                      >
                        {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                        {sorted === "asc" ? (
                          <ArrowUp className="h-3 w-3" aria-hidden />
                        ) : sorted === "desc" ? (
                          <ArrowDown className="h-3 w-3" aria-hidden />
                        ) : (
                          <ChevronsUpDown className="h-3 w-3 text-zinc-300" aria-hidden />
                        )}
                      </span>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>

          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-16 text-center text-zinc-500"
                >
                  {rows.length === 0
                    ? "This report has no products."
                    : "No product matches these filters."}
                </td>
              </tr>
            ) : (
              visible.map((row) => {
                const selected = row.original.sku === selectedSku;
                return (
                  <tr
                    key={row.id}
                    onClick={() => onSelect(row.original)}
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelect(row.original);
                      }
                    }}
                    className={`cursor-pointer border-b border-zinc-100 focus:outline-none ${
                      selected ? "bg-zinc-100" : "hover:bg-zinc-50 focus:bg-zinc-50"
                    }`}
                  >
                    {row.getAllCells().map((cell, columnIndex) => (
                      <td
                        key={cell.id}
                        className={`px-3 py-2 whitespace-nowrap ${
                          columnIndex >= 3 && columnIndex <= 7
                            ? "text-right text-zinc-700"
                            : "text-zinc-700"
                        }`}
                      >
                        <table.FlexRender cell={cell} />
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>

          {filtered.length > 0 ? (
            <tfoot>
              <tr className="border-t border-zinc-300 bg-zinc-50 font-medium text-zinc-900">
                <td className="px-3 py-2" colSpan={3}>
                  {isFiltered
                    ? `${num.format(filtered.length)} of ${num.format(rows.length)} products (filtered)`
                    : `${num.format(rows.length)} products`}
                </td>
                {visibility.stockAvailable === false ? null : (
                  <td className="px-3 py-2 text-right">{num.format(totals.stock)}</td>
                )}
                <td className="px-3 py-2 text-right">{num.format(totals.sellIn)}</td>
                <td className="px-3 py-2 text-right">{num.format(totals.sellOut)}</td>
                <td className="px-3 py-2 text-right">
                  <Delta value={totals.sellOut - totals.sellIn} />
                </td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3 border border-t-0 border-zinc-200 bg-white px-3 py-2 text-[13px] text-zinc-500">
        <span>
          Page {pageIndex + 1} of {Math.max(1, table.getPageCount())}
        </span>
        <button
          type="button"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
          className="rounded border border-zinc-200 px-2 py-1 text-zinc-700 disabled:opacity-40 hover:enabled:bg-zinc-50"
        >
          Previous
        </button>
        <button
          type="button"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
          className="rounded border border-zinc-200 px-2 py-1 text-zinc-700 disabled:opacity-40 hover:enabled:bg-zinc-50"
        >
          Next
        </button>

        <label className="ml-auto flex items-center gap-2">
          Rows
          <select
            value={pageSize}
            onChange={(event) => table.setPageSize(Number(event.target.value))}
            className="rounded border border-zinc-200 bg-white px-1.5 py-1 text-zinc-700 focus:outline-none"
          >
            {[25, 50, 100].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <span className="text-zinc-400">Select a row for product detail</span>
      </div>
    </section>
  );
}

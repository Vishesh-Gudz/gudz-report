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
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown, Search, SlidersHorizontal } from "lucide-react";

import { totalsFor, type SnapshotRow } from "@/lib/report/snapshot-model";
import {
  CURRENT_SOH,
  DAMAGE,
  GRN,
  MAPPING_LABELS,
  RETURNED,
  SALES_QUANTITY,
} from "@/lib/report/vocabulary";

/**
 * The report: marketplace, product and month, one row each.
 *
 * TanStack Table v9 — `useTable`, with row models registered as feature slots in
 * `tableFeatures`. v8's `useReactTable` + `getCoreRowModel()` does not exist
 * here and examples written against it will not compile.
 *
 * Filtering and sorting run client-side, which is right for this dataset: the
 * snapshot is an aggregate of a few hundred rows and all of it is on the page,
 * so a filter sees every row rather than one server page. The footer states what
 * it is totalling so a filtered view is never mistaken for the whole report.
 *
 * A missing figure is an em dash, never a zero. `—` under GRN means no goods
 * receipt was raised; `0` would mean one was raised and recorded nothing.
 */

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  columnFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  columnVisibilityFeature,
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
  filterFns: { includesString: filterFn_includesString },
});

const helper = createColumnHelper<typeof features, SnapshotRow>();

const num = new Intl.NumberFormat("en-IN");

const MAPPING_STYLES: Record<SnapshotRow["mappingStatus"], string> = {
  confirmed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  matched: "border-zinc-200 bg-zinc-50 text-zinc-600",
  unresolved: "border-amber-200 bg-amber-50 text-amber-800",
};

function MappingPill({ row }: { row: SnapshotRow }) {
  return (
    <span
      title={row.mappingReason}
      className={`inline-flex items-center rounded border px-1.5 py-px text-[10.5px] font-medium whitespace-nowrap ${MAPPING_STYLES[row.mappingStatus]}`}
    >
      {MAPPING_LABELS[row.mappingStatus]}
    </span>
  );
}

/** A figure, or an em dash when the source holds nothing at all. */
function Figure({ value, title }: { value: number | null; title?: string }) {
  if (value === null) {
    return (
      <span className="text-zinc-300" title={title}>
        —
      </span>
    );
  }
  return <>{num.format(value)}</>;
}

/** `2026-06` reads as `Jun 2026`, while sorting on the underlying value. */
export function monthLabel(month: string): string {
  if (month === "undated") return "Undated";
  const date = new Date(`${month}-01T00:00:00.000Z`);
  return Number.isNaN(date.getTime())
    ? month
    : date.toLocaleDateString("en-GB", {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
}

const columns = helper.columns([
  helper.accessor("marketplace", {
    header: "Marketplace",
    filterFn: "includesString",
    cell: (info) => (
      <span className="font-medium text-zinc-700 capitalize">{info.getValue()}</span>
    ),
  }),
  helper.accessor("productName", {
    header: "Product",
    filterFn: "includesString",
    cell: (info) => (
      <span
        className="block max-w-[24rem] truncate font-medium text-zinc-900"
        title={info.getValue()}
      >
        {info.getValue()}
      </span>
    ),
  }),
  helper.accessor("sku", {
    header: "SKU",
    filterFn: "includesString",
    cell: (info) => (
      <span
        className="block max-w-[13rem] truncate font-mono text-[11px] text-zinc-500"
        title={info.getValue()}
      >
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
  helper.accessor("month", {
    header: "Month",
    cell: (info) => (
      <span className="whitespace-nowrap text-zinc-700">{monthLabel(info.getValue())}</span>
    ),
  }),
  helper.accessor("currentSoh", {
    header: CURRENT_SOH.label,
    cell: (info) => (
      <Figure
        value={info.getValue()}
        title="No live stock position is held for this product"
      />
    ),
  }),
  helper.accessor("grn", {
    header: GRN.label,
    cell: (info) => (
      <Figure
        value={info.getValue()}
        title="Nothing was invoiced for this product in this month"
      />
    ),
  }),
  helper.accessor("salesQuantity", {
    header: SALES_QUANTITY.label,
    cell: (info) => num.format(info.getValue()),
  }),
  helper.accessor("damage", {
    header: DAMAGE.label,
    cell: (info) => num.format(info.getValue()),
  }),
  helper.accessor("returned", {
    header: RETURNED.label,
    cell: (info) => num.format(info.getValue()),
  }),
  helper.accessor("mappingStatus", {
    header: "Status",
    cell: (info) => <MappingPill row={info.row.original} />,
  }),
]);

/** Columns a reader can turn off. Identity and the measures stay. */
const OPTIONAL_COLUMNS = [
  { id: "ean", label: "EAN" },
  { id: "damage", label: DAMAGE.label },
  { id: "returned", label: RETURNED.label },
] as const;

/** Numeric columns, right aligned. */
const FIRST_NUMERIC = 5;
const LAST_NUMERIC = 9;

export function SohTable({
  rows,
  marketplaces,
  marketplace,
  onMarketplaceChange,
  months,
  month,
  onMonthChange,
  onSelect,
  selectedId,
}: {
  rows: SnapshotRow[];
  marketplaces: string[];
  marketplace: string;
  onMarketplaceChange: (value: string) => void;
  months: string[];
  month: string;
  onMonthChange: (value: string) => void;
  onSelect: (row: SnapshotRow) => void;
  selectedId: string | null;
}) {
  // Memoised so a re-render does not hand the table a new array identity and
  // make it rebuild every row model.
  const data = useMemo(() => rows, [rows]);

  const [search, setSearch] = useState("");
  const [needsReview, setNeedsReview] = useState(false);
  const [showColumns, setShowColumns] = useState(false);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return data.filter((row) => {
      if (needsReview && row.mappingStatus !== "unresolved") return false;
      if (!needle) return true;
      return (
        row.productName.toLowerCase().includes(needle) ||
        row.sku.toLowerCase().includes(needle) ||
        row.marketplace.toLowerCase().includes(needle) ||
        (row.ean ?? "").toLowerCase().includes(needle) ||
        (row.marketplaceItemId ?? "").toLowerCase().includes(needle)
      );
    });
  }, [data, search, needsReview]);

  // The second argument is v9's state selector: it declares which slices this
  // component rerenders on and is what puts them on `table.state`. There is no
  // `getState()` in v9.
  const table = useTable(
    {
      features,
      columns,
      data: filtered,
      initialState: { pagination: { pageIndex: 0, pageSize: 50 } },
    },
    (state) => ({
      pagination: state.pagination,
      sorting: state.sorting,
      columnVisibility: state.columnVisibility,
    }),
  );

  const { pageIndex, pageSize } = table.state.pagination;
  const visible = table.getPaginatedRowModel().rows;
  const totals = totalsFor(filtered);
  const isFiltered = filtered.length !== rows.length;
  const visibility = table.state.columnVisibility ?? {};

  return (
    <section className="flex flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-white px-5 py-2.5">
        {marketplaces.length > 1 ? (
          <select
            value={marketplace}
            onChange={(event) => onMarketplaceChange(event.target.value)}
            aria-label="Filter by marketplace"
            className="h-7 rounded border border-zinc-200 bg-white px-2 text-[12px] font-medium text-zinc-900 capitalize hover:border-zinc-300"
          >
            <option value="">All marketplaces</option>
            {marketplaces.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        ) : null}

        {months.length > 1 ? (
          <select
            value={month}
            onChange={(event) => onMonthChange(event.target.value)}
            aria-label="Filter by month"
            className="h-7 rounded border border-zinc-200 bg-white px-2 text-[12px] text-zinc-700 hover:border-zinc-300"
          >
            <option value="">All months</option>
            {months.map((value) => (
              <option key={value} value={value}>
                {monthLabel(value)}
              </option>
            ))}
          </select>
        ) : null}

        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-2 h-3 w-3 -translate-y-1/2 text-zinc-400"
            aria-hidden
          />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search products"
            aria-label="Search products"
            className="h-7 w-64 rounded border border-zinc-200 bg-white pr-2 pl-7 text-[12px] text-zinc-900 placeholder:text-zinc-400 hover:border-zinc-300"
          />
        </div>

        <label className="flex items-center gap-1.5 text-[12px] text-zinc-700">
          <input
            type="checkbox"
            checked={needsReview}
            onChange={(event) => setNeedsReview(event.target.checked)}
            className="h-3.5 w-3.5 accent-zinc-900"
          />
          Needs Review
        </label>

        {isFiltered || marketplace || month ? (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setNeedsReview(false);
              onMarketplaceChange("");
              onMonthChange("");
            }}
            className="h-7 rounded px-1.5 text-[12px] text-zinc-500 hover:text-zinc-900"
          >
            Clear
          </button>
        ) : null}

        <div className="relative ml-auto">
          <button
            type="button"
            onClick={() => setShowColumns((open) => !open)}
            className="inline-flex h-7 items-center gap-1.5 rounded border border-zinc-200 px-2 text-[12px] text-zinc-600 hover:bg-zinc-50"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
            Columns
          </button>
          {showColumns ? (
            <div className="absolute right-0 z-20 mt-1 w-48 rounded border border-zinc-200 bg-white p-1 shadow-sm">
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

      <div className="max-h-[calc(100vh-19rem)] min-h-[18rem] overflow-auto bg-white">
        <table className="w-full min-w-[68rem] border-collapse text-[12.5px]">
          <thead className="sticky-head">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header, columnIndex) => {
                  const sorted = header.column.getIsSorted();
                  const numeric =
                    columnIndex >= FIRST_NUMERIC && columnIndex <= LAST_NUMERIC;
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      onClick={() => header.column.toggleSorting()}
                      className={`cursor-pointer border-b border-zinc-200 bg-zinc-50 px-3 py-1.5 text-[10.5px] font-medium tracking-wide text-zinc-500 uppercase select-none hover:text-zinc-900 ${
                        numeric ? "text-right" : "text-left"
                      }`}
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
                <td colSpan={columns.length} className="px-3 py-20 text-center text-[13px] text-zinc-500">
                  {rows.length === 0
                    ? "This report has no rows."
                    : "No row matches these filters."}
                </td>
              </tr>
            ) : (
              visible.map((row) => {
                const selected = row.original.id === selectedId;
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
                        className={`px-3 py-[5px] whitespace-nowrap text-zinc-700 ${
                          columnIndex >= FIRST_NUMERIC && columnIndex <= LAST_NUMERIC
                            ? "text-right"
                            : ""
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
                <td className="px-3 py-1.5" colSpan={FIRST_NUMERIC}>
                  {isFiltered
                    ? `${num.format(filtered.length)} of ${num.format(rows.length)} rows (filtered)`
                    : `${num.format(rows.length)} rows`}
                </td>
                <td className="px-3 py-1.5 text-right">
                  <Figure value={totals.currentSoh} />
                </td>
                <td className="px-3 py-1.5 text-right">
                  <Figure value={totals.grn} />
                </td>
                <td className="px-3 py-1.5 text-right">{num.format(totals.salesQuantity)}</td>
                <td className="px-3 py-1.5 text-right">{num.format(totals.damage)}</td>
                <td className="px-3 py-1.5 text-right">{num.format(totals.returned)}</td>
                <td />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2.5 border-t border-zinc-200 bg-white px-5 py-2 text-[12px] text-zinc-500">
        <span>
          Page {pageIndex + 1} of {Math.max(1, table.getPageCount())}
        </span>
        <button
          type="button"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
          className="rounded border border-zinc-200 px-2 py-0.5 text-zinc-700 disabled:opacity-40 hover:enabled:bg-zinc-50"
        >
          Previous
        </button>
        <button
          type="button"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
          className="rounded border border-zinc-200 px-2 py-0.5 text-zinc-700 disabled:opacity-40 hover:enabled:bg-zinc-50"
        >
          Next
        </button>

        <label className="ml-auto flex items-center gap-2">
          Rows
          <select
            value={pageSize}
            onChange={(event) => table.setPageSize(Number(event.target.value))}
            className="rounded border border-zinc-200 bg-white px-1 py-0.5 text-zinc-700"
          >
            {[25, 50, 100, 250].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}

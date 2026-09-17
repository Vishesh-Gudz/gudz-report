"use client";

import {
  tableFeatures,
  useTable,
  type TableFeatures,
  type TableOptions,
} from "@tanstack/react-table";

/**
 * A headless table wrapper.
 *
 * TanStack Table v9, not v8: the constructor is `useTable` and optional row
 * models are registered as feature slots inside `tableFeatures` rather than
 * passed as table options. v8's `useReactTable` + `getCoreRowModel()` does not
 * exist here, and examples written against it will not compile.
 *
 * The table options are passed through as one object rather than spread into
 * individual props. v9 validates that a feature's row-model slot is registered
 * alongside the feature itself, and that constraint is encoded in
 * `TableOptions` as an intersection — destructuring it into a rest object
 * erases the intersection, and the table stops type-checking its own
 * configuration.
 */

export interface DataTableProps<
  TFeatures extends TableFeatures,
  TData extends Record<string, unknown>,
> {
  readonly options: TableOptions<TFeatures, TData>;
  /** Shown when there are no rows. An empty table with no message reads as broken. */
  readonly emptyMessage?: string;
}

export function DataTable<
  TFeatures extends TableFeatures,
  TData extends Record<string, unknown>,
>({ options, emptyMessage = "No rows." }: DataTableProps<TFeatures, TData>) {
  const table = useTable(options);
  const rows = table.getRowModel().rows;
  const columnCount = options.columns.length;

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 text-left dark:bg-zinc-900">
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => (
                <th
                  key={header.id}
                  scope="col"
                  className="px-4 py-2 font-medium text-zinc-600 dark:text-zinc-400"
                >
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columnCount} className="px-4 py-6 text-center text-zinc-500">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id} className="border-t border-zinc-200 dark:border-zinc-800">
                {row.getAllCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-2">
                    <table.FlexRender cell={cell} />
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/** The default feature set: core models only, no sorting or filtering. */
export const baseTableFeatures = tableFeatures({});

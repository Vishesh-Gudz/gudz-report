import type { ReportModel } from "@/lib/report/aggregate";

/**
 * Report filters.
 *
 * A plain GET form, no client JavaScript. Filters live in the URL, which means
 * the date range reaches the server before the ERP is queried — so changing it
 * refetches ERP data for the new period rather than filtering a set that was
 * fetched for the old one. A client-side date filter would silently show
 * whatever happened to be loaded and disagree with the KPI cards.
 *
 * It also makes a filtered view shareable and reloadable, which is what someone
 * reconciling a month actually wants.
 */

export interface FilterValues {
  from: string;
  to: string;
  marketplace?: string;
  customer?: string;
  sku?: string;
  product?: string;
  status?: string;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  "rounded border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700";

export function ReportFiltersForm({
  values,
  model,
}: {
  values: FilterValues;
  model: ReportModel;
}) {
  return (
    <form
      method="get"
      className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
    >
      <Field label="From">
        <input type="date" name="from" defaultValue={values.from} className={inputClass} />
      </Field>
      <Field label="To">
        <input type="date" name="to" defaultValue={values.to} className={inputClass} />
      </Field>

      <Field label="Marketplace">
        <select name="marketplace" defaultValue={values.marketplace ?? ""} className={inputClass}>
          <option value="">All</option>
          {model.marketplaces.map((marketplace) => (
            <option key={marketplace} value={marketplace}>
              {marketplace}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Status">
        <select name="status" defaultValue={values.status ?? ""} className={inputClass}>
          <option value="">All reportable</option>
          {model.statuses.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Customer">
        <input
          type="text"
          name="customer"
          defaultValue={values.customer ?? ""}
          placeholder="contains…"
          className={inputClass}
        />
      </Field>

      <Field label="SKU">
        <input
          type="text"
          name="sku"
          defaultValue={values.sku ?? ""}
          placeholder="contains…"
          className={inputClass}
        />
      </Field>

      <Field label="Product">
        <input
          type="text"
          name="product"
          defaultValue={values.product ?? ""}
          placeholder="contains…"
          className={inputClass}
        />
      </Field>

      <button
        type="submit"
        className="rounded bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
      >
        Apply
      </button>
      <a
        href="/dashboard"
        className="px-2 py-1.5 text-sm text-zinc-500 underline underline-offset-4"
      >
        Reset
      </a>
    </form>
  );
}

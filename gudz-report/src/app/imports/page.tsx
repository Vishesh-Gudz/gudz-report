import Link from "next/link";
import { anyApi } from "convex/server";

import { UploadForm } from "@/components/imports/upload-form";
import { getConvexClient, isConvexConfigured } from "@/lib/convex/server";

export const metadata = { title: "Imports · Gudz Report" };
export const dynamic = "force-dynamic";

interface ImportDoc {
  _id: string;
  fileName: string;
  uploadedAt: number;
  status: string;
  minDate: string | null;
  maxDate: string | null;
  totalRows: number;
  validRows: number;
  invalidRows: number;
}

const num = new Intl.NumberFormat("en-IN");

/** Import history, when Convex is available. Absence is reported, not hidden. */
async function loadImports(): Promise<{ rows: ImportDoc[]; error: string | null }> {
  const client = getConvexClient();
  if (!client) return { rows: [], error: null };
  try {
    const rows = (await client.query(anyApi.imports.list as never, {
      limit: 25,
    } as never)) as ImportDoc[];
    return { rows, error: null };
  } catch (cause) {
    return {
      rows: [],
      error: cause instanceof Error ? cause.message : "Could not read imports",
    };
  }
}

export default async function ImportsPage() {
  const { rows, error } = await loadImports();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Excel Imports</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            A marketplace workbook is parsed and normalized on the server. Its date
            range becomes the reporting period the ERP is queried for.
          </p>
        </div>
        <Link href="/dashboard" className="text-sm underline underline-offset-4">
          Go to dashboard
        </Link>
      </div>

      {!isConvexConfigured() ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950">
          <p className="font-medium">Convex is not configured</p>
          <p className="mt-1">
            Uploads are parsed and validated, and the detected period is reported,
            but nothing is saved and the dashboard cannot reconcile against them.
            Run <code>npx convex dev</code> to enable persistence.
          </p>
        </div>
      ) : null}

      {error ? (
        <p className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm dark:border-red-900 dark:bg-red-950">
          Could not read import history: {error}
        </p>
      ) : null}

      <UploadForm />

      {rows.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Previous imports</h2>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left dark:bg-zinc-900">
                <tr>
                  {["File", "Uploaded", "Status", "Period", "Rows", "Invalid", ""].map(
                    (header) => (
                      <th key={header} className="px-3 py-2 font-medium text-zinc-600 dark:text-zinc-400">
                        {header}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row._id} className="border-t border-zinc-200 dark:border-zinc-800">
                    <td className="px-3 py-2">{row.fileName}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {new Date(row.uploadedAt).toISOString().slice(0, 16).replace("T", " ")}
                    </td>
                    <td className="px-3 py-2">{row.status}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {row.minDate && row.maxDate ? `${row.minDate} → ${row.maxDate}` : "—"}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{num.format(row.totalRows)}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {row.invalidRows > 0 ? (
                        <span className="text-amber-600">{num.format(row.invalidRows)}</span>
                      ) : (
                        0
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {row.minDate && row.maxDate ? (
                        <Link
                          href={`/dashboard?from=${row.minDate}&to=${row.maxDate}&importId=${row._id}`}
                          className="underline underline-offset-4"
                        >
                          Report
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </main>
  );
}

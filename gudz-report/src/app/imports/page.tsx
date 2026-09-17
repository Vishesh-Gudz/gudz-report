import Link from "next/link";

import { ExampleTable } from "@/components/tables/example-table";

export const metadata = {
  title: "Imports · Gudz Report",
};

export default function ImportsPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Excel Imports</h1>

      <p className="text-zinc-600 dark:text-zinc-400">
        A marketplace workbook is uploaded here, parsed and normalized in Convex,
        and its date range becomes the reporting period the ERP is queried for.
      </p>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-zinc-500">
          Table layer check — placeholder data, not ERP data
        </h2>
        <ExampleTable />
      </section>

      <Link
        href="/dashboard"
        className="self-start text-sm font-medium underline underline-offset-4"
      >
        Go to dashboard
      </Link>
    </main>
  );
}

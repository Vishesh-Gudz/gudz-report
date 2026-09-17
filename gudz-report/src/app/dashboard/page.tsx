import Link from "next/link";

export const metadata = {
  title: "Dashboard · Gudz Report",
};

export default function DashboardPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-12">
      <div>
        <p className="text-sm font-medium text-zinc-500">Healthy Master</p>
        <h1 className="text-2xl font-semibold tracking-tight">B2B Sales Report</h1>
      </div>

      <p className="text-zinc-600 dark:text-zinc-400">
        The report is built once a workbook has been imported and reconciled
        against the ERP for the same reporting period.
      </p>

      <Link
        href="/imports"
        className="self-start text-sm font-medium underline underline-offset-4"
      >
        Go to imports
      </Link>
    </main>
  );
}

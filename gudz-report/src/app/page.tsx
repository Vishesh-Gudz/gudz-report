import Link from "next/link";
import { FileSpreadsheet, LayoutDashboard } from "lucide-react";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 px-6 py-16">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Gudz Report</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Marketplace sales reconciled against ERP B2B sales orders.
        </p>
      </div>

      <nav className="flex flex-col gap-3">
        <Link
          href="/dashboard"
          className="flex items-center gap-3 rounded-lg border border-zinc-200 px-4 py-3 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
        >
          <LayoutDashboard className="h-5 w-5 text-zinc-500" aria-hidden />
          <span className="font-medium">Dashboard</span>
        </Link>

        <Link
          href="/imports"
          className="flex items-center gap-3 rounded-lg border border-zinc-200 px-4 py-3 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
        >
          <FileSpreadsheet className="h-5 w-5 text-zinc-500" aria-hidden />
          <span className="font-medium">Imports</span>
        </Link>
      </nav>
    </main>
  );
}

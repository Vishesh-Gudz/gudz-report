"use client";

import { useRouter } from "next/navigation";

import { ReportActions } from "./report-actions";
import type { SohProductRow } from "@/lib/report/soh-rows";

/**
 * The frame around the report: who it is for, what it covers, what you can do.
 *
 * A client component only because the actions need a router. Everything it
 * displays is computed on the server and handed down, so nothing here can
 * disagree with the table below it.
 */

function formatDay(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(date.getTime())
    ? day
    : date.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
}

export function ReportShell({
  title,
  subtitle,
  marketplace,
  period,
  sourceFileName,
  rows,
  children,
}: {
  title: string;
  subtitle: string;
  marketplace: string | null;
  period: { from: string; to: string };
  sourceFileName: string | null;
  rows: SohProductRow[];
  children: React.ReactNode;
}) {
  const router = useRouter();

  return (
    <div className="flex min-h-full flex-col bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex w-full max-w-[100rem] flex-wrap items-end justify-between gap-4 px-6 py-5">
          <div className="min-w-0">
            <p className="text-[12px] font-medium tracking-wide text-zinc-500 uppercase">
              Healthy Master
            </p>
            <h1 className="mt-0.5 text-[20px] leading-tight font-semibold tracking-tight text-zinc-900">
              {title}
            </h1>
            <p className="mt-1 text-[13px] text-zinc-500">{subtitle}</p>
          </div>

          <div className="flex flex-wrap items-end gap-6">
            <dl className="flex gap-6">
              <div>
                <dt className="text-[11px] tracking-wide text-zinc-500 uppercase">
                  Marketplace
                </dt>
                <dd className="mt-0.5 text-[14px] font-medium text-zinc-900 capitalize">
                  {marketplace ?? "Not selected"}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] tracking-wide text-zinc-500 uppercase">
                  Reporting period
                </dt>
                <dd className="mt-0.5 text-[14px] font-medium text-zinc-900">
                  {formatDay(period.from)} — {formatDay(period.to)}
                </dd>
                {sourceFileName ? (
                  <dd className="mt-0.5 max-w-[16rem] truncate text-[11px] text-zinc-400" title={sourceFileName}>
                    from {sourceFileName}
                  </dd>
                ) : null}
              </div>
            </dl>

            <ReportActions
              rows={rows}
              marketplace={marketplace ?? "marketplace"}
              period={period}
              onChangeReport={() => router.push("/?upload=1")}
            />
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[100rem] flex-1 flex-col gap-5 px-6 py-6">
        {children}
      </main>

      <footer className="border-t border-zinc-200 bg-white">
        <div className="mx-auto w-full max-w-[100rem] px-6 py-3 text-[11px] text-zinc-400">
          Sell-in from ERP B2B sales orders · sell-out from the uploaded
          marketplace report · stock from ERP live balances
        </div>
      </footer>
    </div>
  );
}

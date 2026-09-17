"use client";

import { useRouter } from "next/navigation";

import { ReportActions } from "./report-actions";
import type { ReportingPeriod } from "@/lib/dates/reporting-period";
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
  marketplaceLabel,
  period,
  periodsDiffer,
  sourceFileName,
  rows,
  children,
}: {
  title: string;
  subtitle: string;
  marketplaceLabel: string;
  /** Null when the sheets cover different windows. */
  period: ReportingPeriod | null;
  periodsDiffer: boolean;
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
                  {marketplaceLabel}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] tracking-wide text-zinc-500 uppercase">
                  Reporting period
                </dt>
                <dd className="mt-0.5 text-[14px] font-medium text-zinc-900">
                  {period ? (
                    `${formatDay(period.fromDay)} — ${formatDay(period.toDay)}`
                  ) : periodsDiffer ? (
                    // Never a widest-span invented from sheets that each cover
                    // something narrower; the filter reveals each real window.
                    <span title="The uploaded sheets cover different windows">
                      Multiple reporting periods
                    </span>
                  ) : (
                    "—"
                  )}
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
              fileLabel={
                period
                  ? `${marketplaceLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${period.fromDay}-to-${period.toDay}`
                  : new Date().toISOString().slice(0, 10)
              }
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

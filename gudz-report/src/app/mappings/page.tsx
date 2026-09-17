import Link from "next/link";
import { anyApi } from "convex/server";

import {
  MappingResolver,
  type ConfirmedMappingDoc,
} from "@/components/mappings/mapping-resolver";
import { getConvexClient } from "@/lib/convex/server";
import { monthPeriod } from "@/lib/dates/reporting-period";
import { loadMarketplaceReport } from "@/lib/report/marketplace-report";

export const metadata = { title: "Product mappings · Gudz Report" };

/**
 * The screen where a person closes the gap the report cannot close itself.
 *
 * It runs the same report the dashboard does, for the same import, and lists
 * what came back unresolved. That is deliberate: the products needing a decision
 * are defined by the report, not by a separate list that could drift out of step
 * with it. Confirming one here changes the dashboard on the next render.
 *
 * A Server Component, so the ERP key stays in this process — the catalogue
 * search the picker uses goes through `/api/catalog` for the same reason.
 */
export const dynamic = "force-dynamic";

const FALLBACK_PERIOD = monthPeriod("2026-08");

function single(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

export default async function MappingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const importId = single(params.importId) ?? null;

  const report = await loadMarketplaceReport(
    { importId, marketplace: single(params.marketplace) ?? null },
    FALLBACK_PERIOD,
  );

  const marketplace = report.marketplace;

  let confirmed: ConfirmedMappingDoc[] = [];
  let confirmedError: string | null = null;
  const client = getConvexClient();
  if (client && marketplace) {
    try {
      confirmed = (await client.query(
        anyApi.productMappings.listForMarketplace as never,
        { marketplace } as never,
      )) as ConfirmedMappingDoc[];
    } catch (cause) {
      confirmedError =
        cause instanceof Error ? cause.message : "Could not read confirmed mappings.";
    }
  }

  const backToReport = importId
    ? `/dashboard?importId=${importId}`
    : "/dashboard";

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-zinc-500">Healthy Master</p>
          <h1 className="text-2xl font-semibold tracking-tight">Product mappings</h1>
          <p className="mt-1 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
            A marketplace names its products its own way. This is where a
            marketplace product is tied to an ERP item, for the cases the report
            cannot decide on its own — a shared barcode, or no usable identifier
            at all. Confirmations are recorded and reused, so a product is
            resolved once rather than every month.
          </p>
        </div>
        <Link href={backToReport} className="text-sm underline underline-offset-4">
          Back to the report
        </Link>
      </header>

      <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <Tile label="Marketplace" value={marketplace ?? "not selected"} capitalize />
        <Tile label="Report" value={report.excel.fileName ?? "none loaded"} />
        <Tile
          label="Rows needing a decision"
          value={
            report.excel.mapping
              ? (report.excel.mapping.unmapped + report.excel.mapping.ambiguous).toLocaleString("en-IN")
              : "—"
          }
        />
        <Tile
          label="Units not reconciled"
          value={
            report.excel.mapping
              ? report.excel.mapping.unmappedQuantity.toLocaleString("en-IN")
              : "—"
          }
        />
      </dl>

      {confirmedError ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950">
          Could not read confirmed mappings: {confirmedError}
        </p>
      ) : null}

      {report.warnings.length > 0 ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950">
          <p className="font-medium">Data notes</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {report.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {marketplace === null ? (
        <p className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          No marketplace is selected, so there is nothing to map against. Pick an
          import on the{" "}
          <Link href="/dashboard" className="underline underline-offset-4">
            report
          </Link>{" "}
          first — a mapping belongs to one marketplace, since the same EAN can be
          listed by several.
        </p>
      ) : (
        <MappingResolver
          marketplace={marketplace}
          rows={report.unmappedRows}
          confirmed={confirmed}
        />
      )}
    </main>
  );
}

function Tile({
  label,
  value,
  capitalize,
}: {
  label: string;
  value: string;
  capitalize?: boolean;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd
        className={`mt-1 truncate font-semibold ${capitalize ? "capitalize" : ""}`}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}

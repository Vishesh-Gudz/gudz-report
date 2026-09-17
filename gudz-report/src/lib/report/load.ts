import "server-only";

import { anyApi } from "convex/server";

import { getConvexClient } from "../convex/server";
import type { ReportingPeriod } from "../dates/reporting-period";
import { reportingPeriodFromDays } from "../dates/reporting-period";
import { getErpClient } from "../erp";
import type { NormalizedExcelRow } from "../../types/excel";
import { buildReportModel, type ReportModel } from "./aggregate";
import {
  DEFAULT_MARKETPLACES,
  MarketplaceIndex,
  type MarketplaceMapping,
} from "./attribution";
import { fetchReportLines } from "./erp-lines";
import { reconcile } from "./matching";

/**
 * Assembles the whole report on the server.
 *
 * Deliberately degrades rather than fails. The ERP half and the Excel half have
 * different dependencies — the ERP needs a key, Convex needs a deployment — and
 * a dashboard that refuses to render because one of them is unconfigured is
 * useless during exactly the period when you are configuring it. With no Convex,
 * the page still shows real orders, revenue and customers with every line marked
 * ERP-only; with no marketplaces configured, every row reports as Unattributed,
 * which is visible and true.
 */

export interface ReportSource {
  readonly erpAvailable: boolean;
  readonly convexAvailable: boolean;
  readonly importId: string | null;
  readonly importFileName: string | null;
  readonly excelRowCount: number;
  readonly marketplaceCount: number;
  readonly erpPages: number;
  /** Non-fatal problems worth telling the reader about. */
  readonly warnings: string[];
}

export interface LoadedReport {
  readonly model: ReportModel;
  readonly source: ReportSource;
}

/** Shape of an `imports` document, narrowed to what this module reads. */
interface ImportDoc {
  _id: string;
  fileName: string;
  status: string;
  minDate: string | null;
  maxDate: string | null;
}

/**
 * Reads Convex without letting its absence break the page.
 *
 * Convex is optional here by design, so a failure to reach it is degraded
 * behaviour rather than an error — but it is always reported as a warning, never
 * swallowed, because "no Excel rows" and "could not read the Excel rows" produce
 * identical-looking output and mean very different things.
 */
async function readConvex<T>(
  fn: unknown,
  args: Record<string, unknown>,
  fallback: T,
  warnings: string[],
  label: string,
): Promise<T> {
  const client = getConvexClient();
  if (!client) return fallback;
  try {
    return (await client.query(fn as never, args as never)) as T;
  } catch (cause) {
    warnings.push(
      `Could not read ${label} from Convex: ${
        cause instanceof Error ? cause.message : "unknown error"
      }`,
    );
    return fallback;
  }
}

/** The period to report on: an explicit range, else the latest import's. */
export async function resolvePeriod(
  explicit: { from?: string; to?: string },
  fallback: ReportingPeriod,
): Promise<{ period: ReportingPeriod; latestImport: ImportDoc | null }> {
  const warnings: string[] = [];

  if (explicit.from && explicit.to) {
    return {
      period: reportingPeriodFromDays(explicit.from, explicit.to),
      latestImport: null,
    };
  }

  const imports = await readConvex<ImportDoc[]>(
    anyApi.imports.list,
    { limit: 10 },
    [],
    warnings,
    "imports",
  );

  // The most recent completed import that actually produced a date range. An
  // import that failed to read its dates cannot set a reporting period.
  const usable = imports.find(
    (row) => row.status === "completed" && row.minDate && row.maxDate,
  );

  if (usable?.minDate && usable.maxDate) {
    return {
      period: reportingPeriodFromDays(usable.minDate, usable.maxDate),
      latestImport: usable,
    };
  }

  return { period: fallback, latestImport: null };
}

export async function loadReport(args: {
  period: ReportingPeriod;
  importId?: string | null;
}): Promise<LoadedReport> {
  const warnings: string[] = [];

  const marketplaceDocs = await readConvex<MarketplaceMapping[]>(
    anyApi.marketplaces.list,
    {},
    [...DEFAULT_MARKETPLACES],
    warnings,
    "marketplace configuration",
  );

  const conflicts = MarketplaceIndex.conflicts(marketplaceDocs);
  for (const conflict of conflicts) {
    warnings.push(
      `GSTIN ${conflict.gstin} is configured under more than one marketplace (${conflict.marketplaces.join(", ")}). The first is used.`,
    );
  }
  const marketplaces = new MarketplaceIndex(marketplaceDocs);

  const excelRows = args.importId
    ? await readConvex<NormalizedExcelRow[]>(
        anyApi.imports.rowsForImport,
        { importId: args.importId, limit: 50_000 },
        [],
        warnings,
        "Excel rows",
      )
    : [];

  let erpLines: Awaited<ReturnType<typeof fetchReportLines>>["lines"] = [];
  let erpPages = 0;
  let erpAvailable = false;

  try {
    const result = await fetchReportLines(getErpClient(), { period: args.period });
    erpLines = result.lines;
    erpPages = result.pages;
    erpAvailable = true;
  } catch (cause) {
    // Surfaced, not hidden: an empty report because the ERP was unreachable
    // must not look like an empty report because there were no sales.
    warnings.push(
      `Could not read the ERP: ${cause instanceof Error ? cause.message : "unknown error"}`,
    );
  }

  const reconciliation = reconcile(excelRows, erpLines, marketplaces);

  return {
    model: buildReportModel({
      period: args.period,
      erpLines,
      reconciliation,
      marketplaces,
    }),
    source: {
      erpAvailable,
      convexAvailable: getConvexClient() !== null,
      importId: args.importId ?? null,
      importFileName: null,
      excelRowCount: excelRows.length,
      marketplaceCount: marketplaceDocs.length,
      erpPages,
      warnings,
    },
  };
}

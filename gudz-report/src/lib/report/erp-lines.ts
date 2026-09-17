import type { ReportingPeriod } from "../dates/reporting-period";
import type { ErpClient } from "../erp/client";
import { getAllSalesOrderLines } from "../erp/sales-orders";
import type { SalesOrderLine, SalesOrderSummary } from "../../types/erp";
import { REPORTABLE_STATUSES } from "./policy";

/**
 * Fetching the ERP half of the report.
 *
 * One place decides which statuses the report is built from, and it sends them
 * to the ERP as a filter rather than fetching everything and discarding rows
 * here. That matters for more than bandwidth: the ERP's `meta.summary` describes
 * the *filtered* set, so filtering server-side means the summary the API returns
 * is the summary of what the report actually shows.
 */

export interface FetchReportLinesOptions {
  readonly period: ReportingPeriod;
  /** Defaults to the reportable statuses — drafts and cancellations excluded. */
  readonly statuses?: ReadonlyArray<string>;
  /** Narrow to one marketplace's registered buyer. */
  readonly customerGstin?: string;
  readonly sku?: string;
  /** Runaway guard for the cursor walk, not a limit to rely on. */
  readonly maxPages?: number;
}

export interface ReportLinesResult {
  readonly lines: SalesOrderLine[];
  readonly pages: number;
  /** ERP-computed totals for the whole filtered set, not just what was paged. */
  readonly summary: SalesOrderSummary | null;
}

/**
 * Every B2B sales-order line in the period, after the status policy.
 *
 * Walks the cursor to the end — the client stops on the contract's `hasMore`,
 * never on a short page, because the ERP filters some rows after paging and a
 * short middle page is normal.
 */
export async function fetchReportLines(
  client: ErpClient,
  options: FetchReportLinesOptions,
): Promise<ReportLinesResult> {
  const result = await getAllSalesOrderLines(
    client,
    {
      period: options.period,
      dateField: "orderDate",
      statuses: (options.statuses ?? REPORTABLE_STATUSES) as never,
      // Redundant with the status allow-list, but harmless and explicit: if the
      // allow-list is ever widened, cancellations still stay out by default.
      excludeCancelled: true,
      customerGstin: options.customerGstin,
      sku: options.sku,
    },
    { maxPages: options.maxPages },
  );

  return {
    lines: result.lines,
    pages: result.pages,
    summary: result.summary ?? null,
  };
}

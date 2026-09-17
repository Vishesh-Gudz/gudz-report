"use node";

import { v } from "convex/values";

import { action } from "./_generated/server";
import { createErpClient } from "../src/lib/erp/client";
import {
  getAllSalesOrderLines,
  getAllSalesOrders,
  getSalesOrders,
} from "../src/lib/erp/sales-orders";
import { getLedgerHealth } from "../src/lib/erp/snapshot";
import { reportingPeriodFromDays } from "../src/lib/dates/reporting-period";

/**
 * ERP access from Convex.
 *
 * Read-only by construction: the shared client has no `method` parameter, so
 * nothing reachable from here can write to the ERP.
 *
 * The credential comes from Convex's own environment, never from the Next
 * process and never from a client. Set it once per deployment:
 *
 *   npx convex env set ERP_API_URL https://api.delivery.gudz.in
 *   npx convex env set ERP_API_KEY <key>
 *
 * These are actions rather than queries because they call an external service —
 * Convex queries must be deterministic and cannot perform network I/O.
 */

function erpClient() {
  const baseUrl = process.env.ERP_API_URL;
  const apiKey = process.env.ERP_API_KEY;

  // Names only. A message that echoed the value would put the key in a Convex
  // log the first time someone mis-set it.
  if (!baseUrl) {
    throw new Error(
      "ERP_API_URL is not set on this Convex deployment. Run: npx convex env set ERP_API_URL https://api.delivery.gudz.in",
    );
  }
  if (!apiKey) {
    throw new Error(
      "ERP_API_KEY is not set on this Convex deployment. Run: npx convex env set ERP_API_KEY <key>",
    );
  }

  return createErpClient({ baseUrl, apiKey });
}

const PERIOD_ARGS = {
  /** Inclusive first day, `YYYY-MM-DD`. */
  fromDay: v.string(),
  /** Inclusive last day, `YYYY-MM-DD`. */
  toDay: v.string(),
} as const;

/**
 * Whether the ERP is reachable and the credential works.
 *
 * Reports the ledger backlog too, because a `degraded` ledger is worth knowing
 * about before anyone reads an ERP movement figure — it does not affect the
 * sales-order feeds, which read different tables.
 */
export const healthCheck = action({
  args: {},
  handler: async (): Promise<{
    reachable: boolean;
    ledgerStatus: "ok" | "degraded" | null;
    backlogRows: number | null;
    lastSyncAt: string | null;
    error: string | null;
  }> => {
    try {
      const health = await getLedgerHealth(erpClient());
      return {
        reachable: true,
        ledgerStatus: health.status,
        backlogRows: health.backlogRows,
        lastSyncAt: health.lastSyncAt,
        error: null,
      };
    } catch (cause) {
      return {
        reachable: false,
        ledgerStatus: null,
        backlogRows: null,
        lastSyncAt: null,
        error: cause instanceof Error ? cause.message : "Unknown error",
      };
    }
  },
});

/**
 * A single page of B2B sales orders — for a smoke test or a preview.
 *
 * Use `fetchSalesOrderLinesForPeriod` for the reconciliation itself; walking the
 * cursor one action call at a time would be slower and easy to stop short of.
 */
export const fetchSalesOrdersPage = action({
  args: {
    ...PERIOD_ARGS,
    includeItems: v.optional(v.boolean()),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
    customerGstin: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const period = reportingPeriodFromDays(args.fromDay, args.toDay);
    const page = await getSalesOrders(
      erpClient(),
      { period, customerGstin: args.customerGstin, limit: args.limit },
      { includeItems: args.includeItems ?? true, cursor: args.cursor },
    );

    return {
      orders: page.orders,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
      summary: page.summary ?? null,
      period: page.period ?? null,
    };
  },
});

/**
 * Every B2B sales order in a reporting period.
 *
 * Pages to the end of the cursor inside one action rather than fanning out: the
 * ERP has no batch-get-by-ids endpoint, and a partial walk returned as if it
 * were complete is the failure mode worth spending a long-running action to
 * avoid.
 */
export const fetchSalesOrdersForPeriod = action({
  args: {
    ...PERIOD_ARGS,
    includeItems: v.optional(v.boolean()),
    customerGstin: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const period = reportingPeriodFromDays(args.fromDay, args.toDay);
    const result = await getAllSalesOrders(
      erpClient(),
      { period, customerGstin: args.customerGstin },
      { includeItems: args.includeItems ?? true },
    );

    return {
      orders: result.orders,
      pages: result.pages,
      summary: result.summary ?? null,
      period: result.period ?? null,
    };
  },
});

/**
 * Every B2B sales-order LINE in a reporting period.
 *
 * The feed the reconciliation actually consumes: a marketplace file is
 * line-level, and each row here carries both order identity and line identity,
 * so matching is a row-to-row join rather than a nested walk.
 */
export const fetchSalesOrderLinesForPeriod = action({
  args: {
    ...PERIOD_ARGS,
    customerGstin: v.optional(v.string()),
    sku: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const period = reportingPeriodFromDays(args.fromDay, args.toDay);
    const result = await getAllSalesOrderLines(erpClient(), {
      period,
      customerGstin: args.customerGstin,
      sku: args.sku,
    });

    return {
      lines: result.lines,
      pages: result.pages,
      summary: result.summary ?? null,
      period: result.period ?? null,
    };
  },
});

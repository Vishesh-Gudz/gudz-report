import { notFound } from "next/navigation";

import { getConfigStatus } from "@/lib/config";
import { getErpClient, getSalesOrders, ErpApiError, ErpContractError } from "@/lib/erp";
import { reportingPeriodFromDays } from "@/lib/dates/reporting-period";
import type { SalesOrder } from "@/types/erp";

/**
 * Local verification that the ERP integration actually works end to end.
 *
 * A Server Component, so the credential never reaches the browser: the fetch
 * runs in the Next server process and only the sanitised summary below is
 * serialised into the page.
 *
 * **Read-only.** It issues one GET. The client it uses has no way to express a
 * write, so this page could not mutate the ERP even if it tried.
 *
 * Development only — `notFound()` in production rather than an auth check,
 * because the safest diagnostic endpoint is one that does not exist in prod.
 */

export const dynamic = "force-dynamic";

const PERIOD = reportingPeriodFromDays("2026-08-01", "2026-08-31");

interface TestResult {
  ok: boolean;
  requestId: string | null;
  orderCount: number;
  hasMore: boolean;
  period: string | null;
  summary: Record<string, number> | null;
  sample: SanitisedOrder | null;
  error: { kind: string; message: string } | null;
}

interface SanitisedOrder {
  soNumber: string;
  orderDate: string;
  status: string;
  channel: string | null;
  customerName: string;
  customerGstinPresent: boolean;
  customerSource: string;
  totalAmount: number;
  currency: string;
  itemCount: number;
  firstItem: { sku: string; orderedQuantity: number; unitPrice: number } | null;
}

/**
 * Reduces an order to what proves the integration works.
 *
 * Deliberately not the whole order. This is real customer data from a live
 * business; a diagnostic page has no business rendering GSTINs, addresses or
 * phone numbers, so the GSTIN is reported as present-or-not rather than shown.
 */
function sanitise(order: SalesOrder): SanitisedOrder {
  const firstItem = order.items?.[0] ?? null;
  return {
    soNumber: order.soNumber,
    orderDate: order.orderDate,
    status: order.status,
    channel: order.channel,
    customerName: order.customer.name,
    customerGstinPresent: Boolean(order.customer.gstin),
    customerSource: order.customer.source,
    totalAmount: order.totals.totalAmount,
    currency: order.totals.currency,
    itemCount: order.itemCount,
    firstItem: firstItem
      ? {
          sku: firstItem.sku,
          orderedQuantity: firstItem.orderedQuantity,
          unitPrice: firstItem.unitPrice,
        }
      : null,
  };
}

async function runTest(): Promise<TestResult> {
  const empty: TestResult = {
    ok: false,
    requestId: null,
    orderCount: 0,
    hasMore: false,
    period: null,
    summary: null,
    sample: null,
    error: null,
  };

  try {
    const page = await getSalesOrders(
      getErpClient(),
      // Ten rows is all a connectivity check needs, and it keeps the page from
      // rendering a slab of a live customer's order book.
      { period: PERIOD, limit: 10 },
      { includeItems: true },
    );

    return {
      ok: true,
      requestId: page.requestId,
      orderCount: page.orders.length,
      hasMore: page.hasMore,
      period: page.period ? `${page.period.from} → ${page.period.to}` : null,
      summary: page.summary
        ? {
            orders: page.summary.orders,
            totalAmount: page.summary.totalAmount,
            totalQuantity: page.summary.totalQuantity,
            distinctCustomers: page.summary.distinctCustomers,
            distinctSkus: page.summary.distinctSkus,
          }
        : null,
      sample: page.orders[0] ? sanitise(page.orders[0]) : null,
      error: null,
    };
  } catch (cause) {
    // Error messages from the client never contain the key or the headers.
    if (cause instanceof ErpApiError) {
      return {
        ...empty,
        requestId: cause.requestId,
        error: { kind: `ERP ${cause.status} ${cause.code}`, message: cause.message },
      };
    }
    if (cause instanceof ErpContractError) {
      return {
        ...empty,
        error: { kind: "Contract mismatch", message: cause.issues.join("; ") },
      };
    }
    return {
      ...empty,
      error: {
        kind: "Configuration or unexpected error",
        message: cause instanceof Error ? cause.message : "Unknown error",
      },
    };
  }
}

export default async function ErpTestPage() {
  if (process.env.NODE_ENV === "production") notFound();

  const config = getConfigStatus();
  const result = config.ready ? await runTest() : null;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-12">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">ERP connection test</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          One read-only <code>GET /api/v1/soh/sales-orders</code> for{" "}
          {PERIOD.fromDay} → {PERIOD.toDay}, <code>includeItems=true</code>,{" "}
          <code>limit=10</code>. Development only.
        </p>
      </div>

      <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="mb-2 font-medium">Configuration</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-zinc-500">ERP_API_URL</dt>
          <dd className="font-mono">{config.erpApiUrl ?? "(not set)"}</dd>
          <dt className="text-zinc-500">ERP_API_KEY</dt>
          {/* Presence only. The value is never rendered. */}
          <dd>{config.erpApiKeyPresent ? "set" : "(not set)"}</dd>
        </dl>
      </section>

      {!config.ready ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950">
          Set <code>ERP_API_URL</code> and <code>ERP_API_KEY</code> in{" "}
          <code>.env.local</code> (see <code>.env.example</code>), then reload.
        </p>
      ) : result?.error ? (
        <section className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm dark:border-red-900 dark:bg-red-950">
          <h2 className="font-medium">{result.error.kind}</h2>
          <p className="mt-1 whitespace-pre-wrap">{result.error.message}</p>
          {result.requestId ? (
            <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
              ERP request id: <code>{result.requestId}</code>
            </p>
          ) : null}
        </section>
      ) : result ? (
        <section className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm dark:border-emerald-900 dark:bg-emerald-950">
          <h2 className="font-medium">Connected</h2>
          <pre className="mt-2 overflow-x-auto text-xs">
            {JSON.stringify(
              {
                orderCount: result.orderCount,
                hasMore: result.hasMore,
                period: result.period,
                summary: result.summary,
                sample: result.sample,
              },
              null,
              2,
            )}
          </pre>
        </section>
      ) : null}
    </main>
  );
}

import { z } from "zod";

import type { ReportingPeriod } from "../dates/reporting-period";
import {
  salesOrderLineSchema,
  salesOrderSchema,
  type ErpCustomerType,
  type ErpDateField,
  type ErpOrderType,
  type ErpSalesOrderStatus,
  type SalesOrder,
  type SalesOrderLine,
  type SalesOrderSummary,
  type Period,
} from "../../types/erp";
import type { ErpClient } from "./client";

/**
 * The B2B sales-order feeds — the ERP half of the reconciliation.
 *
 * `sales_orders` *is* the ERP's B2B register; B2C delivery orders live in a
 * different table these endpoints never read. There is no B2B flag to pass.
 *
 * **Identify a customer by `customerGstin`, not by `channel`.** Production data
 * settled this: about half of Healthy Master's orders carry no channel at all,
 * and a channel naming a marketplace can sit on an order raised to a completely
 * different party. Customer names fragment too — the same buyer appears under
 * several spellings and several customer ids. The registered GSTIN is the only
 * identifier that holds still, which is why it is the filter the mapping layer
 * should key on.
 */

export interface SalesOrderFilters {
  /** Inclusive reporting window. Converted to strict UTC ISO on the way out. */
  readonly period: ReportingPeriod;
  /** Period axis. Defaults to `orderDate`, the business date. */
  readonly dateField?: ErpDateField;
  readonly statuses?: ReadonlyArray<ErpSalesOrderStatus>;
  /** Defaults to true on the ERP side; cancelled orders overstate revenue. */
  readonly excludeCancelled?: boolean;
  readonly customerId?: string;
  readonly customerSearch?: string;
  readonly customerType?: ErpCustomerType;
  /** Exact GSTIN. The stable customer key — prefer this over `channel`. */
  readonly customerGstin?: string;
  readonly orderType?: ErpOrderType;
  /** Order metadata, not customer identity. Use for provenance, not attribution. */
  readonly channel?: string;
  readonly hubId?: string;
  readonly itemId?: string;
  readonly sku?: string;
  readonly limit?: number;
}

/** ERP `limit` ceiling. Asking for more is a validation error, not a bigger page. */
export const ERP_MAX_LIMIT = 200;

function toQuery(filters: SalesOrderFilters) {
  return {
    from: filters.period.fromIso,
    to: filters.period.toIso,
    dateField: filters.dateField ?? "orderDate",
    statuses: filters.statuses ? [...filters.statuses] : undefined,
    excludeCancelled: filters.excludeCancelled,
    customerId: filters.customerId,
    customerSearch: filters.customerSearch,
    customerType: filters.customerType,
    customerGstin: filters.customerGstin,
    orderType: filters.orderType,
    channel: filters.channel,
    hubId: filters.hubId,
    itemId: filters.itemId,
    sku: filters.sku,
    limit: Math.min(filters.limit ?? ERP_MAX_LIMIT, ERP_MAX_LIMIT),
  } as const;
}

export interface SalesOrderPage {
  readonly orders: SalesOrder[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
  readonly period?: Period;
  readonly summary?: SalesOrderSummary;
  readonly requestId: string;
}

/**
 * One page of sales orders.
 *
 * `includeItems` defaults to true because the reconciliation is line-level.
 * Pass false for a headers-only view — the ERP skips the line lookup entirely
 * and returns `items: null`, which is materially cheaper and is *not* the same
 * as an order with no lines.
 */
export async function getSalesOrders(
  client: ErpClient,
  filters: SalesOrderFilters,
  options?: { readonly includeItems?: boolean; readonly cursor?: string },
): Promise<SalesOrderPage> {
  const response = await client.get("/soh/sales-orders", z.array(salesOrderSchema), {
    ...toQuery(filters),
    includeItems: options?.includeItems ?? true,
    cursor: options?.cursor,
  });

  return {
    orders: response.data,
    nextCursor: response.pagination?.nextCursor ?? null,
    hasMore: response.pagination?.hasMore ?? false,
    period: response.period,
    summary: response.summary,
    requestId: response.requestId,
  };
}

/** Every sales order in the period, following the cursor to the end. */
export async function getAllSalesOrders(
  client: ErpClient,
  filters: SalesOrderFilters,
  options?: { readonly includeItems?: boolean; readonly maxPages?: number },
): Promise<{
  orders: SalesOrder[];
  pages: number;
  period?: Period;
  summary?: SalesOrderSummary;
}> {
  const result = await client.getAllPages(
    "/soh/sales-orders",
    salesOrderSchema,
    { ...toQuery(filters), includeItems: options?.includeItems ?? true },
    { maxPages: options?.maxPages },
  );

  return {
    orders: result.rows,
    pages: result.pages,
    period: result.period,
    summary: result.summary,
  };
}

export interface SalesOrderLinePage {
  readonly lines: SalesOrderLine[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
  readonly period?: Period;
  readonly summary?: SalesOrderSummary;
  readonly requestId: string;
}

/**
 * One page of sales-order *lines*.
 *
 * This is the feed to reconcile a spreadsheet against: a marketplace file is
 * line-level, and each row here carries both the order identity (`salesOrderId`,
 * `soNumber`, `orderDate`, `customerGstin`) and the line identity
 * (`salesOrderItemId`, `itemId`, `sku`) needed to key a match.
 *
 * Note `itemId` / `sku` narrow the **lines** here, where on the order feed they
 * keep whole orders containing a match. Same names, different questions.
 */
export async function getSalesOrderLines(
  client: ErpClient,
  filters: SalesOrderFilters,
  options?: { readonly cursor?: string },
): Promise<SalesOrderLinePage> {
  const response = await client.get(
    "/soh/sales-order-lines",
    z.array(salesOrderLineSchema),
    { ...toQuery(filters), cursor: options?.cursor },
  );

  return {
    lines: response.data,
    nextCursor: response.pagination?.nextCursor ?? null,
    hasMore: response.pagination?.hasMore ?? false,
    period: response.period,
    summary: response.summary,
    requestId: response.requestId,
  };
}

/** Every sales-order line in the period, following the cursor to the end. */
export async function getAllSalesOrderLines(
  client: ErpClient,
  filters: SalesOrderFilters,
  options?: { readonly maxPages?: number },
): Promise<{
  lines: SalesOrderLine[];
  pages: number;
  period?: Period;
  summary?: SalesOrderSummary;
}> {
  const result = await client.getAllPages(
    "/soh/sales-order-lines",
    salesOrderLineSchema,
    toQuery(filters),
    { maxPages: options?.maxPages },
  );

  return {
    lines: result.rows,
    pages: result.pages,
    period: result.period,
    summary: result.summary,
  };
}

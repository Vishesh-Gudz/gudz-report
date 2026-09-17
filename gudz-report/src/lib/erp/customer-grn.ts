import { z } from "zod";

import type { ErpClient } from "./client";

/**
 * Customer GRN — what the customer actually received.
 *
 * This is the ERP's own `customer_grn` register: "Customer's Goods Received
 * Note… what they actually received against what we sent." It is deliberately
 * **not** the sales order. `orderedQuantity` is what Healthy Master invoiced;
 * a GRN is what the marketplace booked in at their end, and the difference
 * between the two is the entire reason this column exists. Relabelling one as
 * the other would answer a different question while looking correct.
 *
 * There is also a `grn_records` table in the ERP. That one is inbound to
 * Healthy Master's own hubs — purchase orders, inter-hub transfers, indents —
 * and has no customer at all. It is the wrong register for this report.
 *
 * As of writing, production holds **zero** customer GRN records under every
 * filter. That is a real answer, not a failure: nobody has raised one yet. The
 * report shows `—` and says "Awaiting customer GRN" rather than `0`, because a
 * zero would claim a GRN was recorded and found nothing. When records start
 * appearing this code populates them with no change.
 *
 * The list endpoint returns headers only and has no date filter, so the walk
 * is: list the headers, keep the ones whose `receivedDate` falls in the period
 * and whose customer belongs to this marketplace, then read each one's items.
 */

const grnHeaderSchema = z
  .object({
    id: z.string(),
    grnNumber: z.string(),
    salesOrderId: z.string(),
    soNumber: z.string(),
    customerId: z.string(),
    customerName: z.string(),
    status: z.string(),
    receivedDate: z.string(),
    totalExpectedQuantity: z.number(),
    totalReceivedQuantity: z.number(),
  })
  .loose();

const grnItemSchema = z
  .object({
    id: z.string(),
    itemId: z.string(),
    itemSku: z.string(),
    itemName: z.string(),
    expectedQuantity: z.number(),
    receivedQuantity: z.number(),
    shortageQuantity: z.number().nullable().optional(),
    excessQuantity: z.number().nullable().optional(),
  })
  .loose();

const grnDetailSchema = grnHeaderSchema.extend({
  items: z.array(grnItemSchema),
});

export type CustomerGrnHeader = z.infer<typeof grnHeaderSchema>;

/** One month of received quantity for one ERP item. */
export interface GrnMonthlyTotal {
  readonly itemId: string;
  readonly itemSku: string;
  /** `YYYY-MM`, taken from `receivedDate`. */
  readonly month: string;
  readonly receivedQuantity: number;
  readonly grnCount: number;
}

export interface CustomerGrnResult {
  /** Keyed `${itemId}::${month}`, and separately `${SKU}::${month}`. */
  readonly byItemMonth: ReadonlyMap<string, GrnMonthlyTotal>;
  readonly bySkuMonth: ReadonlyMap<string, GrnMonthlyTotal>;
  /** How many GRN headers existed at all, before any filtering. */
  readonly headersSeen: number;
  /** How many fell inside the period and belonged to this marketplace. */
  readonly headersUsed: number;
  readonly available: boolean;
  readonly error: string | null;
}

export function emptyGrnResult(error: string | null = null): CustomerGrnResult {
  return {
    byItemMonth: new Map(),
    bySkuMonth: new Map(),
    headersSeen: 0,
    headersUsed: 0,
    available: error === null,
    error,
  };
}

/** Guard against walking an unbounded register if one day it is large. */
const MAX_PAGES = 50;
const PAGE_SIZE = 100;

export interface FetchCustomerGrnOptions {
  /** Inclusive calendar days, `YYYY-MM-DD`. */
  readonly fromDay: string;
  readonly toDay: string;
  /**
   * ERP customer ids belonging to this marketplace.
   *
   * Taken from the sales-order lines already fetched for the same period, which
   * carry both `customerId` and `customerGstin` — so the marketplace's
   * configured GSTIN resolves to real customer ids without a second lookup.
   * Empty means "no customer identified", and nothing is attributed.
   */
  readonly customerIds: ReadonlyArray<string>;
}

export async function fetchCustomerGrn(
  client: ErpClient,
  options: FetchCustomerGrnOptions,
): Promise<CustomerGrnResult> {
  const wanted = new Set(options.customerIds);
  if (wanted.size === 0) return emptyGrnResult();

  const byItemMonth = new Map<string, GrnMonthlyTotal>();
  const bySkuMonth = new Map<string, GrnMonthlyTotal>();
  let headersSeen = 0;
  let headersUsed = 0;

  try {
    const inRange: CustomerGrnHeader[] = [];

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const response = await client.get("/customer-grn", z.array(grnHeaderSchema), {
        page,
        limit: PAGE_SIZE,
        status: "completed",
      });

      headersSeen += response.data.length;

      for (const header of response.data) {
        if (!wanted.has(header.customerId)) continue;
        const day = header.receivedDate.slice(0, 10);
        if (day < options.fromDay || day > options.toDay) continue;
        inRange.push(header);
      }

      const pagination = response.pagination as { totalPages?: number } | undefined;
      const totalPages = pagination?.totalPages ?? 1;
      if (page >= totalPages || response.data.length === 0) break;
    }

    for (const header of inRange) {
      const detail = await client.get(
        `/customer-grn/${encodeURIComponent(header.id)}`,
        grnDetailSchema,
      );

      const month = header.receivedDate.slice(0, 7);
      headersUsed += 1;

      for (const item of detail.data.items) {
        add(byItemMonth, `${item.itemId}::${month}`, item.itemId, item.itemSku, month, item.receivedQuantity);
        add(
          bySkuMonth,
          `${item.itemSku.toUpperCase()}::${month}`,
          item.itemId,
          item.itemSku,
          month,
          item.receivedQuantity,
        );
      }
    }
  } catch (cause) {
    return {
      byItemMonth,
      bySkuMonth,
      headersSeen,
      headersUsed,
      available: false,
      error:
        cause instanceof Error
          ? cause.message
          : "The customer GRN register could not be read.",
    };
  }

  return {
    byItemMonth,
    bySkuMonth,
    headersSeen,
    headersUsed,
    available: true,
    error: null,
  };
}

function add(
  target: Map<string, GrnMonthlyTotal>,
  key: string,
  itemId: string,
  itemSku: string,
  month: string,
  quantity: number,
): void {
  const existing = target.get(key);
  target.set(key, {
    itemId,
    itemSku,
    month,
    receivedQuantity: (existing?.receivedQuantity ?? 0) + quantity,
    grnCount: (existing?.grnCount ?? 0) + 1,
  });
}

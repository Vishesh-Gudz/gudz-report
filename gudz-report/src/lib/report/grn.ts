import type { ReportingPeriod } from "../dates/reporting-period";
import type { ErpClient } from "../erp/client";
import type { SalesOrderLine } from "../../types/erp";
import { fetchReportLines } from "./erp-lines";
import { isReportableStatus, reportedQuantity } from "./policy";

/**
 * GRN — what the report shows as goods received.
 *
 * Two sources exist for this figure and the business has chosen one:
 *
 *  1. **ERP B2B sales orders** (this module). The quantity Healthy Master
 *     invoiced to the marketplace, by `orderedQuantity`, dated on the order and
 *     summed per month. Real data, present today.
 *  2. **The ERP customer GRN register** (`erp/customer-grn.ts`). What the
 *     marketplace itself recorded receiving. Strictly the better answer, and
 *     empty in production — nobody has raised one yet.
 *
 * The report uses (1) because a column nobody can populate is not a report.
 * The two are deliberately kept behind the same shape — a map keyed
 * `itemId::YYYY-MM` — so swapping to the customer register later is a change of
 * one call in `build-snapshot.ts` and nothing else.
 *
 * What this is not: a claim that the marketplace received these units. It is
 * what was invoiced to them in that month. Where the two eventually differ, the
 * customer register is the one to believe.
 */

/** One month of goods-received quantity for one ERP item. */
export interface GrnMonthlyTotal {
  readonly itemId: string;
  readonly itemSku: string;
  /** `YYYY-MM`. */
  readonly month: string;
  readonly quantity: number;
  /** How many ERP lines contributed. */
  readonly lines: number;
}

export interface GrnResult {
  /** Keyed `${itemId}::${month}`. */
  readonly byItemMonth: ReadonlyMap<string, GrnMonthlyTotal>;
  readonly totalQuantity: number;
  readonly orders: number;
  readonly lines: number;
  /** The ERP customers these figures came from, for the GRN source to widen later. */
  readonly customerIds: ReadonlyArray<string>;
  readonly available: boolean;
  readonly error: string | null;
}

export function emptyGrnResult(error: string | null = null): GrnResult {
  return {
    byItemMonth: new Map(),
    totalQuantity: 0,
    orders: 0,
    lines: 0,
    customerIds: [],
    available: error === null,
    error,
  };
}

export interface FetchGrnOptions {
  readonly period: ReportingPeriod;
  /** The marketplace's registered buyer GSTINs. Empty means nothing to fetch. */
  readonly customerGstins: ReadonlyArray<string>;
}

/**
 * Goods received per item per month, from the ERP's B2B sales orders.
 *
 * Draft and cancelled orders never reach this: the status filter is applied by
 * the ERP and re-checked here, because an order that was never confirmed was
 * never received either.
 *
 * The month comes from the order date rather than the reporting period, so an
 * order placed in June lands in June even when the report runs to August.
 */
export async function fetchGrnFromSalesOrders(
  client: ErpClient,
  options: FetchGrnOptions,
): Promise<GrnResult> {
  if (options.customerGstins.length === 0) return emptyGrnResult();

  const byItemMonth = new Map<string, GrnMonthlyTotal>();
  const orderIds = new Set<string>();
  const customerIds = new Set<string>();
  let totalQuantity = 0;
  let lineCount = 0;

  try {
    // One request per GSTIN: a marketplace's regional entities register
    // separately, and the ERP filters on a single GSTIN at a time.
    const byLineId = new Map<string, SalesOrderLine>();
    for (const gstin of options.customerGstins) {
      const result = await fetchReportLines(client, {
        period: options.period,
        customerGstin: gstin,
      });
      // Merged on the line id so an order returned under two GSTINs counts once.
      for (const line of result.lines) byLineId.set(line.salesOrderItemId, line);
    }

    for (const line of byLineId.values()) {
      if (!isReportableStatus(line.status)) continue;

      const month = line.orderDate.slice(0, 7);
      if (month.length !== 7) continue;

      // A sales-order line can carry no item id — the ERP allows free-text
      // lines. There is nothing to attribute those to, so they are skipped
      // rather than pooled under an empty key.
      const itemId = line.itemId;
      if (!itemId) continue;

      const quantity = reportedQuantity(line);
      const key = `${itemId}::${month}`;
      const existing = byItemMonth.get(key);

      byItemMonth.set(key, {
        itemId,
        itemSku: line.sku,
        month,
        quantity: (existing?.quantity ?? 0) + quantity,
        lines: (existing?.lines ?? 0) + 1,
      });

      orderIds.add(line.salesOrderId);
      if (line.customerId) customerIds.add(line.customerId);
      totalQuantity += quantity;
      lineCount += 1;
    }
  } catch (cause) {
    return {
      byItemMonth,
      totalQuantity,
      orders: orderIds.size,
      lines: lineCount,
      customerIds: [...customerIds],
      available: false,
      error:
        cause instanceof Error ? cause.message : "The ERP could not be reached.",
    };
  }

  return {
    byItemMonth,
    totalQuantity,
    orders: orderIds.size,
    lines: lineCount,
    customerIds: [...customerIds],
    available: true,
    error: null,
  };
}

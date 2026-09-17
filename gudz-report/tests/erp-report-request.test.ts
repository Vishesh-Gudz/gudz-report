import { afterEach, describe, expect, test, vi } from "vitest";

import { createErpClient } from "@/lib/erp/client";
import { fetchReportLines } from "@/lib/report/erp-lines";
import { reportingPeriodFromDays } from "@/lib/dates/reporting-period";
import { REPORTABLE_STATUSES } from "@/lib/report/policy";

/**
 * What the dashboard actually asks the ERP for.
 *
 * The request shape is the report's contract with the ERP, and every part of it
 * is load-bearing: the wrong `dateField` reports on the wrong month, a missing
 * status filter silently includes drafts, and a missing GSTIN returns every B2B
 * customer instead of the marketplace. All of those produce a page that looks
 * right, which is why they are asserted rather than trusted.
 */

const PERIOD = reportingPeriodFromDays("2026-06-01", "2026-08-31");
const client = createErpClient({
  baseUrl: "https://erp.example",
  apiKey: "dlerp_test_key_value_do_not_leak",
});

function line(overrides: Record<string, unknown> = {}) {
  return {
    salesOrderId: "so_1",
    soNumber: "SO-1",
    referenceNumber: null,
    orderDate: "2026-06-01T00:00:00.000Z",
    dispatchedAt: null,
    deliveredAt: null,
    status: "approved",
    orderType: "product",
    channel: null,
    channelNormalized: null,
    customerId: "cust_1",
    customerName: "BLINK COMMERCE PRIVATE LIMITED",
    customerCode: null,
    customerType: "BUSINESS",
    customerGstin: "29AAFCG9846E1Z7",
    sourceHubId: null,
    salesOrderItemId: "soi_1",
    itemId: "item_1",
    sku: "RAGI-CHIPS-100",
    name: "Ragi Chips",
    unit: "pcs",
    hsnCode: null,
    orderedQuantity: 10,
    shippedQuantity: 0,
    deliveredQuantity: 0,
    unitPrice: 150,
    lineTotal: 1500,
    taxableValue: 1500,
    taxAmount: 0,
    fulfillmentSku: null,
    fulfillmentQuantity: null,
    ...overrides,
  };
}

function page(data: unknown[], pagination: Record<string, unknown>) {
  return new Response(
    JSON.stringify({
      success: true,
      data,
      meta: { requestId: "req_1", pagination: { limit: 200, ...pagination } },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the request the report sends", () => {
  test("asks for the period, orderDate, reportable statuses and the GSTIN", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => page([line()], { hasMore: false, nextCursor: null }));

    await fetchReportLines(client, {
      period: PERIOD,
      customerGstin: "29AAFCG9846E1Z7",
    });

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/api/v1/soh/sales-order-lines");
    expect(url.searchParams.get("from")).toBe(PERIOD.fromIso);
    expect(url.searchParams.get("to")).toBe(PERIOD.toIso);
    expect(url.searchParams.get("dateField")).toBe("orderDate");
    expect(url.searchParams.get("statuses")).toBe(REPORTABLE_STATUSES.join(","));
    expect(url.searchParams.get("excludeCancelled")).toBe("true");
    expect(url.searchParams.get("customerGstin")).toBe("29AAFCG9846E1Z7");
  });

  test("sends no GSTIN filter when none is configured", async () => {
    // Not an error — it is every B2B customer, and the dashboard says so. But
    // the parameter must be absent rather than empty, which the ERP would read
    // as "GSTIN equals empty string".
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => page([], { hasMore: false, nextCursor: null }));

    await fetchReportLines(client, { period: PERIOD });

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.searchParams.has("customerGstin")).toBe(false);
  });

  test("never puts the API key in the URL", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => page([], { hasMore: false, nextCursor: null }));

    await fetchReportLines(client, { period: PERIOD });

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).not.toContain("dlerp_");
  });
});

describe("pagination", () => {
  test("follows the cursor until hasMore is false", async () => {
    const pages = [
      page([line({ salesOrderItemId: "a" })], { hasMore: true, nextCursor: "c1" }),
      page([line({ salesOrderItemId: "b" })], { hasMore: true, nextCursor: "c2" }),
      page([line({ salesOrderItemId: "c" })], { hasMore: false, nextCursor: null }),
    ];
    let call = 0;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => pages[call++]!);

    const result = await fetchReportLines(client, { period: PERIOD });

    expect(result.pages).toBe(3);
    expect(result.lines).toHaveLength(3);
    expect(new URL(String(fetchMock.mock.calls[1]?.[0])).searchParams.get("cursor")).toBe("c1");
    expect(new URL(String(fetchMock.mock.calls[2]?.[0])).searchParams.get("cursor")).toBe("c2");
  });

  test("a short page mid-walk does not end the walk", async () => {
    // The ERP filters some rows after paging, so a short page is normal. Stopping
    // on page length rather than on `hasMore` silently truncates the month.
    const pages = [
      page([], { hasMore: true, nextCursor: "c1" }),
      page([line({ salesOrderItemId: "b" })], { hasMore: false, nextCursor: null }),
    ];
    let call = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => pages[call++]!);

    const result = await fetchReportLines(client, { period: PERIOD });
    expect(result.pages).toBe(2);
    expect(result.lines).toHaveLength(1);
  });
});

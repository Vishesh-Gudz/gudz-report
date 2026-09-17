import { afterEach, describe, expect, test, vi } from "vitest";

import { buildErpQuery, createErpClient, ErpApiError, ErpContractError } from "@/lib/erp/client";
import { getSalesOrders, getAllSalesOrderLines } from "@/lib/erp/sales-orders";
import { reportingPeriodFromDays } from "@/lib/dates/reporting-period";
import { salesOrderLineSchema, salesOrderSchema } from "@/types/erp";
import { z } from "zod";

/**
 * ERP client behaviour, against a stubbed `fetch`.
 *
 * Two properties matter most and are easy to get wrong in ways that look fine:
 * that pagination follows the contract's `hasMore` rather than page length, and
 * that the API key never escapes into an error, a URL or a log.
 */

const PERIOD = reportingPeriodFromDays("2026-08-01", "2026-08-31");
const SECRET = "dlerp_test_key_value_do_not_leak";

const client = createErpClient({ baseUrl: "https://erp.example", apiKey: SECRET });

function envelope(data: unknown, meta: Record<string, unknown> = {}) {
  return {
    success: true,
    data,
    meta: { requestId: "req_1", ...meta },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("query serialisation", () => {
  test("drops null and undefined rather than sending empty filters", () => {
    expect(buildErpQuery({ a: "1", b: undefined, c: null })).toBe("?a=1");
  });

  test("joins arrays with commas", () => {
    // The ERP reads repeated params as the last value only, so `?s=a&s=b`
    // would silently mean `b`.
    expect(buildErpQuery({ statuses: ["delivered", "completed"] })).toBe(
      "?statuses=delivered%2Ccompleted",
    );
  });

  test("omits an empty array entirely", () => {
    expect(buildErpQuery({ statuses: [] })).toBe("");
  });

  test("returns an empty string for no query", () => {
    expect(buildErpQuery(undefined)).toBe("");
    expect(buildErpQuery({})).toBe("");
  });
});

describe("requests", () => {
  test("sends the key as a header, never in the URL", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(envelope([])));

    await client.get("/soh/catalog", z.array(z.unknown()), { limit: 10 });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain(SECRET);
    expect(url).toBe("https://erp.example/api/v1/soh/catalog?limit=10");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe(SECRET);
    expect(init.method).toBe("GET");
  });

  test("issues GET and nothing else", async () => {
    // A fresh Response per call: a body can only be read once, so reusing one
    // instance across calls fails on the second read rather than on the assertion.
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => jsonResponse(envelope([])));

    await client.get("/soh/snapshot", z.array(z.unknown()));
    await client.get("/soh/catalog", z.array(z.unknown()));

    for (const call of fetchMock.mock.calls) {
      expect((call[1] as RequestInit).method).toBe("GET");
    }
  });

  test("sends the period as strict UTC timestamps, both bounds inclusive", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(envelope([])));

    await getSalesOrders(client, { period: PERIOD });

    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toContain("from=2026-08-01T00%3A00%3A00.000Z");
    expect(url).toContain("to=2026-08-31T23%3A59%3A59.999Z");
    // Never a date-only string — the ERP rejects those.
    expect(url).not.toMatch(/from=2026-08-01&/);
  });

  test("defaults the period axis to the business order date", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(envelope([])));

    await getSalesOrders(client, { period: PERIOD });
    expect(fetchMock.mock.calls[0]?.[0] as string).toContain("dateField=orderDate");
  });
});

describe("errors", () => {
  test("surfaces the ERP's own code, message and request id", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        {
          success: false,
          error: { code: "FORBIDDEN_SCOPE", message: "Missing soh:read" },
          meta: { requestId: "req_denied" },
        },
        403,
      ),
    );

    await expect(client.get("/soh/catalog", z.array(z.unknown()))).rejects.toMatchObject({
      name: "ErpApiError",
      status: 403,
      code: "FORBIDDEN_SCOPE",
      requestId: "req_denied",
    });
  });

  test("never puts the key in an error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        {
          success: false,
          error: { code: "UNAUTHORIZED", message: "Invalid API key" },
          meta: { requestId: "req_401" },
        },
        401,
      ),
    );

    // An error object is the most likely thing in the system to be logged
    // verbatim, so this is the assertion that keeps the credential out of logs.
    const error = await client
      .get("/soh/catalog", z.array(z.unknown()))
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ErpApiError);
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(SECRET);
    expect((error as Error).message).not.toContain(SECRET);
  });

  test("reports a network failure as such", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(client.get("/soh/catalog", z.array(z.unknown()))).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
  });

  test("reports a non-JSON body without dumping the whole page", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<!doctype html><html>404</html>", { status: 404 }),
    );

    await expect(client.get("/soh/sales-orders", z.array(z.unknown()))).rejects.toMatchObject({
      status: 404,
    });
  });

  test("rejects a 2xx payload that breaks the contract", async () => {
    // A silently-changed ERP field is caught here rather than surfacing as a
    // wrong number three layers downstream.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(envelope([{ salesOrderId: "so_1" }])),
    );

    await expect(
      client.get("/soh/sales-orders", z.array(salesOrderSchema)),
    ).rejects.toBeInstanceOf(ErpContractError);
  });
});

describe("cursor pagination", () => {
  function line(id: string) {
    return {
      salesOrderId: "so_1",
      soNumber: "SO-1",
      referenceNumber: null,
      orderDate: "2026-08-14T00:00:00.000Z",
      dispatchedAt: null,
      deliveredAt: null,
      status: "delivered",
      orderType: "product",
      channel: null,
      channelNormalized: null,
      customerId: "cust_1",
      customerName: "Buyer",
      customerCode: null,
      customerType: "BUSINESS",
      customerGstin: "29AABCB1234C1ZX",
      sourceHubId: null,
      salesOrderItemId: id,
      itemId: "item_1",
      sku: "HM-KHK-100",
      name: "Quinoa Khakhra",
      unit: "pcs",
      hsnCode: null,
      orderedQuantity: 10,
      shippedQuantity: 10,
      deliveredQuantity: 10,
      unitPrice: 42,
      lineTotal: 420,
      taxableValue: 420,
      taxAmount: 21,
      fulfillmentSku: null,
      fulfillmentQuantity: null,
    };
  }

  test("follows hasMore, not page length", async () => {
    // The trap this guards: a middle page shorter than `limit` is normal,
    // because the ERP filters some rows after paging. Stopping there would
    // silently truncate the report.
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse(
          envelope([line("a")], {
            pagination: { limit: 200, nextCursor: "c1", hasMore: true },
          }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          envelope([line("b"), line("c")], {
            pagination: { limit: 200, nextCursor: "c2", hasMore: true },
          }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          envelope([line("d")], {
            pagination: { limit: 200, nextCursor: null, hasMore: false },
          }),
        ),
      );

    const result = await getAllSalesOrderLines(client, { period: PERIOD });
    expect(result.pages).toBe(3);
    expect(result.lines.map((row) => row.salesOrderItemId)).toEqual(["a", "b", "c", "d"]);
  });

  test("stops when hasMore is true but the cursor is null", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        envelope([line("a")], {
          pagination: { limit: 200, nextCursor: null, hasMore: true },
        }),
      ),
    );

    const result = await getAllSalesOrderLines(client, { period: PERIOD });
    expect(result.pages).toBe(1);
  });

  test("round-trips the cursor unchanged", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse(
          envelope([line("a")], {
            pagination: { limit: 200, nextCursor: "opaque+cursor/value", hasMore: true },
          }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          envelope([], { pagination: { limit: 200, nextCursor: null, hasMore: false } }),
        ),
      );

    await getAllSalesOrderLines(client, { period: PERIOD });
    const secondUrl = fetchMock.mock.calls[1]?.[0] as string;
    expect(secondUrl).toContain(`cursor=${encodeURIComponent("opaque+cursor/value")}`);
  });

  test("keeps the first page's summary, which describes the whole set", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse(
          envelope([line("a")], {
            pagination: { limit: 200, nextCursor: "c1", hasMore: true },
            summary: {
              orders: 9,
              totalAmount: 1000,
              totalQuantity: 50,
              distinctCustomers: 3,
              distinctSkus: 4,
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          envelope([], { pagination: { limit: 200, nextCursor: null, hasMore: false } }),
        ),
      );

    const result = await getAllSalesOrderLines(client, { period: PERIOD });
    expect(result.summary?.orders).toBe(9);
  });

  test("throws rather than returning a partial set at the page guard", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      jsonResponse(
        envelope([line("a")], {
          pagination: { limit: 200, nextCursor: "always-more", hasMore: true },
        }),
      ),
    );

    await expect(
      client.getAllPages("/soh/sales-order-lines", salesOrderLineSchema, {}, { maxPages: 3 }),
    ).rejects.toMatchObject({ code: "PAGINATION_LIMIT" });
  });
});

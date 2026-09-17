import { z } from "zod";

import { erpErrorSchema, erpSuccessSchema } from "../../types/erp";
import type { CursorPagination, Period, SalesOrderSummary } from "../../types/erp";

/**
 * HTTP client for the delivery-erp `/api/v1` surface.
 *
 * Two deliberate constraints shape this module.
 *
 * **It can only read.** There is no `method` parameter anywhere — every request
 * this client is capable of constructing is a GET. That is stronger than a code
 * review rule: a write cannot be introduced by passing a different argument,
 * only by editing this file.
 *
 * **It never owns a credential.** Configuration is injected, not imported, so
 * the same code runs under Next's server runtime and inside a Convex action
 * without either one reaching for a secret the other holds. The key is read
 * from the environment at the two call sites that legitimately have one.
 */

export interface ErpClientConfig {
  /** Base origin, no trailing slash and no `/api/v1` suffix. */
  readonly baseUrl: string;
  /** Sent as `x-api-key`. Never logged, never returned, never put in a URL. */
  readonly apiKey: string;
  /** Per-request timeout. Defaults to 30s. */
  readonly timeoutMs?: number;
}

export type ErpQueryValue =
  | string
  | number
  | boolean
  | ReadonlyArray<string>
  | undefined
  | null;

export type ErpQuery = Readonly<Record<string, ErpQueryValue>>;

/**
 * A failed ERP call.
 *
 * Carries the ERP's own error code and request id so a failure can be traced in
 * their logs. It deliberately does not carry the request headers — an error
 * object is the most likely thing in the system to be logged verbatim, and the
 * API key must never be in one.
 */
export class ErpApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  readonly path: string;
  readonly details?: unknown;

  constructor(args: {
    status: number;
    code: string;
    message: string;
    requestId: string | null;
    path: string;
    details?: unknown;
  }) {
    super(`ERP ${args.status} ${args.code} on ${args.path}: ${args.message}`);
    this.name = "ErpApiError";
    this.status = args.status;
    this.code = args.code;
    this.requestId = args.requestId;
    this.path = args.path;
    this.details = args.details;
  }
}

/** The ERP returned 2xx but a payload that does not match the agreed contract. */
export class ErpContractError extends Error {
  readonly path: string;
  readonly issues: string[];

  constructor(path: string, issues: string[]) {
    super(`ERP response did not match the expected contract on ${path}: ${issues.join("; ")}`);
    this.name = "ErpContractError";
    this.path = path;
    this.issues = issues;
  }
}

export interface ErpResponse<T> {
  readonly data: T;
  readonly requestId: string;
  readonly pagination?: CursorPagination;
  readonly period?: Period;
  readonly summary?: SalesOrderSummary;
}

/**
 * Serialises a query object the way the ERP expects.
 *
 * Arrays go out comma-separated: the ERP reads repeated parameters as the last
 * value only, so `?statuses=a&statuses=b` would silently mean `b`. Null and
 * undefined are dropped rather than sent as empty strings, which the ERP would
 * treat as a real (and failing) filter value.
 */
export function buildErpQuery(query: ErpQuery | undefined): string {
  if (!query) return "";
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      const list = value.filter((entry) => entry.length > 0);
      if (list.length > 0) params.set(key, list.join(","));
      continue;
    }
    params.set(key, String(value));
  }

  const serialised = params.toString();
  return serialised ? `?${serialised}` : "";
}

function issuesOf(error: z.ZodError): string[] {
  return error.issues.map(
    (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
  );
}

export function createErpClient(config: ErpClientConfig) {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const timeoutMs = config.timeoutMs ?? 30_000;

  /**
   * One authenticated GET, validated against `schema`.
   *
   * `path` is relative to `/api/v1`, e.g. `/soh/sales-orders`.
   */
  async function get<T extends z.ZodType>(
    path: string,
    schema: T,
    query?: ErpQuery,
  ): Promise<ErpResponse<z.infer<T>>> {
    const url = `${baseUrl}/api/v1${path}${buildErpQuery(query)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: {
          "x-api-key": config.apiKey,
          Accept: "application/json",
        },
        signal: controller.signal,
        // Reporting data changes; a cached page would quietly serve yesterday's
        // numbers under today's filters.
        cache: "no-store",
      });
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : "unknown error";
      throw new ErpApiError({
        status: 0,
        code: "NETWORK_ERROR",
        message: `Could not reach the ERP (${reason})`,
        requestId: null,
        path,
      });
    } finally {
      clearTimeout(timer);
    }

    const bodyText = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(bodyText);
    } catch {
      throw new ErpApiError({
        status: response.status,
        code: response.ok ? "INVALID_JSON" : "HTTP_ERROR",
        // The body may be an HTML error page; a short excerpt is enough to
        // diagnose and cannot swamp a log.
        message: `Expected JSON, received: ${bodyText.slice(0, 200)}`,
        requestId: response.headers.get("x-request-id"),
        path,
      });
    }

    if (!response.ok) {
      const parsedError = erpErrorSchema.safeParse(body);
      throw new ErpApiError({
        status: response.status,
        code: parsedError.success ? parsedError.data.error.code : "HTTP_ERROR",
        message: parsedError.success
          ? parsedError.data.error.message
          : `Request failed with status ${response.status}`,
        requestId:
          (parsedError.success ? parsedError.data.meta.requestId : null) ??
          response.headers.get("x-request-id"),
        path,
        details: parsedError.success ? parsedError.data.error.details : undefined,
      });
    }

    const parsed = erpSuccessSchema(schema).safeParse(body);
    if (!parsed.success) {
      throw new ErpContractError(path, issuesOf(parsed.error));
    }

    return {
      data: parsed.data.data as z.infer<T>,
      requestId: parsed.data.meta.requestId,
      pagination: parsed.data.meta.pagination,
      period: parsed.data.meta.period,
      summary: parsed.data.meta.summary,
    };
  }

  /**
   * Walks every page of a cursor-paged collection.
   *
   * The stop condition is the contract's own: `hasMore === false` or a null
   * `nextCursor`. It is explicitly **not** "the page came back shorter than
   * `limit`" — several ERP endpoints filter rows after paging (`includeZero`,
   * zero-signal rows), so a short page in the middle of a walk is normal and
   * treating it as the end silently truncates the report.
   *
   * `maxPages` is a runaway guard, not a limit anyone should rely on: exceeding
   * it throws rather than returning a partial answer that looks complete.
   */
  async function getAllPages<T extends z.ZodType>(
    path: string,
    schema: T,
    query?: ErpQuery,
    options?: { readonly maxPages?: number },
  ): Promise<{
    rows: z.infer<T>[];
    pages: number;
    period?: Period;
    summary?: SalesOrderSummary;
  }> {
    const maxPages = options?.maxPages ?? 500;
    const rows: z.infer<T>[] = [];
    let cursor: string | undefined;
    let pages = 0;
    let period: Period | undefined;
    let summary: SalesOrderSummary | undefined;

    for (;;) {
      const page = await get(path, z.array(schema), { ...query, cursor });
      pages += 1;
      rows.push(...(page.data as z.infer<T>[]));
      period ??= page.period;
      // The summary describes the whole filtered set, so the first page's copy
      // is the answer; later pages repeat it.
      summary ??= page.summary;

      const next = page.pagination;
      if (!next || !next.hasMore || !next.nextCursor) break;

      if (pages >= maxPages) {
        throw new ErpApiError({
          status: 0,
          code: "PAGINATION_LIMIT",
          message:
            `Stopped after ${pages} pages with more results remaining. ` +
            "Narrow the reporting period or raise maxPages — returning a partial set would look complete.",
          requestId: page.requestId,
          path,
        });
      }

      cursor = next.nextCursor;
    }

    return { rows, pages, period, summary };
  }

  return { get, getAllPages };
}

export type ErpClient = ReturnType<typeof createErpClient>;

import "server-only";

import { ConvexHttpClient } from "convex/browser";

/**
 * Convex access from Next server code.
 *
 * Returns null when the deployment URL is not configured rather than throwing.
 * The dashboard is useful before Convex is initialised — it can read the ERP and
 * report real orders with every row marked ERP-only — and a hard failure here
 * would make the whole page unavailable for a dependency only half of it needs.
 *
 * Despite the `convex/browser` import path, `ConvexHttpClient` is the plain HTTP
 * client and is the right thing to use from a Server Component. It carries no
 * credential of its own: the ERP key lives in the Convex deployment's
 * environment, never in a request from here.
 */

let cached: ConvexHttpClient | null | undefined;

export function getConvexClient(): ConvexHttpClient | null {
  if (cached !== undefined) return cached;

  const url = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  cached = url ? new ConvexHttpClient(url) : null;
  return cached;
}

/** Whether Convex has been initialised for this environment. */
export function isConvexConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CONVEX_URL?.trim());
}

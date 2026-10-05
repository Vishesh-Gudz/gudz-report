import { ConvexHttpClient } from "convex/browser";

/**
 * The Convex client the upload screen uses.
 *
 * Plain HTTP rather than the reactive client: the upload flow starts one import
 * and then polls one snapshot, which is a request and a loop, not a subscription
 * that justifies a provider around the whole tree.
 *
 * `NEXT_PUBLIC_CONVEX_URL` is public by design — it is the deployment's address,
 * not a credential. The ERP key is a different matter entirely and never leaves
 * the server: `ERP_API_KEY` lives in Convex's own environment and is read by the
 * import action, never by anything that reaches a browser.
 */

let cached: ConvexHttpClient | null | undefined;

export function getBrowserConvexClient(): ConvexHttpClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  cached = url ? new ConvexHttpClient(url) : null;
  return cached;
}

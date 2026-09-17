import "server-only";

import { getServerConfig } from "@/lib/config";
import { createErpClient, type ErpClient } from "./client";

/**
 * The ERP client bound to this app's server configuration.
 *
 * Kept apart from `./client` on purpose. The client itself takes its config as
 * an argument and imports nothing secret, so it can also run inside a Convex
 * action where the credential comes from Convex's own environment. This module
 * is the Next-server binding, and it is the only one that reads the key from
 * `process.env` — `server-only` makes importing it from a Client Component a
 * build error rather than a leak.
 */

let cached: ErpClient | null = null;

export function getErpClient(): ErpClient {
  if (cached) return cached;
  const config = getServerConfig();
  cached = createErpClient({
    baseUrl: config.ERP_API_URL,
    apiKey: config.ERP_API_KEY,
  });
  return cached;
}

export { ErpApiError, ErpContractError } from "./client";
export type { ErpClient, ErpClientConfig } from "./client";
export * from "./sales-orders";
export * from "./catalog";
export * from "./snapshot";

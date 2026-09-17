import "server-only";

import { z } from "zod";

/**
 * Server-side configuration.
 *
 * `import "server-only"` is the load-bearing line: it makes the build fail if
 * this module is ever pulled into a Client Component. The ERP API key is a
 * full-tenant credential, and the difference between "server-side config" and
 * "a secret in the browser bundle" is exactly one careless import. A runtime
 * check would catch that too late — after the bundle shipped.
 *
 * Nothing here is prefixed `NEXT_PUBLIC_`, and nothing here may ever be.
 */

const serverEnvSchema = z.object({
  ERP_API_URL: z
    .url("ERP_API_URL must be an absolute URL, e.g. https://api.delivery.gudz.in")
    .describe("Base URL of the delivery-erp API. No trailing slash, no /api/v1 suffix."),
  ERP_API_KEY: z
    .string()
    .min(1, "ERP_API_KEY is required")
    .describe("Organisation API key sent as the x-api-key header. Server-side only."),
});

export type ServerConfig = Readonly<z.infer<typeof serverEnvSchema>>;

let cached: ServerConfig | null = null;

/**
 * Reads and validates the server configuration.
 *
 * Throws with the offending variable *names* only. A validation library will
 * happily include the received value in its message, which for a credential
 * means printing the secret into a log the moment someone fat-fingers it — so
 * the failure is re-raised by hand rather than passed through.
 */
export function getServerConfig(): ServerConfig {
  if (cached) return cached;

  const parsed = serverEnvSchema.safeParse({
    ERP_API_URL: process.env.ERP_API_URL,
    ERP_API_KEY: process.env.ERP_API_KEY,
  });

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(
      `Invalid server configuration — ${problems}. ` +
        "Set these in .env.local (see .env.example). Never prefix them NEXT_PUBLIC_.",
    );
  }

  cached = Object.freeze({
    ERP_API_URL: parsed.data.ERP_API_URL.replace(/\/+$/, ""),
    ERP_API_KEY: parsed.data.ERP_API_KEY,
  });

  return cached;
}

/**
 * Whether the configuration is usable, without reading or revealing any value.
 *
 * For health checks and setup screens that need to say "the key is missing"
 * without being able to say what it is.
 */
export function getConfigStatus(): {
  erpApiUrl: string | null;
  erpApiKeyPresent: boolean;
  ready: boolean;
} {
  const url = process.env.ERP_API_URL?.trim() ?? "";
  const key = process.env.ERP_API_KEY?.trim() ?? "";
  return {
    // The URL is not a secret; the key's mere presence is all that is reported.
    erpApiUrl: url || null,
    erpApiKeyPresent: key.length > 0,
    ready: url.length > 0 && key.length > 0,
  };
}

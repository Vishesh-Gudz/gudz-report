import { readFileSync } from "node:fs";

/**
 * Loads `.env.local` for tests that talk to the live ERP.
 *
 * Hand-rolled rather than pulling in `dotenv`: the app itself never needs it
 * (Next injects `.env.local`), and a dependency added only for tests is a
 * dependency shipped to everyone.
 *
 * Values are never logged. `hasLiveErp()` reports only presence, so a suite can
 * skip itself on a machine without credentials instead of failing.
 */
export function loadLocalEnv(path = ".env.local"): void {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

/** Whether a live ERP run is possible here. Reports presence, never a value. */
export function hasLiveErp(): boolean {
  loadLocalEnv();
  return Boolean(process.env.ERP_API_URL) && Boolean(process.env.ERP_API_KEY);
}

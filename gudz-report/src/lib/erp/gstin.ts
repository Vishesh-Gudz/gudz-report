/**
 * GSTIN folding, matching the ERP's own rule.
 *
 * A GSTIN is 15 upper-case alphanumerics with no internal spaces, but it is
 * typed by humans into a free-text column, so it arrives padded, lower-cased and
 * occasionally space-separated. Whitespace is **stripped**, not collapsed —
 * unlike a channel name, a real GSTIN contains none, so an internal space is
 * noise rather than a separator.
 *
 * This deliberately mirrors what the ERP does on its side, so a GSTIN returned
 * by the API and a GSTIN typed into this dashboard's configuration fold to the
 * same key. If the two rules drifted, a correctly-configured marketplace would
 * silently stop matching.
 *
 * Returns null for blank input so a caller cannot accidentally filter on "".
 */
export function normalizeGstin(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const folded = raw.replace(/\s+/g, "").toUpperCase();
  return folded || null;
}

/**
 * Whether a string looks like a well-formed GSTIN.
 *
 * Advisory only — used to warn in the configuration UI, never to filter. The
 * ERP stores GSTIN as free text and has rows that are not well-formed; refusing
 * those would make real customers unfilterable, which is worse than matching
 * what is actually stored.
 */
export function looksLikeGstin(raw: string | null | undefined): boolean {
  const gstin = normalizeGstin(raw);
  if (!gstin) return false;
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z][Z][0-9A-Z]$/.test(gstin);
}

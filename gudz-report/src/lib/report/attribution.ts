import { normalizeGstin } from "../erp/gstin";
import { UNATTRIBUTED } from "./policy";

/**
 * Which marketplace an ERP order belongs to.
 *
 * Production data settled how this is decided. Three things were true of real
 * Healthy Master orders:
 *
 *   - roughly half carry no `channel` at all;
 *   - `channel = "Blinkit"` appeared on orders raised to Healthy Master's own
 *     legal entity, not to Blinkit;
 *   - the real Blinkit buyer appears under several customer records and several
 *     spellings (`BLINK COMMERCE PRIVATE LIMITED`, `… LIMIT-`, `… LIMIT-ED`,
 *     `… LIMITED Jaipur`).
 *
 * So identity comes from the registered **GSTIN**, and `channel` is kept as
 * provenance only. Attributing by channel would pick the wrong orders — not
 * approximately, but a different set entirely.
 *
 * The mapping itself is configuration, held in Convex and passed in here. It is
 * a fact about this business ("GSTIN 29… is Blinkit"), not about the ERP, and
 * hard-coding it would make this module useful to exactly one customer.
 */

export interface MarketplaceMapping {
  readonly marketplace: string;
  /** One marketplace can hold several GSTINs — regional entities register separately. */
  readonly customerGstins: ReadonlyArray<string>;
  /** Channel strings seen on these orders. Provenance only, never identity. */
  readonly knownChannelValues?: ReadonlyArray<string>;
}

export interface AttributionInput {
  readonly customerGstin?: string | null;
  readonly customerId?: string | null;
  readonly customerName?: string | null;
  /** Read for reporting only. Deliberately not used to decide the marketplace. */
  readonly channel?: string | null;
}

export interface Attribution {
  /** A configured marketplace name, or `Unattributed`. */
  readonly marketplace: string;
  readonly attributed: boolean;
  /** Why the row landed where it did — shown in the data-quality view. */
  readonly reason:
    | "gstin"
    | "noGstin"
    | "unmappedGstin";
  /** Normalised GSTIN, when the row had one. */
  readonly gstin: string | null;
  /**
   * Stable grouping key even when unattributed, so rows without a GSTIN still
   * group per buyer instead of collapsing into one anonymous pile.
   */
  readonly identity: string;
}

/**
 * An index from GSTIN to marketplace.
 *
 * Built once per report rather than scanned per row: a month of lines is tens of
 * thousands of rows, and a linear search through the mapping for each one is
 * work for nothing.
 */
export class MarketplaceIndex {
  private readonly byGstin: Map<string, string>;
  readonly marketplaces: ReadonlyArray<string>;

  constructor(mappings: ReadonlyArray<MarketplaceMapping>) {
    this.byGstin = new Map();
    for (const mapping of mappings) {
      for (const raw of mapping.customerGstins) {
        const gstin = normalizeGstin(raw);
        // A GSTIN claimed by two marketplaces is a configuration error, not a
        // tie to break silently. First wins, and the duplicate is reported.
        if (gstin && !this.byGstin.has(gstin)) {
          this.byGstin.set(gstin, mapping.marketplace);
        }
      }
    }
    this.marketplaces = mappings.map((mapping) => mapping.marketplace);
  }

  /** GSTINs configured under more than one marketplace. */
  static conflicts(
    mappings: ReadonlyArray<MarketplaceMapping>,
  ): { gstin: string; marketplaces: string[] }[] {
    const seen = new Map<string, string[]>();
    for (const mapping of mappings) {
      for (const raw of mapping.customerGstins) {
        const gstin = normalizeGstin(raw);
        if (!gstin) continue;
        seen.set(gstin, [...(seen.get(gstin) ?? []), mapping.marketplace]);
      }
    }
    return [...seen.entries()]
      .filter(([, names]) => new Set(names).size > 1)
      .map(([gstin, marketplaces]) => ({ gstin, marketplaces: [...new Set(marketplaces)] }));
  }

  /**
   * Attributes one row.
   *
   * A row is never dropped. Without a GSTIN, or with one nobody has mapped, it
   * lands in `Unattributed` with the reason attached — a number that quietly
   * excluded rows would be wrong in the direction nobody checks.
   */
  attribute(input: AttributionInput): Attribution {
    const gstin = normalizeGstin(input.customerGstin);

    if (!gstin) {
      return {
        marketplace: UNATTRIBUTED,
        attributed: false,
        reason: "noGstin",
        gstin: null,
        // Fall back to the customer id, then the name, so unattributed rows
        // still separate per buyer instead of merging into one bucket.
        identity:
          input.customerId ?? input.customerName ?? UNATTRIBUTED,
      };
    }

    const marketplace = this.byGstin.get(gstin);
    if (!marketplace) {
      return {
        marketplace: UNATTRIBUTED,
        attributed: false,
        reason: "unmappedGstin",
        gstin,
        identity: gstin,
      };
    }

    return {
      marketplace,
      attributed: true,
      reason: "gstin",
      gstin,
      identity: gstin,
    };
  }
}

/**
 * The default configuration, used to seed Convex on first run.
 *
 * Empty on purpose. A GSTIN written here would be a guess presented as a fact,
 * and the first report built on it would look authoritative and be wrong. The
 * mapping is added through configuration once someone confirms which GSTIN
 * Blinkit actually trades under — the shape below is what that looks like:
 *
 *   { marketplace: "blinkit", customerGstins: ["29AABCB1234C1ZX"] }
 *
 * Until then every row reports as `Unattributed`, which is visible and correct.
 */
export const DEFAULT_MARKETPLACES: ReadonlyArray<MarketplaceMapping> = [];

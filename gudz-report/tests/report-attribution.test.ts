import { describe, expect, test } from "vitest";

import { MarketplaceIndex, DEFAULT_MARKETPLACES } from "@/lib/report/attribution";
import {
  EXCLUDED_STATUSES,
  REPORTABLE_STATUSES,
  isReportableStatus,
  reportedQuantity,
} from "@/lib/report/policy";
import { normalizeGstin, looksLikeGstin } from "@/lib/erp/gstin";

/**
 * Marketplace attribution and the reporting policy.
 *
 * Both were decided by looking at real Healthy Master data, and both are places
 * where a plausible-looking shortcut produces a confidently wrong report. These
 * tests pin the decisions so a later "simplification" has to argue with them.
 */

const BLINKIT = "29AABCB1234C1ZX";
const SELF = "29AAFCS9999A1Z5";

const index = new MarketplaceIndex([
  { marketplace: "blinkit", customerGstins: [BLINKIT] },
  { marketplace: "zepto", customerGstins: ["27ZZZZZ1111Z1Z1"] },
]);

describe("GSTIN folding", () => {
  test("folds case and whitespace, including internal", () => {
    expect(normalizeGstin(" 29aabcb1234c1zx ")).toBe(BLINKIT);
    expect(normalizeGstin("29 AABCB 1234 C1ZX")).toBe(BLINKIT);
  });

  test("blank is no GSTIN, not an empty one", () => {
    expect(normalizeGstin("")).toBeNull();
    expect(normalizeGstin("   ")).toBeNull();
    expect(normalizeGstin(null)).toBeNull();
  });

  test("format checking is advisory, never a filter", () => {
    // The ERP stores GSTIN as free text and has malformed rows; refusing those
    // would make real customers unfilterable.
    expect(looksLikeGstin(BLINKIT)).toBe(true);
    expect(looksLikeGstin("not-a-gstin")).toBe(false);
    expect(normalizeGstin("not-a-gstin")).toBe("NOT-A-GSTIN");
  });
});

describe("marketplace attribution", () => {
  test("identifies a marketplace by GSTIN", () => {
    const result = index.attribute({ customerGstin: BLINKIT });
    expect(result.marketplace).toBe("blinkit");
    expect(result.attributed).toBe(true);
    expect(result.reason).toBe("gstin");
  });

  test("matches a messily-stored GSTIN", () => {
    expect(index.attribute({ customerGstin: " 29aabcb1234c1zx " }).marketplace).toBe(
      "blinkit",
    );
  });

  test("ignores channel entirely when deciding the marketplace", () => {
    // The finding this guards: `channel = "Blinkit"` appeared in production on
    // orders raised to Healthy Master's own entity. Trusting it selects the
    // wrong orders — not approximately, a different set.
    const ownEntity = index.attribute({ customerGstin: SELF, channel: "Blinkit" });
    expect(ownEntity.marketplace).toBe("Unattributed");
    expect(ownEntity.attributed).toBe(false);
    expect(ownEntity.reason).toBe("unmappedGstin");

    // …and a real Blinkit order with no channel at all is still attributed.
    const realBlinkit = index.attribute({ customerGstin: BLINKIT, channel: null });
    expect(realBlinkit.marketplace).toBe("blinkit");
  });

  test("a missing GSTIN becomes Unattributed, never dropped", () => {
    const result = index.attribute({
      customerGstin: null,
      customerId: "cust_9",
      customerName: "AGI Vending Machine",
    });
    expect(result.marketplace).toBe("Unattributed");
    expect(result.reason).toBe("noGstin");
    // Still grouped per buyer rather than collapsed into one anonymous pile.
    expect(result.identity).toBe("cust_9");
  });

  test("falls back to the customer name when there is no id either", () => {
    expect(
      index.attribute({ customerGstin: null, customerName: "Walk-in" }).identity,
    ).toBe("Walk-in");
  });

  test("an unmapped GSTIN is distinguishable from a missing one", () => {
    // Different fixes: one needs configuration, the other needs ERP data.
    expect(index.attribute({ customerGstin: SELF }).reason).toBe("unmappedGstin");
    expect(index.attribute({ customerGstin: null }).reason).toBe("noGstin");
  });

  test("several GSTINs can map to one marketplace", () => {
    const multi = new MarketplaceIndex([
      { marketplace: "blinkit", customerGstins: [BLINKIT, "07AABCB1234C1ZZ"] },
    ]);
    expect(multi.attribute({ customerGstin: BLINKIT }).marketplace).toBe("blinkit");
    expect(multi.attribute({ customerGstin: "07AABCB1234C1ZZ" }).marketplace).toBe(
      "blinkit",
    );
  });

  test("reports a GSTIN claimed by two marketplaces instead of silently picking", () => {
    const mappings = [
      { marketplace: "blinkit", customerGstins: [BLINKIT] },
      { marketplace: "zepto", customerGstins: [BLINKIT] },
    ];
    const conflicts = MarketplaceIndex.conflicts(mappings);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.gstin).toBe(BLINKIT);
    expect(conflicts[0]?.marketplaces.sort()).toEqual(["blinkit", "zepto"]);
  });

  test("ships with no mapping, so nothing is attributed by a guess", () => {
    // A GSTIN written into the default config would be a guess presented as a
    // fact, and the first report built on it would look authoritative.
    expect(DEFAULT_MARKETPLACES).toEqual([]);
    const empty = new MarketplaceIndex(DEFAULT_MARKETPLACES);
    expect(empty.attribute({ customerGstin: BLINKIT }).marketplace).toBe("Unattributed");
  });
});

describe("reporting policy", () => {
  test("counts only approved, completed and delivered", () => {
    expect([...REPORTABLE_STATUSES]).toEqual(["approved", "completed", "delivered"]);
    for (const status of REPORTABLE_STATUSES) {
      expect(isReportableStatus(status), status).toBe(true);
    }
  });

  test("excludes drafts — the reason the allow-list exists", () => {
    // About a third of production orders are drafts. `excludeCancelled` alone
    // does not remove them, so relying on it overstates every headline number.
    expect(isReportableStatus("draft")).toBe(false);
    expect(isReportableStatus("cancelled")).toBe(false);
    expect([...EXCLUDED_STATUSES]).toEqual(["draft", "cancelled"]);
  });

  test("an unknown status is excluded until someone decides it counts", () => {
    // Allow-list, not deny-list: a status added to the ERP later stays out,
    // which is the safe direction to be wrong in.
    expect(isReportableStatus("awaiting_approval")).toBe(false);
    expect(isReportableStatus("")).toBe(false);
  });

  test("the sales quantity is orderedQuantity", () => {
    // Production has approved, invoiced orders with shipped/delivered at zero.
    // Deriving the headline from those reports a business that sells nothing.
    expect(
      reportedQuantity({ orderedQuantity: 75 }),
    ).toBe(75);
  });
});

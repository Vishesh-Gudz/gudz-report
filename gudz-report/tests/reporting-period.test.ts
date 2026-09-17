import { describe, expect, test } from "vitest";

import {
  endOfUtcDay,
  formatPeriod,
  monthPeriod,
  periodContains,
  periodLengthInDays,
  reportingPeriodFromDates,
  reportingPeriodFromDays,
  startOfUtcDay,
  toCalendarDay,
} from "@/lib/dates/reporting-period";

/**
 * The reporting period is where the two halves of the report agree on what
 * "August" means. If the Excel side and the ERP side disagree by one
 * millisecond at either end, the reconciliation reports a variance that is
 * really a boundary bug — so the boundaries are pinned here explicitly.
 */

describe("day boundaries", () => {
  test("start of day is the first instant, UTC", () => {
    expect(startOfUtcDay("2026-08-01")).toBe("2026-08-01T00:00:00.000Z");
  });

  test("end of day is the last millisecond, not the next midnight", () => {
    // The ERP's `to` bound is inclusive: rolling to 00:00 of the next day would
    // pull that whole day's orders into the period.
    expect(endOfUtcDay("2026-08-31")).toBe("2026-08-31T23:59:59.999Z");
  });

  test("rejects anything that is not a calendar day", () => {
    expect(() => startOfUtcDay("2026-8-1")).toThrow();
    expect(() => endOfUtcDay("31/08/2026")).toThrow();
  });
});

describe("building a period", () => {
  test("produces inclusive UTC bounds for the ERP", () => {
    const period = reportingPeriodFromDays("2026-08-01", "2026-08-31");
    expect(period.fromIso).toBe("2026-08-01T00:00:00.000Z");
    expect(period.toIso).toBe("2026-08-31T23:59:59.999Z");
  });

  test("orders the days if they arrive reversed", () => {
    const period = reportingPeriodFromDays("2026-08-31", "2026-08-01");
    expect(period.fromDay).toBe("2026-08-01");
    expect(period.toDay).toBe("2026-08-31");
  });

  test("a single day is a valid one-day period", () => {
    const period = reportingPeriodFromDays("2026-08-14", "2026-08-14");
    expect(periodLengthInDays(period)).toBe(1);
    expect(period.fromIso).toBe("2026-08-14T00:00:00.000Z");
    expect(period.toIso).toBe("2026-08-14T23:59:59.999Z");
  });

  test("counts whole days inclusively", () => {
    expect(periodLengthInDays(reportingPeriodFromDays("2026-08-01", "2026-08-31"))).toBe(31);
    expect(periodLengthInDays(reportingPeriodFromDays("2026-02-01", "2026-02-28"))).toBe(28);
  });

  test("formats for a human", () => {
    expect(formatPeriod(reportingPeriodFromDays("2026-08-01", "2026-08-31"))).toBe(
      "2026-08-01 → 2026-08-31",
    );
  });
});

describe("deriving a period from spreadsheet dates", () => {
  test("spans the earliest and latest date present", () => {
    const period = reportingPeriodFromDates([
      "2026-08-14T09:00:00.000Z",
      "2026-08-02T00:00:00.000Z",
      "2026-08-27T23:00:00.000Z",
    ]);
    expect(period?.fromDay).toBe("2026-08-02");
    expect(period?.toDay).toBe("2026-08-27");
  });

  test("ignores unreadable values rather than failing the whole file", () => {
    const period = reportingPeriodFromDates(["2026-08-05", "not a date", "2026-08-09"]);
    expect(period?.fromDay).toBe("2026-08-05");
    expect(period?.toDay).toBe("2026-08-09");
  });

  test("returns null when nothing usable is present", () => {
    // A refusal, not a default: an invented window would be reconciled against
    // ERP data nobody asked for.
    expect(reportingPeriodFromDates([])).toBeNull();
    expect(reportingPeriodFromDates(["", "nonsense"])).toBeNull();
  });
});

describe("containment", () => {
  const period = reportingPeriodFromDays("2026-08-01", "2026-08-31");

  test("includes both boundaries", () => {
    expect(periodContains(period, "2026-08-01T00:00:00.000Z")).toBe(true);
    expect(periodContains(period, "2026-08-31T23:59:59.999Z")).toBe(true);
  });

  test("excludes one millisecond outside either edge", () => {
    expect(periodContains(period, "2026-07-31T23:59:59.999Z")).toBe(false);
    expect(periodContains(period, "2026-09-01T00:00:00.000Z")).toBe(false);
  });

  test("an unreadable value is not inside anything", () => {
    expect(periodContains(period, "not a date")).toBe(false);
  });
});

describe("calendar days and months", () => {
  test("reads a calendar day in UTC", () => {
    expect(toCalendarDay(new Date("2026-08-14T23:30:00.000Z"))).toBe("2026-08-14");
  });

  test("a month period covers the whole month", () => {
    expect(monthPeriod("2026-08")).toMatchObject({
      fromDay: "2026-08-01",
      toDay: "2026-08-31",
    });
    // February, and a leap year, are where a naive "day 30" would break.
    expect(monthPeriod("2026-02").toDay).toBe("2026-02-28");
    expect(monthPeriod("2028-02").toDay).toBe("2028-02-29");
  });

  test("rejects a malformed month", () => {
    expect(() => monthPeriod("2026-8")).toThrow();
  });
});

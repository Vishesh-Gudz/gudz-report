import { z } from "zod";

/**
 * The reporting period, and the one place it is allowed to be expressed.
 *
 * The workflow is: a spreadsheet arrives, its rows imply a date range, and the
 * ERP is then asked for the B2B sales orders in that same range. Those two
 * halves have to mean exactly the same window or the reconciliation compares
 * different months and calls the difference a variance.
 *
 * Everything here is **UTC**. There is deliberately no timezone parameter yet:
 * the ERP stores `order_date` as a date, and every value observed in production
 * sits at midnight UTC, so a local-time offset cannot currently move an order
 * between days. Introducing a timezone knob before that stops being true would
 * add a way to be wrong with no way to be more right.
 *
 * Both bounds are **inclusive**, matching the ERP: `from` is the first instant
 * of its day, `to` the last millisecond of its day.
 */

/** A calendar day in `YYYY-MM-DD`, the form a spreadsheet cell reduces to. */
export const calendarDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a calendar day as YYYY-MM-DD");

export type CalendarDay = z.infer<typeof calendarDaySchema>;

export interface ReportingPeriod {
  /** Inclusive first day, `YYYY-MM-DD`. */
  readonly fromDay: CalendarDay;
  /** Inclusive last day, `YYYY-MM-DD`. */
  readonly toDay: CalendarDay;
  /** `fromDay` at 00:00:00.000Z — send this as the ERP's `from`. */
  readonly fromIso: string;
  /** `toDay` at 23:59:59.999Z — send this as the ERP's `to`. */
  readonly toIso: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` for an instant, read in UTC. */
export function toCalendarDay(value: Date | string | number): CalendarDay {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Cannot read a calendar day from ${JSON.stringify(value)}`);
  }
  return date.toISOString().slice(0, 10) as CalendarDay;
}

/** Start of a UTC day, inclusive. */
export function startOfUtcDay(day: CalendarDay): string {
  return `${calendarDaySchema.parse(day)}T00:00:00.000Z`;
}

/**
 * End of a UTC day, inclusive.
 *
 * `.999` rather than the next midnight: the ERP's `to` bound is inclusive, so
 * rolling over to 00:00 of the following day would pull in that day's orders.
 */
export function endOfUtcDay(day: CalendarDay): string {
  return `${calendarDaySchema.parse(day)}T23:59:59.999Z`;
}

/** Builds a period from two calendar days, ordering them if they arrive reversed. */
export function reportingPeriodFromDays(
  fromDay: CalendarDay,
  toDay: CalendarDay,
): ReportingPeriod {
  const from = calendarDaySchema.parse(fromDay);
  const to = calendarDaySchema.parse(toDay);
  const [first, last] = from <= to ? [from, to] : [to, from];

  return Object.freeze({
    fromDay: first,
    toDay: last,
    fromIso: startOfUtcDay(first),
    toIso: endOfUtcDay(last),
  });
}

/**
 * Derives the period a set of spreadsheet dates covers.
 *
 * Returns null for an empty set rather than inventing a window — a file with no
 * usable dates is a file to reject, not one to silently report "today" for.
 */
export function reportingPeriodFromDates(
  dates: ReadonlyArray<Date | string | number>,
): ReportingPeriod | null {
  const days: CalendarDay[] = [];
  for (const value of dates) {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(date.getTime())) days.push(toCalendarDay(date));
  }
  if (days.length === 0) return null;

  days.sort();
  return reportingPeriodFromDays(days[0]!, days[days.length - 1]!);
}

/**
 * Whole days covered, both ends inclusive. A single-day period is 1, not 0.
 *
 * Measured midnight to midnight, not `fromIso` to `toIso`: the end bound is
 * 23:59:59.999, so subtracting the two instants leaves a day-minus-one-
 * millisecond remainder that rounds up and reports one day too many.
 */
export function periodLengthInDays(period: ReportingPeriod): number {
  const from = Date.parse(startOfUtcDay(period.fromDay));
  const to = Date.parse(startOfUtcDay(period.toDay));
  return Math.round((to - from) / DAY_MS) + 1;
}

/** Whether an instant falls inside the period, both bounds inclusive. */
export function periodContains(
  period: ReportingPeriod,
  value: Date | string | number,
): boolean {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const at = date.getTime();
  return at >= Date.parse(period.fromIso) && at <= Date.parse(period.toIso);
}

/** Human label, e.g. `2026-08-01 → 2026-08-31`. */
export function formatPeriod(period: ReportingPeriod): string {
  return `${period.fromDay} → ${period.toDay}`;
}

/** The whole of one calendar month, `YYYY-MM`. */
export function monthPeriod(month: string): ReportingPeriod {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new Error(`Expected a month as YYYY-MM, received ${month}`);
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  // Day 0 of the next month is the last day of this one.
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0));
  return reportingPeriodFromDays(
    `${month}-01` as CalendarDay,
    toCalendarDay(lastDay),
  );
}

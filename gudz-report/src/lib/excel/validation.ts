import * as XLSX from "xlsx";

import { toCalendarDay } from "../dates/reporting-period";
import type { DateMode } from "./marketplace-profiles";
import {
  NORMALIZED_ROW_STATUSES,
  type ColumnMapping,
  type NormalizedRowStatus,
} from "../../types/excel";

/**
 * Cell-level coercion.
 *
 * Every function here answers the same question — "is there a usable value in
 * this cell?" — and answers `null` when there is not. None of them guess. A
 * blank quantity stays null rather than becoming 0, because 0 is a real number
 * a marketplace can report and treating "missing" as "zero" turns a data gap
 * into a reconciled variance nobody can explain.
 */

/** Trimmed text, or null for blank, whitespace-only and Excel's `#N/A`. */
export function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    // Error cells arrive as text and are absence, not content.
    if (/^#(n\/a|value!|ref!|div\/0!|name\?|null!|num!)$/i.test(trimmed)) return null;
    return trimmed;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  return null;
}

/**
 * A finite number, or null.
 *
 * Handles what marketplace exports actually contain: thousands separators,
 * currency symbols, and negatives written as `(1,234.00)`.
 */
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return null;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const negative = /^\(.*\)$/.test(trimmed);
    const cleaned = trimmed
      .replace(/^\(|\)$/g, "")
      .replace(/[\s,]/g, "")
      .replace(/^[^\d.\-+]+/, "");
    if (!cleaned || !/^[-+]?\d*\.?\d+$/.test(cleaned)) return null;
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed)) return null;
    return negative ? -Math.abs(parsed) : parsed;
  }

  return null;
}

/**
 * A `YYYY-MM-DD` calendar day in UTC, or null.
 *
 * A real date cell arrives as an **Excel serial number**, and that is
 * deliberate — see `excelSerialToCalendarDate` for why reading it as a `Date`
 * is wrong. Text dates are only accepted in unambiguous forms: `DD/MM/YYYY` and
 * `MM/DD/YYYY` are the same eight characters and guessing between them silently
 * moves orders between months, so anything ambiguous is refused rather than
 * assumed.
 */
export function toCalendarDate(
  value: unknown,
  options?: {
    readonly textFormat?: TextDateFormat;
    readonly date1904?: boolean;
  },
): string | null {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "number") {
    return excelSerialToCalendarDate(value, options?.date1904 ?? false);
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return toCalendarDay(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    // ISO date or datetime — unambiguous.
    const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(trimmed);
    if (iso) {
      const parsed = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00.000Z`);
      return Number.isNaN(parsed.getTime()) ? null : toCalendarDay(parsed);
    }

    // `YYYY/MM/DD` — also unambiguous, year first.
    const slashed = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(trimmed);
    if (slashed) {
      const parsed = new Date(`${slashed[1]}-${slashed[2]}-${slashed[3]}T00:00:00.000Z`);
      return Number.isNaN(parsed.getTime()) ? null : toCalendarDay(parsed);
    }

    // Day-first or month-first text, but only when the sheet DECLARES which it
    // is. Zepto ships 49,759 rows as `13-06-2026`; without a declared format
    // that is genuinely ambiguous and is still refused.
    if (options?.textFormat) {
      return fromDeclaredTextDate(trimmed, options.textFormat);
    }

    return null;
  }

  return null;
}

/**
 * An Excel date serial to a calendar day, without ever building a `Date`.
 *
 * This is the whole reason the parser keeps serials instead of asking SheetJS
 * for `Date` objects. Verified against the real Healthy Master workbook: the
 * Blinkit sheet's first row is serial `46174`, which Excel displays as
 * `1/6/2026` — 1 June 2026. Read with `cellDates: true` on an IST machine the
 * same cell comes back as `2026-05-31T18:29:50.000Z`, i.e. 31 May 23:59:50
 * local: ten seconds short of the correct day. Both the UTC components and the
 * local components of that `Date` report 31 May, so every date in every sheet
 * was one day early and no amount of timezone juggling on the `Date` recovers
 * it — the day is already gone by the time the `Date` exists.
 *
 * The serial itself carries no timezone, so this conversion is exact and gives
 * the same answer on every machine.
 */
const EXCEL_MIN_SERIAL = 1;
/** 9999-12-31. Past this the value is not a date, whatever the column says. */
const EXCEL_MAX_SERIAL = 2_958_465;

export function excelSerialToCalendarDate(
  serial: number,
  date1904 = false,
): string | null {
  if (!Number.isFinite(serial)) return null;
  if (serial < EXCEL_MIN_SERIAL || serial > EXCEL_MAX_SERIAL) return null;

  const parsed = XLSX.SSF.parse_date_code(serial, { date1904 });
  if (!parsed) return null;

  return [
    String(parsed.y).padStart(4, "0"),
    String(parsed.m).padStart(2, "0"),
    String(parsed.d).padStart(2, "0"),
  ].join("-");
}

/**
 * Text date layouts a sheet can declare.
 *
 * Declared per marketplace profile rather than sniffed per value. Sniffing gets
 * `05-01-2026` wrong half the time and there is no way to tell from the data
 * which half — the sheet's own convention is the only reliable source.
 */
export type TextDateFormat = "DD-MM-YYYY" | "MM-DD-YYYY";

function fromDeclaredTextDate(
  text: string,
  format: TextDateFormat,
): string | null {
  const match = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/.exec(text);
  if (!match) return null;

  const [first, second] = [Number(match[1]), Number(match[2])];
  const year = Number(match[3]);
  const day = format === "DD-MM-YYYY" ? first : second;
  const month = format === "DD-MM-YYYY" ? second : first;

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  // Round-trip guards against 31 February and friends.
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === iso ? iso : null;
}

/**
 * Bigbasket's `date_range`, e.g. `20260609 - 20260609`.
 *
 * The range start is the sale date. Both ends are the same day in every row
 * observed, but taking the start is the safe reading either way: it is the day
 * the sales are attributed to, and using the end would shift a genuine
 * multi-day range forward.
 */
export function toDateFromBigbasketRange(value: unknown): string | null {
  const text = toText(value);
  if (!text) return null;

  const match = /^(\d{4})(\d{2})(\d{2})/.exec(text.trim());
  if (!match) return null;

  const iso = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : iso;
}

const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/**
 * The real Flipkart sheet mixes `June`, `July` and `Aug` in one column.
 *
 * Abbreviations are matched by prefix rather than by a second hard-coded list:
 * the three-letter form of every month is already a unique prefix of its full
 * name, and `Sept` — which is four letters and not in any standard list — falls
 * out for free. Requiring at least three characters is what keeps `Ma` from
 * silently choosing March over May.
 */
function monthIndex(text: string): number {
  const folded = text.trim().toLowerCase().replace(/\.$/, "");
  const exact = MONTH_NAMES.indexOf(folded);
  if (exact >= 0) return exact;
  if (folded.length < 3) return -1;

  const prefixed = MONTH_NAMES.filter((name) => name.startsWith(folded));
  return prefixed.length === 1 ? MONTH_NAMES.indexOf(prefixed[0]!) : -1;
}

/**
 * Flipkart's bare month name.
 *
 * The sheet carries `June` and nothing else — no year in the column, the header
 * or any neighbouring field. A month without a year cannot be dated, so this
 * refuses unless a year is supplied explicitly. Defaulting to the current year
 * would silently file last year's sales under this one.
 *
 * Returns the FIRST day of the month; the period builder widens to the month's
 * full span separately.
 */
export function toDateFromMonthName(
  value: unknown,
  year: number | null,
): string | null {
  const text = toText(value);
  if (!text || year === null) return null;

  const index = monthIndex(text);
  if (index < 0) return null;

  return `${year}-${String(index + 1).padStart(2, "0")}-01`;
}

/** Applies the right date reader for a sheet's declared mode. */
export function toCalendarDateWithMode(
  value: unknown,
  mode: DateMode,
  options?: {
    readonly year?: number | null;
    readonly textFormat?: TextDateFormat;
    readonly date1904?: boolean;
  },
): string | null {
  switch (mode) {
    case "bigbasketRange":
      return toDateFromBigbasketRange(value);
    case "monthName":
      return toDateFromMonthName(value, options?.year ?? null);
    case "cell":
    default:
      return toCalendarDate(value, {
        textFormat: options?.textFormat,
        date1904: options?.date1904,
      });
  }
}

/**
 * Collapses a marketplace's status vocabulary to what the reconciliation asks.
 *
 * Unrecognised values become `unknown`, never `delivered`. The cost of the two
 * mistakes is not symmetric: an unknown row is visible and can be mapped later,
 * whereas a wrongly-delivered row silently inflates reconciled revenue.
 */
export function normalizeStatus(value: unknown): NormalizedRowStatus {
  const text = toText(value);
  if (!text) return "unknown";
  const folded = text.toLowerCase();

  if (/\b(cancel|cancelled|canceled|void)\b/.test(folded)) return "cancelled";
  if (/\b(return|returned|rto|refund|refunded|reversed)\b/.test(folded)) {
    return "returned";
  }
  if (/\b(deliver|delivered|complete|completed|fulfilled|shipped|sold)\b/.test(folded)) {
    return "delivered";
  }
  return "unknown";
}

export function isNormalizedStatus(value: string): value is NormalizedRowStatus {
  return (NORMALIZED_ROW_STATUSES as ReadonlyArray<string>).includes(value);
}

export interface MappingProblem {
  readonly field: string;
  readonly message: string;
}

/**
 * Checks a column mapping against a sheet's actual headers.
 *
 * Two failures are worth catching before any row is read: a mapping that points
 * at a column the sheet does not have, and a mapping with no date column, which
 * would leave the import unable to derive a reporting period at all.
 */
export function validateMapping(
  mapping: ColumnMapping,
  headers: ReadonlyArray<string>,
): MappingProblem[] {
  const problems: MappingProblem[] = [];
  const available = new Set(headers);

  for (const [field, header] of Object.entries(mapping)) {
    if (!header) continue;
    if (!available.has(header)) {
      problems.push({
        field,
        message: `Mapped to "${header}", which is not a column in this sheet.`,
      });
    }
  }

  if (!mapping.orderDate) {
    problems.push({
      field: "orderDate",
      message:
        "No date column mapped. The reporting period is derived from it, so the ERP range cannot be determined without one.",
    });
  }

  if (!mapping.sku && !mapping.barcode && !mapping.marketplaceItemId) {
    problems.push({
      field: "sku",
      message:
        "No product identifier mapped. Without a SKU, barcode or marketplace item id there is nothing to match an ERP line against.",
    });
  }

  return problems;
}

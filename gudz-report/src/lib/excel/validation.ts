import { toCalendarDay } from "../dates/reporting-period";
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
 * `cellDates` means a real date cell arrives as a `Date`. Text dates are only
 * accepted in unambiguous forms: `DD/MM/YYYY` and `MM/DD/YYYY` are the same
 * eight characters and guessing between them silently moves orders between
 * months, so anything ambiguous is refused rather than assumed.
 */
export function toCalendarDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : toCalendarDay(value);
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

    return null;
  }

  return null;
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

import * as XLSX from "xlsx";

import type { ParsedSheet, ParsedWorkbook } from "../../types/excel";

/**
 * Workbook parsing: bytes in, header-keyed rows out.
 *
 * This layer deliberately understands nothing about marketplaces. It finds the
 * sheet, reads the header row and hands back cells — deciding that a column
 * called "Qty Sold" is a quantity happens in `normalizer.ts`, against a mapping
 * supplied by the caller. Keeping the two apart is what lets a new marketplace
 * be supported by adding a mapping rather than editing a parser.
 *
 * Date cells are handed on as raw Excel **serial numbers**, on purpose. Asking
 * SheetJS for `Date` objects (`cellDates: true`) converts through the machine's
 * timezone and lands ten seconds before midnight on the previous day — serial
 * `46174` is 1 June 2026 in Excel and arrives as `2026-05-31T18:29:50Z` on an
 * IST machine, which is 31 May read either as UTC or as local components. That
 * put every date in the real workbook one day early. The serial carries no
 * timezone, so it is passed through intact and converted in `validation.ts`.
 *
 * The cost is that a serial is indistinguishable from a quantity, so only a
 * column the caller has *declared* to be a date is read as one.
 */

export class ExcelParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExcelParseError";
  }
}

export interface ParseOptions {
  /** Sheet to read. Defaults to the first one that has any rows. */
  readonly sheetName?: string;
  /** 1-based row holding the headers. Defaults to 1. */
  readonly headerRow?: number;
}

function toSheetSummary(workbook: XLSX.WorkBook, name: string): ParsedSheet {
  const sheet = workbook.Sheets[name];
  if (!sheet) return { name, headers: [], rowCount: 0 };

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: true,
  });
  const headers = rows.length > 0 ? Object.keys(rows[0] as object) : [];
  return { name, headers, rowCount: rows.length };
}

/** Sheet names and row counts without committing to one — for a preview screen. */
export function inspectWorkbook(data: ArrayBuffer | Uint8Array): ParsedSheet[] {
  const workbook = readWorkbook(data);
  return workbook.SheetNames.map((name) => toSheetSummary(workbook, name));
}

function readWorkbook(data: ArrayBuffer | Uint8Array): XLSX.WorkBook {
  try {
    return XLSX.read(data, {
      type: "array",
      // `cellDates` is deliberately OFF. See the note at the top of this file:
      // it converts through the local timezone and loses a day.
      cellDates: false,
      // Formatting is irrelevant here and dominates memory on a large export.
      cellStyles: false,
      cellHTML: false,
    });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : "unknown error";
    throw new ExcelParseError(`Could not read the workbook: ${reason}`);
  }
}

/**
 * Parses a workbook into header-keyed rows.
 *
 * Throws rather than returning an empty result when there is nothing usable: an
 * import that silently produces zero rows looks like a successful import of an
 * empty file, which is the one outcome nobody would think to check.
 */
export function parseWorkbook(
  data: ArrayBuffer | Uint8Array,
  options?: ParseOptions,
): ParsedWorkbook {
  const workbook = readWorkbook(data);

  if (workbook.SheetNames.length === 0) {
    throw new ExcelParseError("The workbook contains no sheets.");
  }

  const sheets = workbook.SheetNames.map((name) => toSheetSummary(workbook, name));

  const selectedSheet =
    options?.sheetName ??
    sheets.find((sheet) => sheet.rowCount > 0)?.name ??
    workbook.SheetNames[0]!;

  if (!workbook.SheetNames.includes(selectedSheet)) {
    throw new ExcelParseError(
      `Sheet "${selectedSheet}" not found. Available: ${workbook.SheetNames.join(", ")}`,
    );
  }

  const sheet = workbook.Sheets[selectedSheet];
  if (!sheet) {
    throw new ExcelParseError(`Sheet "${selectedSheet}" could not be read.`);
  }

  // `range` lets a file with banner rows above the real header still be read.
  const headerRow = options?.headerRow ?? 1;
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: true,
    range: headerRow - 1,
  });

  if (rows.length === 0) {
    throw new ExcelParseError(
      `Sheet "${selectedSheet}" has no data rows below header row ${headerRow}.`,
    );
  }

  return {
    sheetNames: workbook.SheetNames,
    selectedSheet,
    headers: Object.keys(rows[0] as object),
    rows,
    sheets,
    date1904: workbook.Workbook?.WBProps?.date1904 === true,
  };
}

/**
 * Suggests a header for a field by trying candidate names.
 *
 * A suggestion, never a decision: it is offered to a human mapping screen so
 * nobody types twenty column names by hand. Matching is case- and
 * punctuation-insensitive because marketplace exports are inconsistent about
 * both, and exact matches are preferred over partial ones so that a header
 * called "SKU" wins over "Parent SKU".
 */
export function suggestHeader(
  headers: ReadonlyArray<string>,
  candidates: ReadonlyArray<string>,
): string | null {
  const fold = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const folded = headers.map((header) => ({ header, key: fold(header) }));

  for (const candidate of candidates) {
    const key = fold(candidate);
    const exact = folded.find((entry) => entry.key === key);
    if (exact) return exact.header;
  }

  for (const candidate of candidates) {
    const key = fold(candidate);
    const partial = folded.find(
      (entry) => entry.key.includes(key) || key.includes(entry.key),
    );
    if (partial) return partial.header;
  }

  return null;
}

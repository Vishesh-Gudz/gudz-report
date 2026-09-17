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
 * Dates are the one exception, and for a good reason: SheetJS can only produce
 * real `Date` objects if it is told to at read time (`cellDates`), and a spread-
 * sheet serial number is indistinguishable from a quantity once it reaches the
 * normalizer. So the decision is made here, where the information still exists.
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
      // Without this, a date cell arrives as a serial number that the normalizer
      // has no way to tell apart from a quantity.
      cellDates: true,
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

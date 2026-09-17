"use node";

import { v } from "convex/values";

import { action } from "./_generated/server";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { parseWorkbook } from "../src/lib/excel/parser";
import {
  normalizeWorkbook,
  suggestColumnMapping,
} from "../src/lib/excel/normalizer";
import type { ColumnMapping } from "../src/types/excel";

/**
 * Spreadsheet processing, in a Node action.
 *
 * `"use node"` is required, not stylistic: SheetJS is a Node library and the
 * work is CPU-bound in a way Convex's default runtime is not meant for. Parsing
 * here rather than in the browser also means a 50 MB export never has to cross
 * the wire twice, and the rules that interpret it live in one place instead of
 * being re-implemented per client.
 *
 * The parse/normalize logic itself is imported from `src/lib/excel` — the same
 * modules the Next server uses — so a change to how a status is folded cannot
 * apply on one side and not the other.
 */

const COLUMN_MAPPING = v.object({
  orderDate: v.optional(v.string()),
  marketplaceOrderId: v.optional(v.string()),
  marketplaceItemId: v.optional(v.string()),
  sku: v.optional(v.string()),
  barcode: v.optional(v.string()),
  productName: v.optional(v.string()),
  quantity: v.optional(v.string()),
  unitPrice: v.optional(v.string()),
  grossSales: v.optional(v.string()),
  status: v.optional(v.string()),
});

/**
 * Rows per mutation.
 *
 * A Convex mutation is one transaction with a bounded write budget, so a large
 * export has to be chunked. 500 is a deliberate middle: small enough to stay
 * well inside the budget, large enough that a 50k-row file is a hundred round
 * trips rather than fifty thousand.
 */
const INSERT_BATCH_SIZE = 500;

/**
 * Reads a stored workbook and reports what is in it, without committing.
 *
 * The mapping screen needs to show real sheet names and real headers before a
 * human confirms which column means what. Guessing that mapping and importing
 * silently is the failure this step exists to prevent.
 */
export const inspect = action({
  args: { storageId: v.id("_storage") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    sheetNames: string[];
    selectedSheet: string;
    headers: string[];
    rowCount: number;
    suggestedMapping: ColumnMapping;
  }> => {
    const blob = await ctx.storage.get(args.storageId);
    if (!blob) throw new Error("Uploaded file not found in storage.");

    const workbook = parseWorkbook(await blob.arrayBuffer());
    return {
      sheetNames: workbook.sheetNames,
      selectedSheet: workbook.selectedSheet,
      headers: workbook.headers,
      rowCount: workbook.rows.length,
      suggestedMapping: suggestColumnMapping(workbook.headers),
    };
  },
});

/**
 * Parses, normalizes and persists an uploaded workbook.
 *
 * Failure is recorded on the import rather than thrown away: an upload that
 * dies silently looks identical to one that was never started. The error
 * message is the exception's own text, which by construction never contains a
 * credential — nothing in the Excel path holds one.
 */
export const processImport = action({
  args: {
    importId: v.id("imports"),
    storageId: v.id("_storage"),
    mapping: COLUMN_MAPPING,
    sheetName: v.optional(v.string()),
    headerRow: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    totalRows: number;
    validRows: number;
    invalidRows: number;
    minDate: string | null;
    maxDate: string | null;
    errors: { sourceRow: number; field: string; message: string }[];
  }> => {
    await ctx.runMutation(api.imports.setStatus, {
      importId: args.importId,
      status: "processing",
    });

    try {
      const blob = await ctx.storage.get(args.storageId);
      if (!blob) throw new Error("Uploaded file not found in storage.");

      const workbook = parseWorkbook(await blob.arrayBuffer(), {
        sheetName: args.sheetName,
        headerRow: args.headerRow,
      });

      const { rows, errors, statistics } = normalizeWorkbook(
        workbook,
        args.mapping as ColumnMapping,
      );

      for (let offset = 0; offset < rows.length; offset += INSERT_BATCH_SIZE) {
        await ctx.runMutation(api.imports.insertRows, {
          importId: args.importId,
          rows: rows.slice(offset, offset + INSERT_BATCH_SIZE),
        });
      }

      await ctx.runMutation(api.imports.recordParseResult, {
        importId: args.importId,
        minDate: statistics.minDate,
        maxDate: statistics.maxDate,
        totalRows: statistics.totalRows,
        validRows: statistics.validRows,
        invalidRows: statistics.invalidRows,
      });

      return {
        ...statistics,
        // Capped: a malformed file can produce an error per row, and a reply
        // that large helps nobody. The counts above stay exact.
        errors: errors.slice(0, 200),
      };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unknown error";
      await ctx.runMutation(api.imports.setStatus, {
        importId: args.importId,
        status: "failed",
        errorMessage: message,
      });
      throw cause;
    }
  },
});

/** Upload URL for the browser to PUT a workbook to. Convex owns the bytes. */
export const generateUploadUrl = action({
  args: {},
  returns: v.string(),
  handler: async (ctx): Promise<string> => {
    return await ctx.storage.generateUploadUrl();
  },
});

export type { Id };

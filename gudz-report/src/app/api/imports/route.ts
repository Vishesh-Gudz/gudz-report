import { anyApi } from "convex/server";

import { getConvexClient } from "@/lib/convex/server";
import { parseWorkbook, ExcelParseError } from "@/lib/excel/parser";
import {
  normalizeWorkbook,
  periodFromStatistics,
  suggestColumnMapping,
  ExcelNormalizationError,
} from "@/lib/excel/normalizer";
import type { ColumnMapping } from "@/types/excel";

/**
 * Workbook upload.
 *
 * Parsing happens here, on the server, for three reasons: the rules that
 * interpret a marketplace file live in one place rather than being
 * re-implemented per client, a large export never crosses the wire twice, and
 * the browser never needs a Convex write credential.
 *
 * Convex is optional. Without a deployment the endpoint still parses, validates
 * and reports the detected period — which is exactly what someone needs while
 * they are working out whether a new workbook can be mapped at all. It just
 * cannot persist, and says so rather than pretending it did.
 */

/** 25 MB. A marketplace month is a few MB; anything far larger is a mistake. */
const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json(
      { ok: false, error: "Expected a multipart form upload." },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ ok: false, error: "No file was uploaded." }, { status: 400 });
  }
  if (file.size === 0) {
    return Response.json({ ok: false, error: "The uploaded file is empty." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json(
      {
        ok: false,
        error: `File is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is 25 MB.`,
      },
      { status: 413 },
    );
  }

  const persist = form.get("persist") !== "false";
  const sheetName = typeof form.get("sheet") === "string" ? String(form.get("sheet")) : undefined;

  try {
    const workbook = parseWorkbook(new Uint8Array(await file.arrayBuffer()), { sheetName });

    // Suggested, never assumed. The real Healthy Master / Blinkit column names
    // have not been confirmed, so the mapping is reported back for a human to
    // check rather than applied silently.
    const mapping: ColumnMapping = suggestColumnMapping(workbook.headers);
    const { rows, errors, statistics } = normalizeWorkbook(workbook, mapping);
    const period = periodFromStatistics(statistics);

    const convex = getConvexClient();
    let importId: string | null = null;
    let persisted = false;
    const notes: string[] = [];

    if (persist && convex) {
      try {
        importId = (await convex.mutation(anyApi.imports.create as never, {
          fileName: file.name,
        } as never)) as string;

        // Chunked: a Convex mutation is one transaction with a bounded write
        // budget, and a marketplace month exceeds it in a single call.
        for (let offset = 0; offset < rows.length; offset += 500) {
          await convex.mutation(anyApi.imports.insertRows as never, {
            importId,
            rows: rows.slice(offset, offset + 500),
          } as never);
        }

        await convex.mutation(anyApi.imports.recordParseResult as never, {
          importId,
          minDate: statistics.minDate,
          maxDate: statistics.maxDate,
          totalRows: statistics.totalRows,
          validRows: statistics.validRows,
          invalidRows: statistics.invalidRows,
        } as never);

        persisted = true;
      } catch (cause) {
        // Reported, not swallowed: a parse that looked fine but saved nothing
        // is worse than a visible failure.
        notes.push(
          `Parsed successfully but could not save to Convex: ${
            cause instanceof Error ? cause.message : "unknown error"
          }`,
        );
      }
    } else if (persist && !convex) {
      notes.push(
        "Convex is not configured, so this import was parsed but not saved. Run `npx convex dev` to enable persistence.",
      );
    }

    return Response.json({
      ok: true,
      importId,
      persisted,
      fileName: file.name,
      sheetNames: workbook.sheetNames,
      selectedSheet: workbook.selectedSheet,
      headers: workbook.headers,
      suggestedMapping: mapping,
      statistics,
      period: period ? { from: period.fromDay, to: period.toDay } : null,
      // Capped: a malformed file produces an error per row and a reply that
      // large helps nobody. The counts in `statistics` stay exact.
      errors: errors.slice(0, 100),
      errorCount: errors.length,
      notes,
    });
  } catch (cause) {
    if (cause instanceof ExcelNormalizationError) {
      return Response.json(
        {
          ok: false,
          error: cause.message,
          problems: cause.problems,
          hint: "The sheet's columns could not be mapped automatically. Confirm the header row and column names.",
        },
        { status: 422 },
      );
    }
    if (cause instanceof ExcelParseError) {
      return Response.json({ ok: false, error: cause.message }, { status: 422 });
    }
    return Response.json(
      { ok: false, error: cause instanceof Error ? cause.message : "Unknown error" },
      { status: 500 },
    );
  }
}

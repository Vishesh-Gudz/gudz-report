import { anyApi } from "convex/server";

import { getConvexClient } from "@/lib/convex/server";
import { ExcelParseError } from "@/lib/excel/parser";
import {
  importMarketplaceSheet,
  inspectMarketplaceWorkbook,
} from "@/lib/excel/workbook";

/**
 * Workbook upload, in two steps: inspect, then import one sheet.
 *
 * The two steps exist because the real Healthy Master workbook is not one
 * export — it is a `Master` product table plus six marketplace sheets that
 * share no schema. The first version picked the first sheet with rows, landed
 * on `Master`, and reported "No date column mapped", which was a correct
 * complaint about the wrong sheet. Nothing here guesses which sheet is meant:
 * a request without `sheet` returns what the file contains, and a human picks.
 *
 * Parsing stays on the server so the rules that interpret a marketplace file
 * live in one place, a large export never crosses the wire twice, and the
 * browser never needs a Convex write credential.
 *
 * Convex is optional. Without a deployment the endpoint still parses, validates
 * and reports the detected period — exactly what someone needs while working
 * out whether a workbook can be mapped at all. It just cannot persist, and says
 * so rather than pretending it did.
 */

/** 25 MB. A marketplace month is a few MB; anything far larger is a mistake. */
const MAX_BYTES = 25 * 1024 * 1024;

/** Convex caps a single mutation's writes; a marketplace month exceeds it. */
const ROW_BATCH = 500;

function text(form: FormData, key: string): string | null {
  const value = form.get(key);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

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

  const sheet = text(form, "sheet");
  const yearText = text(form, "year");
  const year = yearText === null ? null : Number(yearText);
  if (yearText !== null && !Number.isInteger(year)) {
    return Response.json(
      { ok: false, error: `"${yearText}" is not a year.` },
      { status: 400 },
    );
  }

  const data = new Uint8Array(await file.arrayBuffer());

  try {
    // Step one: no sheet chosen yet. Report the file, import nothing.
    if (!sheet) {
      const overview = inspectMarketplaceWorkbook(data);
      return Response.json({
        ok: true,
        mode: "inspect",
        fileName: file.name,
        hasMasterSheet: overview.hasMasterSheet,
        master: overview.master,
        marketplaces: overview.marketplaces,
        unrecognisedSheets: overview.unrecognisedSheets,
        sheetNames: overview.sheets.map((entry) => entry.name),
      });
    }

    // Step two: import the chosen sheet.
    const result = importMarketplaceSheet(data, { sheet, year });
    const { statistics, period } = result;

    const persist = form.get("persist") !== "false";
    const convex = getConvexClient();
    let importId: string | null = null;
    let persisted = false;
    const notes: string[] = [];

    if (persist && convex) {
      try {
        importId = (await convex.mutation(anyApi.imports.create as never, {
          fileName: file.name,
          marketplace: result.marketplace,
          sheetName: result.sheet,
        } as never)) as string;

        for (let offset = 0; offset < result.rows.length; offset += ROW_BATCH) {
          await convex.mutation(anyApi.imports.insertRows as never, {
            importId,
            rows: result.rows.slice(offset, offset + ROW_BATCH),
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

    // Unresolved identifiers are not an error, but they are the single biggest
    // reason a reconciliation later shows a one-sided gap, so they are said out
    // loud rather than left in a counter nobody reads.
    if (result.identifiers.unresolved > 0) {
      notes.push(
        `${result.identifiers.unresolved.toLocaleString("en-IN")} of ${statistics.totalRows.toLocaleString("en-IN")} rows ` +
          `could not be resolved to an EAN through the Master sheet, so they cannot be matched to an ERP item.`,
      );
    }

    return Response.json({
      ok: true,
      mode: "import",
      importId,
      persisted,
      fileName: file.name,
      marketplace: result.marketplace,
      selectedSheet: result.sheet,
      statistics,
      period: period ? { from: period.fromDay, to: period.toDay } : null,
      identifiers: result.identifiers,
      master: result.master,
      caveats: result.caveats,
      // Capped: a malformed file produces an error per row and a reply that
      // large helps nobody. The counts in `statistics` stay exact.
      errors: result.errors.slice(0, 100),
      errorCount: result.errors.length,
      notes,
    });
  } catch (cause) {
    if (cause instanceof ExcelParseError) {
      return Response.json({ ok: false, error: cause.message }, { status: 422 });
    }
    return Response.json(
      { ok: false, error: cause instanceof Error ? cause.message : "Unknown error" },
      { status: 500 },
    );
  }
}

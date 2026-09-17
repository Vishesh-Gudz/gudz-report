import { anyApi } from "convex/server";

import { getConvexClient } from "@/lib/convex/server";
import { ExcelParseError } from "@/lib/excel/parser";
import { normalizeGstin } from "@/lib/erp/gstin";
import {
  importMarketplaceSheet,
  inspectMarketplaceWorkbook,
} from "@/lib/excel/workbook";

/**
 * Workbook upload: inspect, then process the chosen marketplace sheets.
 *
 * One upload is one import session covering however many sheets were picked.
 * The file is sent once — asking somebody to re-upload ten megabytes per
 * marketplace was never the right shape, and six copies of the same bytes is
 * six chances for them to disagree.
 *
 * Progress is streamed as newline-delimited JSON rather than returned at the
 * end, because the sheets take real and very different amounts of time: Blinkit
 * is 8,451 rows and Swiggy is 103,397. A single response would leave the screen
 * still for a minute and then jump; a percentage would be invented. Each line is
 * emitted when the work it describes has actually finished.
 *
 * `Master` never appears in this flow. It is the product mapping table, it is
 * loaded once by the parser and used for every sheet, and it is not sales data.
 *
 * Parsing stays on the server so the rules that interpret a marketplace file
 * live in one place and the browser never needs a Convex write credential.
 */

/** 25 MB. A marketplace month is a few MB; anything far larger is a mistake. */
const MAX_BYTES = 25 * 1024 * 1024;

/** Convex caps a single mutation's writes; a marketplace month exceeds it. */
const ROW_BATCH = 500;

function text(form: FormData, key: string): string | null {
  const value = form.get(key);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function jsonError(error: string, status: number): Response {
  return Response.json({ ok: false, error }, { status });
}

/** Marketplaces with a customer GSTIN configured can be reconciled; others cannot. */
async function reconcilableMarketplaces(): Promise<Set<string>> {
  const client = getConvexClient();
  if (!client) return new Set();
  try {
    const docs = (await client.query(anyApi.marketplaces.list as never, {
      includeInactive: false,
    } as never)) as { marketplace: string; customerGstins: string[] }[];

    return new Set(
      docs
        .filter((doc) =>
          doc.customerGstins.some((gstin) => normalizeGstin(gstin) !== null),
        )
        .map((doc) => doc.marketplace),
    );
  } catch {
    // Treated as "none configured", which understates rather than overstates
    // what the report can do.
    return new Set();
  }
}

export async function POST(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("Expected a multipart form upload.", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) return jsonError("No file was uploaded.", 400);
  if (file.size === 0) return jsonError("The uploaded file is empty.", 400);
  if (file.size > MAX_BYTES) {
    return jsonError(
      `File is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is 25 MB.`,
      413,
    );
  }

  const sheetsParam = text(form, "sheets") ?? text(form, "sheet");
  const yearText = text(form, "year");
  const year = yearText === null ? null : Number(yearText);
  if (yearText !== null && !Number.isInteger(year)) {
    return jsonError(`"${yearText}" is not a year.`, 400);
  }

  const data = new Uint8Array(await file.arrayBuffer());

  // Step one: nothing chosen yet. Describe the file, import nothing.
  if (!sheetsParam) {
    try {
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
    } catch (cause) {
      if (cause instanceof ExcelParseError) return jsonError(cause.message, 422);
      return jsonError(
        cause instanceof Error ? cause.message : "Unknown error",
        500,
      );
    }
  }

  const requested = sheetsParam
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");

  if (requested.length === 0) return jsonError("No marketplace was selected.", 400);

  return streamImport(data, file.name, requested, year);
}

/**
 * Processes each selected sheet, reporting as it goes.
 *
 * A sheet that fails is recorded as failed and the walk continues. One
 * unreadable sheet must not cost the other five, and a sheet that quietly
 * disappeared is indistinguishable from one the workbook never contained.
 */
function streamImport(
  data: Uint8Array,
  fileName: string,
  sheets: string[],
  year: number | null,
): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      };

      const convex = getConvexClient();
      const reconcilable = await reconcilableMarketplaces();

      let importId: string | null = null;
      if (convex) {
        try {
          importId = (await convex.mutation(anyApi.imports.create as never, {
            fileName,
          } as never)) as string;
        } catch (cause) {
          send({
            type: "fatal",
            error: `The upload could not be saved: ${
              cause instanceof Error ? cause.message : "unknown error"
            }`,
          });
          controller.close();
          return;
        }
      }

      send({ type: "session", importId, fileName, sheets });

      let completed = 0;
      let failed = 0;

      for (const sheet of sheets) {
        send({ type: "sheet", sheet, stage: "parsing" });

        try {
          const result = importMarketplaceSheet(data, { sheet, year });

          send({
            type: "sheet",
            sheet,
            marketplace: result.marketplace,
            stage: "parsed",
            rows: result.statistics.totalRows,
            invalidRows: result.statistics.invalidRows,
            period: result.period
              ? { from: result.period.fromDay, to: result.period.toDay }
              : null,
            identifiers: result.identifiers,
          });

          if (convex && importId) {
            send({ type: "sheet", sheet, marketplace: result.marketplace, stage: "saving" });

            // Replace, never append: processing a sheet twice must correct its
            // rows rather than double them.
            await convex.mutation(anyApi.imports.clearSheetRows as never, {
              importId,
              marketplace: result.marketplace,
            } as never);

            for (let offset = 0; offset < result.rows.length; offset += ROW_BATCH) {
              await convex.mutation(anyApi.imports.insertRows as never, {
                importId,
                marketplace: result.marketplace,
                sheetName: result.sheet,
                rows: result.rows.slice(offset, offset + ROW_BATCH),
              } as never);
            }

            await convex.mutation(anyApi.imports.recordSheet as never, {
              importId,
              marketplace: result.marketplace,
              sheetName: result.sheet,
              status: "completed",
              minDate: result.statistics.minDate,
              maxDate: result.statistics.maxDate,
              totalRows: result.statistics.totalRows,
              validRows: result.statistics.validRows,
              invalidRows: result.statistics.invalidRows,
              identifiersFromSheet: result.identifiers.fromSheet,
              identifiersFromMaster: result.identifiers.fromMasterLookup,
              identifiersUnresolved: result.identifiers.unresolved,
              errorMessage: null,
            } as never);
          }

          completed += 1;
          send({
            type: "sheet",
            sheet,
            marketplace: result.marketplace,
            stage: "done",
            // Repeated rather than assumed to still be on the client's copy of
            // the earlier `parsed` event: the final line has to stand alone.
            rows: result.statistics.totalRows,
            invalidRows: result.statistics.invalidRows,
            period: result.period
              ? { from: result.period.fromDay, to: result.period.toDay }
              : null,
            // Whether the ERP side can be reconciled at all. A configuration
            // fact, checked now rather than implied later by an empty column.
            erpConfigured: reconcilable.has(result.marketplace),
            caveats: result.caveats,
          });
        } catch (cause) {
          failed += 1;
          const message =
            cause instanceof ExcelParseError
              ? cause.message
              : cause instanceof Error
                ? cause.message
                : "This sheet could not be read.";

          if (convex && importId) {
            try {
              await convex.mutation(anyApi.imports.recordSheet as never, {
                importId,
                marketplace: sheet.toLowerCase(),
                sheetName: sheet,
                status: "failed",
                minDate: null,
                maxDate: null,
                totalRows: 0,
                validRows: 0,
                invalidRows: 0,
                identifiersFromSheet: 0,
                identifiersFromMaster: 0,
                identifiersUnresolved: 0,
                errorMessage: message,
              } as never);
            } catch {
              // Recording the failure failed too. The stream still reports it,
              // which is what the screen shows.
            }
          }

          send({ type: "sheet", sheet, stage: "failed", error: message });
        }
      }

      if (convex && importId) {
        try {
          await convex.mutation(anyApi.imports.setStatus as never, {
            importId,
            status: completed > 0 ? "completed" : "failed",
            errorMessage:
              completed === 0 ? "No sheet in this workbook could be read." : null,
          } as never);
        } catch {
          // The rows are already saved; a status that did not stick is a
          // cosmetic problem and the stream has already reported the truth.
        }
      }

      send({
        type: "done",
        importId,
        completed,
        failed,
        persisted: Boolean(convex && importId),
      });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      // Proxies that buffer would defeat the point of streaming it.
      "x-accel-buffering": "no",
    },
  });
}

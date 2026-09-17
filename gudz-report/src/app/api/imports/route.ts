
import { ExcelParseError } from "@/lib/excel/parser";
import { inspectMarketplaceWorkbook } from "@/lib/excel/workbook";
import { buildSnapshot, type ProgressEvent } from "@/lib/report/build-snapshot";

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

function text(form: FormData, key: string): string | null {
  const value = form.get(key);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function jsonError(error: string, status: number): Response {
  return Response.json({ ok: false, error }, { status });
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
 * Streams the build, one line per completed step.
 *
 * The work itself lives in `buildSnapshot`, which holds everything in memory
 * and writes only the finished aggregate. This layer is transport.
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
      const send = (payload: ProgressEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}
`));
      };

      try {
        await buildSnapshot({ data, fileName, sheets, year, send });
      } catch (cause) {
        // Technical detail stays in the server log; the screen gets a sentence
        // somebody can act on.
        console.error("Snapshot build failed", cause);
        send({
          type: "fatal",
          error: "Unable to process this report. Nothing was saved — try again.",
        });
      } finally {
        controller.close();
      }
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

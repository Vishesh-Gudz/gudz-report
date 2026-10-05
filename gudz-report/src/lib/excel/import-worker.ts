/// <reference lib="webworker" />

import { compactRows, type CompactSheet } from "../report/compact";
import { importMarketplaceSheet, inspectMarketplaceWorkbook } from "./workbook";

/**
 * Parsing the workbook off the main thread.
 *
 * A real export is ~10 MB and 204,000 rows, and reading it takes the better part
 * of a minute even after the parser was taught to materialise only the sheets it
 * was asked for. On the main thread that is a frozen tab and a browser offering
 * to kill the page. Here it is a progress list.
 *
 * The worker only ever sends back the reduction — product-months, a few hundred
 * records — never rows and never the file. The workbook stays in this thread and
 * is discarded when the worker is terminated, so the bytes never reach a server
 * at all.
 *
 * Only the sheets the user picked are parsed. `Master` is read as reference data
 * by the importer itself, never as a marketplace.
 */

export type WorkerRequest =
  | { type: "inspect"; file: ArrayBuffer }
  | { type: "process"; file: ArrayBuffer; sheets: string[]; year: number | null };

export interface InspectedMarketplace {
  marketplace: string;
  sheet: string;
  rowCount: number;
  caveats: string[];
}

export type WorkerResponse =
  | {
      type: "inspected";
      marketplaces: InspectedMarketplace[];
      unrecognisedSheets: string[];
      sheetNames: string[];
      master: { rows: number; withEan: number; active: number } | null;
    }
  | { type: "workbook-loaded"; sheets: string[] }
  | { type: "sheet-started"; sheet: string }
  | { type: "sheet-parsed"; sheet: string; marketplace: string; rows: number }
  | {
      type: "sheet-completed";
      sheet: string;
      marketplace: string;
      rows: number;
      records: number;
      period: { from: string; to: string } | null;
    }
  | { type: "sheet-failed"; sheet: string; error: string }
  | { type: "compacted"; sheets: CompactSheet[] }
  | { type: "failed"; error: string };

const post = (message: WorkerResponse) => {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(message);
};

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : "This workbook could not be read.";
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  try {
    if (request.type === "inspect") {
      const data = new Uint8Array(request.file);
      const inspection = inspectMarketplaceWorkbook(data);
      post({
        type: "inspected",
        marketplaces: inspection.marketplaces.map((entry) => ({
          marketplace: entry.marketplace,
          sheet: entry.sheet,
          rowCount: entry.rowCount,
          caveats: [...entry.caveats],
        })),
        unrecognisedSheets: [...inspection.unrecognisedSheets],
        sheetNames: inspection.sheets.map((sheet) => sheet.name),
        master: inspection.master ?? null,
      });
      return;
    }

    const data = new Uint8Array(request.file);
    post({ type: "workbook-loaded", sheets: request.sheets });

    const compacted: CompactSheet[] = [];

    for (const sheet of request.sheets) {
      post({ type: "sheet-started", sheet });

      try {
        const parsed = importMarketplaceSheet(data, { sheet, year: request.year });
        post({
          type: "sheet-parsed",
          sheet,
          marketplace: parsed.marketplace,
          rows: parsed.rows.length,
        });

        const records = compactRows(parsed.rows);
        const entry: CompactSheet = {
          sheet: parsed.sheet,
          marketplace: parsed.marketplace,
          records,
          sourceRowCount: parsed.rows.length,
          minDate: parsed.statistics.minDate ?? null,
          maxDate: parsed.statistics.maxDate ?? null,
        };
        compacted.push(entry);

        post({
          type: "sheet-completed",
          sheet,
          marketplace: parsed.marketplace,
          rows: parsed.rows.length,
          records: records.length,
          period:
            entry.minDate && entry.maxDate
              ? { from: entry.minDate, to: entry.maxDate }
              : null,
        });
      } catch (cause) {
        // One unreadable sheet does not stop the others: five good marketplaces
        // are worth more than a clean failure.
        post({ type: "sheet-failed", sheet, error: messageOf(cause) });
      }
    }

    post({ type: "compacted", sheets: compacted });
  } catch (cause) {
    post({ type: "failed", error: messageOf(cause) });
  }
};

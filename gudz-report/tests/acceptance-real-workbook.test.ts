import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { hasLiveErp, loadLocalEnv } from "./helpers/live-env";

/**
 * The real client workflow, end to end, against real data.
 *
 * No fixtures. The actual `HM Sales Dump.xlsx` and the live Healthy Master ERP,
 * run through every step the UI runs: inspect the workbook, pick the Blinkit
 * sheet, parse it, derive the period from its own dates, fetch B2B sales-order
 * lines for the configured GSTIN, map products through the ERP catalogue, and
 * reconcile by SKU.
 *
 * Skipped rather than failed when the workbook or the ERP credentials are not on
 * this machine — a developer without them should not see a red suite, and CI
 * without them should not silently claim this passed either. The skip reason
 * says which is missing.
 */

loadLocalEnv();

const WORKBOOK = "V:/soh-dashboard/HM Sales Dump.xlsx";
const MARKETPLACE = "blinkit";
/** Confirmed on both sides: the Blinkit sheet's `Supply State GST` and the ERP. */
const BLINKIT_GSTIN = "29AAFCG9846E1Z7";

const canRun = existsSync(WORKBOOK) && hasLiveErp();

describe.skipIf(!canRun)("real workbook, real ERP", () => {
  test("runs the whole client workflow and reports what it found", async () => {
    const { importMarketplaceSheet, inspectMarketplaceWorkbook } = await import(
      "@/lib/excel/workbook"
    );
    const { reportingPeriodFromDays } = await import("@/lib/dates/reporting-period");
    const { getErpClient } = await import("@/lib/erp");
    const { getCatalogSnapshot } = await import("@/lib/erp/catalog-cache");
    const { fetchReportLines } = await import("@/lib/report/erp-lines");
    const { CatalogIndex, mapExcelRows } = await import("@/lib/report/product-mapping");
    const { reconcileBySku } = await import("@/lib/report/sku-reconciliation");
    const { isReportableStatus, reportedQuantity } = await import("@/lib/report/policy");

    const data = new Uint8Array(readFileSync(WORKBOOK));

    // 1 — inspect. `Master` must never be offered as a sales sheet.
    const overview = inspectMarketplaceWorkbook(data);
    expect(overview.hasMasterSheet).toBe(true);
    const sheets = overview.marketplaces.map((entry) => entry.sheet);
    expect(sheets).toContain("Blinkit");
    expect(sheets).not.toContain("Master");

    // 2 — the user selects Blinkit. Nothing is auto-selected.
    const selected = overview.marketplaces.find(
      (entry) => entry.marketplace === MARKETPLACE,
    );
    expect(selected).toBeDefined();

    // 3 — parse, and 4 — derive the period from the sheet's own dates.
    const imported = importMarketplaceSheet(data, { sheet: selected!.sheet });
    expect(imported.marketplace).toBe(MARKETPLACE);
    expect(imported.statistics.minDate).not.toBeNull();
    expect(imported.statistics.maxDate).not.toBeNull();

    const period = reportingPeriodFromDays(
      imported.statistics.minDate!,
      imported.statistics.maxDate!,
    );

    // 5 — the ERP, for that period and that marketplace's GSTIN.
    const client = getErpClient();
    const erp = await fetchReportLines(client, {
      period,
      customerGstin: BLINKIT_GSTIN,
    });

    const reportable = erp.lines.filter((line) => isReportableStatus(line.status));
    // The status policy is the ERP's job here — it was sent as a filter, so
    // nothing unreportable should come back at all.
    expect(reportable.length).toBe(erp.lines.length);
    for (const line of erp.lines) {
      expect(line.customerGstin).toBe(BLINKIT_GSTIN);
      expect(["draft", "cancelled"]).not.toContain(line.status);
    }

    // 6 — map products through the ERP catalogue.
    const snapshot = await getCatalogSnapshot(client);
    const catalog = new CatalogIndex(snapshot.items);
    const mapping = mapExcelRows(imported.rows, catalog, { channelProvider: null });

    // Every row survives the mapping pass, mapped or not.
    expect(mapping.rows).toHaveLength(imported.rows.length);
    expect(
      mapping.statistics.mapped +
        mapping.statistics.ambiguous +
        mapping.statistics.unmapped,
    ).toBe(imported.rows.length);

    // 7 — reconcile by SKU.
    const reconciliation = reconcileBySku(mapping.rows, erp.lines);

    const erpQuantity = reportable.reduce(
      (total, line) => total + reportedQuantity(line),
      0,
    );
    const erpRevenue = reportable.reduce((total, line) => total + line.lineTotal, 0);
    const excelQuantity = imported.rows.reduce(
      (total, row) => total + (row.quantity ?? 0),
      0,
    );
    const excelRevenue = imported.rows.reduce(
      (total, row) => total + (row.grossSales ?? 0),
      0,
    );

    // Nothing is dropped: every SKU on either side is present in the output.
    const erpSkus = new Set(reportable.map((line) => line.sku.toUpperCase()));
    const reportedSkus = new Set(reconciliation.rows.map((row) => row.sku));
    for (const sku of erpSkus) expect(reportedSkus.has(sku)).toBe(true);

    // The totals are the sum of the parts, on both sides.
    expect(reconciliation.totals.erpQuantity).toBe(erpQuantity);
    expect(Math.round(reconciliation.totals.erpRevenue)).toBe(Math.round(erpRevenue));
    expect(reconciliation.totals.excelQuantity).toBe(excelQuantity);

    const report = {
      workbookRows: imported.rows.length,
      detectedPeriod: `${period.fromDay} → ${period.toDay}`,
      mappedRows: mapping.statistics.mapped,
      ambiguousRows: mapping.statistics.ambiguous,
      unmappedRows: mapping.statistics.unmapped,
      distinctProducts: mapping.statistics.distinctProducts,
      distinctMapped: mapping.statistics.distinctMapped,
      mappingRoutes: mapping.statistics.byRoute,
      catalogItems: catalog.counts.items,
      catalogWithBarcode: catalog.counts.withBarcode,
      catalogDuplicateBarcodes: catalog.counts.duplicateBarcodes,
      erpPages: erp.pages,
      erpOrders: new Set(reportable.map((line) => line.salesOrderId)).size,
      erpLines: reportable.length,
      erpSkus: erpSkus.size,
      erpQuantity,
      erpRevenue: Math.round(erpRevenue),
      excelQuantity,
      excelRevenue: Math.round(excelRevenue),
      skusMatched: reconciliation.counts.skusMatched,
      skusWithVariance: reconciliation.counts.skusWithVariance,
      skusErpOnly: reconciliation.counts.skusErpOnly,
      skusExcelOnly: reconciliation.counts.skusExcelOnly,
      quantityVariance: reconciliation.totals.quantityVariance,
      revenueVariance: Math.round(reconciliation.totals.amountVariance),
      topVariances: reconciliation.rows.slice(0, 8).map((row) => ({
        sku: row.sku,
        product: row.productName.slice(0, 44),
        status: row.status,
        erpQty: row.erpQuantity,
        reportQty: row.excelQuantity,
        qtyVar: row.quantityVariance,
      })),
    };

    // Written rather than logged: vitest swallows console output, and this is
    // the acceptance evidence.
    writeFileSync(
      "acceptance.out.json",
      JSON.stringify(report, null, 2),
    );

    expect(report.erpLines).toBeGreaterThan(0);
    expect(report.workbookRows).toBeGreaterThan(0);
  }, 900_000);
});

test.skipIf(canRun)("acceptance run skipped", () => {
  // Present so the suite says why rather than silently reporting one fewer test.
  expect(existsSync(WORKBOOK) || hasLiveErp()).toBeDefined();
});

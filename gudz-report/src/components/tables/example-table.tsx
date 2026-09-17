"use client";

import { createColumnHelper, tableFeatures } from "@tanstack/react-table";

import { DataTable } from "./data-table";

/**
 * Proves TanStack Table v9 renders typed rows in this project.
 *
 * A wiring check, not a design: it exists so a failure in the table layer shows
 * up as this component breaking rather than as a mystery when the real report
 * table is built. The data is inline and obviously synthetic — it is not ERP
 * data and must never be presented as any.
 */

interface ExampleRow extends Record<string, unknown> {
  sku: string;
  productName: string;
  quantity: number;
}

// Built once at module scope. A features object or column array recreated on
// every render makes the table rebuild its models each time.
const features = tableFeatures({});
const helper = createColumnHelper<typeof features, ExampleRow>();

const columns = helper.columns([
  helper.accessor("sku", { header: "SKU" }),
  helper.accessor("productName", { header: "Product" }),
  helper.accessor("quantity", { header: "Qty" }),
]);

const rows: ExampleRow[] = [
  { sku: "EXAMPLE-001", productName: "Example product A", quantity: 12 },
  { sku: "EXAMPLE-002", productName: "Example product B", quantity: 4 },
];

export function ExampleTable() {
  return <DataTable options={{ features, columns, data: rows }} />;
}

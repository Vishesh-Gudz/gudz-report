import type { ColumnMapping } from "../../types/excel";
import type { TextDateFormat } from "./validation";

/**
 * How each marketplace's sheet is laid out.
 *
 * The Healthy Master workbook is not one marketplace export — it is seven
 * sheets, one per channel plus a `Master` product table, and no two share a
 * schema. Zepto says `Sales Date`, Swiggy says `ORDERED_DATE`, Bigbasket says
 * `date_range` and means a range, Flipkart says `Month` and means a month name
 * with no year at all.
 *
 * Auto-detecting that from header names alone was how the first attempt failed:
 * it picked `Master`, which is a product mapping table with no dates, and
 * correctly reported that it could not derive a reporting period. Declaring the
 * layouts explicitly is the fix — a profile per sheet, matched by name, so
 * adding a channel is a new entry rather than a new guess.
 */

/**
 * How the date column has to be read.
 *
 * Kept as an explicit mode rather than sniffed per cell: the same string can be
 * a date in one sheet and something else in another, and guessing per value is
 * how `03/04/2026` becomes the wrong month.
 */
export type DateMode =
  /** A real date cell, or an unambiguous ISO string. */
  | "cell"
  /** Bigbasket's `20260609 - 20260609`. The range start is the sale date. */
  | "bigbasketRange"
  /** Flipkart's bare month name (`June`) — no year anywhere in the sheet. */
  | "monthName";

export interface MarketplaceProfile {
  /** Marketplace key, lower-case, matching the Convex configuration. */
  readonly marketplace: string;
  /** Sheet name in the workbook, matched case-insensitively. */
  readonly sheet: string;
  readonly dateMode: DateMode;
  /**
   * How a TEXT date in this sheet is laid out, when it has any.
   *
   * Declared, never sniffed. Zepto ships two thirds of its rows as `13-06-2026`
   * text; `05-01-2026` in the same column is genuinely ambiguous, and only the
   * sheet's own convention settles it.
   */
  readonly textDateFormat?: TextDateFormat;
  /**
   * Set when this sheet's date serials were produced by a spreadsheet reading
   * the column's day-first text under a month-first locale, leaving the day and
   * month transposed. See `undoMonthFirstCoercion`.
   */
  readonly serialsCoercedMonthFirst?: boolean;
  readonly mapping: ColumnMapping;
  /**
   * Column in `Master` holding this marketplace's own product id, used to
   * resolve a sales row to an EAN and from there to an ERP item.
   */
  readonly masterIdColumn: string | null;
  /** Notes surfaced in the UI — real limitations, not decoration. */
  readonly caveats?: ReadonlyArray<string>;
}

/** The product mapping sheet. Not sales data — it is the join table. */
export const MASTER_SHEET = "Master" as const;

export const MASTER_COLUMNS = {
  productName: "Product Name",
  grammage: "Grammage",
  mrp: "MRP",
  sellingPrice: "SP",
  /** The bridge to the ERP, whose catalogue stores EAN as `barcode`. */
  ean: "EAN",
  status: "Status",
  amazon: "A Now SIN",
  flipkart: "FSN",
  swiggy: "Swiggy ID",
  blinkit: "Blinkit ID",
  zepto: "Zepto PVID",
  bigbasket: "Bigbasket ID",
} as const;

export const MARKETPLACE_PROFILES: ReadonlyArray<MarketplaceProfile> = [
  {
    marketplace: "blinkit",
    sheet: "Blinkit",
    dateMode: "cell",
    masterIdColumn: MASTER_COLUMNS.blinkit,
    mapping: {
      orderDate: "Order Date",
      marketplaceOrderId: "Order Id",
      marketplaceItemId: "Item Id",
      // Blinkit ships the EAN on every row, so this sheet can reach the ERP
      // catalogue directly without going through `Master`.
      barcode: "UPC",
      productName: "Product Name",
      quantity: "Quantity",
      unitPrice: "Selling Price (Rs)",
      grossSales: "Total Gross Bill Amount",
      status: "Order Status",
    },
  },
  {
    marketplace: "bigbasket",
    sheet: "Bigbasket",
    dateMode: "bigbasketRange",
    masterIdColumn: MASTER_COLUMNS.bigbasket,
    mapping: {
      orderDate: "date_range",
      marketplaceItemId: "source_sku_id",
      productName: "sku_description",
      quantity: "Total_quantity",
      grossSales: "Total_sales",
    },
    caveats: [
      "Rows are pre-aggregated per city and day, so there is no order id and one row is many orders.",
    ],
  },
  {
    marketplace: "zepto",
    sheet: "Zepto",
    dateMode: "cell",
    // Mixed column: 27,143 date serials and 49,759 `DD-MM-YYYY` strings. The
    // serials are the same day-first text, coerced under a month-first locale
    // before the file reached us, so their day and month are transposed.
    textDateFormat: "DD-MM-YYYY",
    serialsCoercedMonthFirst: true,
    masterIdColumn: MASTER_COLUMNS.zepto,
    mapping: {
      orderDate: "Sales Date",
      marketplaceItemId: "SKU ID",
      productName: "SKU Name",
      quantity: "Quantity",
      grossSales: "GMV",
    },
    caveats: [
      "Aggregated per city and day; no order id.",
      "The date column mixes DD-MM-YYYY text with serials whose day and month were transposed before the file reached us; both are read and the transposition is undone.",
    ],
  },
  {
    marketplace: "swiggy",
    sheet: "Swiggy",
    dateMode: "cell",
    masterIdColumn: MASTER_COLUMNS.swiggy,
    mapping: {
      orderDate: "ORDERED_DATE",
      marketplaceItemId: "ITEM_CODE",
      productName: "PRODUCT_NAME",
      quantity: "UNITS_SOLD",
      unitPrice: "BASE_MRP",
      grossSales: "GMV",
    },
    caveats: ["Aggregated per store and day; no order id."],
  },
  {
    marketplace: "firstclub",
    sheet: "FirstClub",
    dateMode: "cell",
    // FirstClub's FCN is not in the Master sheet, so its rows cannot be
    // resolved to an EAN and will not reach the ERP catalogue.
    masterIdColumn: null,
    mapping: {
      orderDate: "sale_date",
      marketplaceItemId: "FCN",
      productName: "product_name",
      quantity: "Sum of units_sold",
      grossSales: "Sum of gmv",
    },
    caveats: [
      "FCN codes are absent from the Master sheet, so these rows cannot be mapped to an EAN or an ERP item.",
    ],
  },
  {
    marketplace: "flipkart",
    sheet: "Flipkart",
    dateMode: "monthName",
    masterIdColumn: MASTER_COLUMNS.flipkart,
    mapping: {
      orderDate: "Month",
      marketplaceItemId: "product_id",
      productName: "product_title",
      // Trailing space is in the real header. Matching it exactly matters.
      quantity: "Unit ",
      grossSales: "GMV",
    },
    caveats: [
      "The date column is a bare month name with no year anywhere in the sheet, so a reporting year must be supplied before these rows can be dated.",
    ],
  },
] as const;

/** The profile for a sheet, matched case-insensitively. */
export function profileForSheet(sheetName: string): MarketplaceProfile | null {
  const key = sheetName.trim().toLowerCase();
  return (
    MARKETPLACE_PROFILES.find(
      (profile) => profile.sheet.toLowerCase() === key,
    ) ?? null
  );
}

export function isMasterSheet(sheetName: string): boolean {
  return sheetName.trim().toLowerCase() === MASTER_SHEET.toLowerCase();
}

/** Sales sheets present in a workbook, in profile order. */
export function salesSheetsIn(
  sheetNames: ReadonlyArray<string>,
): MarketplaceProfile[] {
  return MARKETPLACE_PROFILES.filter((profile) =>
    sheetNames.some((name) => name.trim().toLowerCase() === profile.sheet.toLowerCase()),
  );
}

/**
 * Blinkit's registered GSTIN, as it appears on both sides.
 *
 * Not a guess: the Blinkit sheet carries `29AAFCG9846E1Z7` in `Supply State
 * GST`, and the ERP returns the same value on orders whose customer is
 * `BLINK COMMERCE PRIVATE LIMITED`. Exported for the configuration screen to
 * offer as a default — it is still written to Convex configuration rather than
 * compiled into the attribution logic.
 */
export const OBSERVED_MARKETPLACE_GSTINS: ReadonlyArray<{
  marketplace: string;
  gstin: string;
  source: string;
}> = [
  {
    marketplace: "blinkit",
    gstin: "29AAFCG9846E1Z7",
    source:
      "Blinkit sheet `Supply State GST`, matching the ERP customer BLINK COMMERCE PRIVATE LIMITED",
  },
];

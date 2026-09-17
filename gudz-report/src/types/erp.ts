import { z } from "zod";

/**
 * Wire types for the delivery-erp `/api/v1` surface.
 *
 * These mirror the ERP's published contract and nothing else — no field is
 * invented, and no field is renamed on the way in. Where the ERP says a value
 * can be null, it is nullable here, because a report that quietly turns a
 * missing GSTIN into an empty string is a report that lies.
 *
 * Every object is parsed **loosely**. The ERP documents its payloads as open
 * ("additional fields may be present; treat unknown fields as forward-
 * compatible"), so a strict schema would turn an additive ERP release into an
 * outage here.
 */

// ── Envelope ───────────────────────────────────────────────────────────────

/** Cursor pagination — used by every SOH collection. */
export const cursorPaginationSchema = z
  .object({
    limit: z.number().int(),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  })
  .loose();

/** Offset pagination — used by the older, pre-kit resource modules. */
export const offsetPaginationSchema = z
  .object({
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  })
  .loose();

export type CursorPagination = z.infer<typeof cursorPaginationSchema>;
export type OffsetPagination = z.infer<typeof offsetPaginationSchema>;

/**
 * Either pagination shape, because the ERP genuinely uses both.
 *
 * The SOH endpoints page by cursor; the older resource modules — customer GRN
 * among them — page by offset. A contract that insisted on cursors rejected a
 * perfectly valid response, which is how the GRN read came back as "ERP
 * unavailable" when the register was simply empty.
 */
export const paginationSchema = z.union([
  cursorPaginationSchema,
  offsetPaginationSchema,
]);
export type ErpPagination = CursorPagination | OffsetPagination;

/** Narrows to the cursor shape, for the walkers that follow one. */
export function isCursorPagination(
  pagination: ErpPagination | undefined,
): pagination is CursorPagination {
  return pagination !== undefined && "hasMore" in pagination;
}

/** The reporting window the ERP echoes back, so a caller can confirm what it asked for. */
export const periodSchema = z
  .object({
    from: z.string(),
    to: z.string(),
    dateField: z.string(),
  })
  .loose();

export type Period = z.infer<typeof periodSchema>;

/**
 * Totals for the ENTIRE filtered set, not the current page.
 *
 * Worth restating because it is the whole reason to trust it: paging does not
 * change these numbers, so a dashboard can show a total before it has walked
 * every page.
 */
export const salesOrderSummarySchema = z
  .object({
    orders: z.number(),
    totalAmount: z.number(),
    totalQuantity: z.number(),
    distinctCustomers: z.number(),
    distinctSkus: z.number(),
  })
  .loose();

export type SalesOrderSummary = z.infer<typeof salesOrderSummarySchema>;

export const erpErrorSchema = z
  .object({
    success: z.literal(false),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        details: z.unknown().optional(),
      })
      .loose(),
    meta: z.object({ requestId: z.string() }).loose(),
  })
  .loose();

export type ErpErrorBody = z.infer<typeof erpErrorSchema>;

/** Builds the success envelope around a given payload schema. */
export function erpSuccessSchema<T extends z.ZodType>(data: T) {
  return z
    .object({
      success: z.literal(true),
      data,
      meta: z
        .object({
          requestId: z.string(),
          pagination: paginationSchema.optional(),
          period: periodSchema.optional(),
          summary: salesOrderSummarySchema.optional(),
        })
        .loose(),
    })
    .loose();
}

// ── Sales orders ───────────────────────────────────────────────────────────

/**
 * Customer identity as the ERP resolves it: the `customers` master merged over
 * the order's own snapshot, with `source` saying which one supplied the values.
 *
 * `gstin` is the field to group and filter on. `customerName` fragments in real
 * data (the same buyer appears under several spellings and several ids), and
 * `channel` describes where an order came from rather than who bought it.
 */
export const salesOrderCustomerSchema = z
  .object({
    customerId: z.string().nullable(),
    customerCode: z.string().nullable(),
    name: z.string(),
    customerType: z.string().nullable(),
    gstin: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    city: z.string().nullable(),
    state: z.string().nullable(),
    segment: z.string().nullable(),
    paymentTerms: z.string().nullable(),
    creditDays: z.number().nullable(),
    source: z.enum(["master", "snapshot"]),
  })
  .loose();

export type SalesOrderCustomer = z.infer<typeof salesOrderCustomerSchema>;

export const salesOrderTotalsSchema = z
  .object({
    subtotal: z.number(),
    discountAmount: z.number(),
    taxAmount: z.number(),
    shippingCost: z.number(),
    adjustmentAmount: z.number(),
    roundOffAmount: z.number(),
    totalAmount: z.number(),
    currency: z.string(),
    paymentTerms: z.string().nullable(),
    rateStorageMode: z.string(),
  })
  .loose();

export type SalesOrderTotals = z.infer<typeof salesOrderTotalsSchema>;

export const salesOrderFulfillmentSchema = z
  .object({
    sourceHubId: z.string().nullable(),
    picklistId: z.string().nullable(),
    packingId: z.string().nullable(),
    b2bOrderId: z.string().nullable(),
    assignedDriverName: z.string().nullable(),
    assignedVehicleNumber: z.string().nullable(),
  })
  .loose();

export const salesOrderItemSchema = z
  .object({
    salesOrderItemId: z.string(),
    /** Null on service lines, which reference the services master instead. */
    itemId: z.string().nullable(),
    sku: z.string(),
    name: z.string(),
    unit: z.string().nullable(),
    hsnCode: z.string().nullable(),
    orderedQuantity: z.number(),
    pickedQuantity: z.number(),
    packedQuantity: z.number(),
    shippedQuantity: z.number(),
    deliveredQuantity: z.number(),
    mrp: z.number().nullable(),
    unitPrice: z.number(),
    lineTotal: z.number(),
    discountPercent: z.number().nullable(),
    discountAmount: z.number().nullable(),
    taxPercent: z.number().nullable(),
    taxAmount: z.number().nullable(),
    taxableValue: z.number().nullable(),
    cgstAmount: z.number().nullable(),
    sgstAmount: z.number().nullable(),
    igstAmount: z.number().nullable(),
    /** Set when the line ships as a substitute SKU. */
    fulfillmentSku: z.string().nullable(),
    fulfillmentQuantity: z.number().nullable(),
  })
  .loose();

export type SalesOrderItem = z.infer<typeof salesOrderItemSchema>;

export const salesOrderSchema = z
  .object({
    salesOrderId: z.string(),
    soNumber: z.string(),
    referenceNumber: z.string().nullable(),
    version: z.number(),

    orderDate: z.string(),
    expectedDeliveryDate: z.string().nullable(),
    actualDeliveryDate: z.string().nullable(),
    dispatchedAt: z.string().nullable(),
    deliveredAt: z.string().nullable(),
    approvedAt: z.string().nullable(),
    createdAt: z.string(),

    status: z.string(),
    fulfillmentStatus: z.string().nullable(),
    packingStatus: z.string().nullable(),
    orderType: z.string(),

    /** Order metadata, not customer identity. Frequently null in real data. */
    channel: z.string().nullable(),
    channelNormalized: z.string().nullable(),

    customer: salesOrderCustomerSchema,
    totals: salesOrderTotalsSchema,
    fulfillment: salesOrderFulfillmentSchema,

    itemCount: z.number().int(),
    /** Null when the request set `includeItems=false` — distinct from an order with no lines. */
    items: z.array(salesOrderItemSchema).nullable(),
  })
  .loose();

export type SalesOrder = z.infer<typeof salesOrderSchema>;

/** One sales-order line, flattened with its order's identity for reconciliation. */
export const salesOrderLineSchema = z
  .object({
    salesOrderId: z.string(),
    soNumber: z.string(),
    referenceNumber: z.string().nullable(),
    orderDate: z.string(),
    dispatchedAt: z.string().nullable(),
    deliveredAt: z.string().nullable(),
    status: z.string(),
    orderType: z.string(),
    channel: z.string().nullable(),
    channelNormalized: z.string().nullable(),
    customerId: z.string().nullable(),
    customerName: z.string(),
    customerCode: z.string().nullable(),
    customerType: z.string().nullable(),
    customerGstin: z.string().nullable(),
    sourceHubId: z.string().nullable(),

    salesOrderItemId: z.string(),
    itemId: z.string().nullable(),
    sku: z.string(),
    name: z.string(),
    unit: z.string().nullable(),
    hsnCode: z.string().nullable(),
    orderedQuantity: z.number(),
    shippedQuantity: z.number(),
    deliveredQuantity: z.number(),
    unitPrice: z.number(),
    lineTotal: z.number(),
    taxableValue: z.number().nullable(),
    taxAmount: z.number().nullable(),
    fulfillmentSku: z.string().nullable(),
    fulfillmentQuantity: z.number().nullable(),
  })
  .loose();

export type SalesOrderLine = z.infer<typeof salesOrderLineSchema>;

// ── Catalogue ──────────────────────────────────────────────────────────────

export const catalogCustomerIdentifierSchema = z
  .object({
    customerId: z.string(),
    customerName: z.string().nullable(),
    identifierType: z.string(),
    identifierValue: z.string(),
    isActive: z.boolean(),
  })
  .loose();

export const catalogChannelMappingSchema = z
  .object({
    provider: z.string(),
    integrationId: z.string().nullable(),
    keyType: z.enum(["variant", "sku", "product", "title"]),
    externalKey: z.string(),
    externalSku: z.string().nullable(),
    externalTitle: z.string().nullable(),
    unitsPerOrderedUnit: z.string(),
    action: z.enum(["map", "ignore"]),
    isActive: z.boolean(),
  })
  .loose();

/**
 * The SKU master plus every identifier a spreadsheet row can be matched on.
 *
 * In production most of these are sparsely populated — barcodes and HSN codes
 * are set on a minority of finished goods — so a matcher must treat every
 * identifier as optional rather than assuming a key exists.
 */
export const catalogItemSchema = z
  .object({
    itemId: z.string(),
    sku: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    category: z.string().nullable(),
    subCategory: z.string().nullable(),
    brand: z.string().nullable(),
    unitOfMeasure: z.string().nullable(),
    barcode: z.string().nullable(),
    barcodeType: z.string().nullable(),
    searchTags: z.array(z.string()),
    hsnCode: z.string().nullable(),
    gstRate: z.number().nullable(),
    mrp: z.string().nullable(),
    unitsPerCarton: z.number().nullable(),
    itemType: z.string(),
    inventoryType: z.string(),
    trackBatches: z.boolean(),
    shelfLifeDays: z.number().nullable(),
    isActive: z.boolean(),
    primaryImageUrl: z.string().nullable(),
    customerItemIdentifiers: z.array(catalogCustomerIdentifierSchema),
    channelItemMappings: z.array(catalogChannelMappingSchema),
  })
  .loose();

export type CatalogItem = z.infer<typeof catalogItemSchema>;

// ── Snapshot ───────────────────────────────────────────────────────────────

export const snapshotLocationSchema = z
  .object({
    type: z.string(),
    id: z.string(),
    name: z.string().nullable(),
    code: z.string().nullable(),
  })
  .loose();

/**
 * Live stock position. `availableQuantity` already excludes what is blocked by
 * open orders and picklists — promise against it, never against `quantity`.
 */
export const snapshotRowSchema = z
  .object({
    itemId: z.string(),
    sku: z.string(),
    name: z.string(),
    barcode: z.string().nullable(),
    category: z.string().nullable(),
    brand: z.string().nullable(),
    uom: z.string().nullable(),
    location: snapshotLocationSchema,
    quantity: z.number(),
    blockedQuantity: z.number(),
    availableQuantity: z.number(),
    minStockLevel: z.number(),
    updatedAt: z.string().nullable(),
  })
  .loose();

export type SnapshotRow = z.infer<typeof snapshotRowSchema>;

// ── Ledger health ──────────────────────────────────────────────────────────

export const ledgerHealthSchema = z
  .object({
    backlogRows: z.number().int(),
    inventoryLogBacklog: z.number().int(),
    inventoryMovementsBacklog: z.number().int(),
    lastSyncAt: z.string().nullable(),
    threshold: z.number().int(),
    status: z.enum(["ok", "degraded"]),
  })
  .loose();

export type LedgerHealth = z.infer<typeof ledgerHealthSchema>;

// ── Request vocabulary ─────────────────────────────────────────────────────

/** Period axis. `orderDate` is the business date and the default. */
export const ERP_DATE_FIELDS = [
  "orderDate",
  "expectedDeliveryDate",
  "dispatchedAt",
  "deliveredAt",
] as const;
export type ErpDateField = (typeof ERP_DATE_FIELDS)[number];

export const ERP_SALES_ORDER_STATUSES = [
  "draft",
  "approved",
  "validated",
  "reserved",
  "picking",
  "picked",
  "packing",
  "packed",
  "ready_to_ship",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "completed",
  "cancelled",
  "on_hold",
] as const;
export type ErpSalesOrderStatus = (typeof ERP_SALES_ORDER_STATUSES)[number];

export const ERP_CUSTOMER_TYPES = ["INDIVIDUAL", "BUSINESS"] as const;
export type ErpCustomerType = (typeof ERP_CUSTOMER_TYPES)[number];

export const ERP_ORDER_TYPES = ["product", "service"] as const;
export type ErpOrderType = (typeof ERP_ORDER_TYPES)[number];

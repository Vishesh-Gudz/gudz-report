/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as erp from "../erp.js";
import type * as excel from "../excel.js";
import type * as imports from "../imports.js";
import type * as marketplaces from "../marketplaces.js";
import type * as productMappings from "../productMappings.js";
import type * as reconciliation from "../reconciliation.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  erp: typeof erp;
  excel: typeof excel;
  imports: typeof imports;
  marketplaces: typeof marketplaces;
  productMappings: typeof productMappings;
  reconciliation: typeof reconciliation;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};

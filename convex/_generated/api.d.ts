/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as auth from "../auth.js";
import type * as checkpoints from "../checkpoints.js";
import type * as conversations from "../conversations.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as results from "../results.js";
import type * as retrieval from "../retrieval.js";
import type * as routeEvaluations from "../routeEvaluations.js";
import type * as runInputs from "../runInputs.js";
import type * as runs from "../runs.js";
import type * as summaries from "../summaries.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  auth: typeof auth;
  checkpoints: typeof checkpoints;
  conversations: typeof conversations;
  crons: typeof crons;
  http: typeof http;
  results: typeof results;
  retrieval: typeof retrieval;
  routeEvaluations: typeof routeEvaluations;
  runInputs: typeof runInputs;
  runs: typeof runs;
  summaries: typeof summaries;
  workspaces: typeof workspaces;
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

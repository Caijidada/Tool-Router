export const projectStatus = Object.freeze({
  name: "agent-tool-router",
  version: "0.1.0",
  mode: "offline-routing-baseline",
  executesTools: false,
  makesModelRequests: false,
} as const);

export { buildCatalog, CatalogError } from "./catalog.js";
export type { CatalogSnapshot, CatalogTool, JsonObject, JsonValue } from "./catalog.js";
export { retrieveCandidates } from "./retrieval.js";
export type { Candidate } from "./retrieval.js";
export { routeTools } from "./routing.js";
export type {
  RouteCandidate,
  RouteDecision,
  RouteRequest,
  RoutingPolicy,
  RoutingState,
  ToolReadiness,
} from "./routing.js";
export type {
  DecisionCandidate,
  DecisionInput,
  DecisionProvider,
  ProviderDecision,
} from "./decision-provider.js";
export { parseProviderDecision, ProviderOutputError } from "./provider-output.js";

import type { CatalogSnapshot } from "./catalog.js";
import { rankCandidates } from "./retrieval.js";

/** Supplied by trusted application code, never by the model or tool descriptions. */
export interface RoutingPolicy {
  readonly revision: string;
  readonly allowedToolIds: readonly string[];
}

export type ToolReadiness =
  | { readonly kind: "ready" }
  | { readonly kind: "missing"; readonly resources: readonly string[] }
  | { readonly kind: "unknown" };

export interface RoutingState {
  readonly revision: string;
  readonly tools: Readonly<Record<string, ToolReadiness>>;
}

export interface RouteRequest {
  readonly query: string;
  readonly catalog: CatalogSnapshot;
  readonly policy: RoutingPolicy;
  readonly state: RoutingState;
  readonly limit?: number;
}

export interface RouteCandidate {
  readonly toolId: string;
  readonly lexicalScore: number;
  readonly readiness: ToolReadiness;
}

interface RouteContext {
  readonly advisory: true;
  readonly catalogDigest: string;
  readonly policyRevision: string;
  readonly stateRevision: string;
  readonly provider: "lexical-v1";
  readonly candidates: readonly RouteCandidate[];
  readonly deniedToolIds: readonly string[];
}

export type RouteDecision = RouteContext &
  (
    | { readonly kind: "selected"; readonly toolId: string }
    | {
        readonly kind: "abstained";
        readonly reason:
          "no_allowed_tools" | "no_match" | "ambiguous" | "needs_prerequisites" | "state_unknown";
      }
  );

function assertRevision(value: string, label: string): void {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 256) {
    throw new RangeError(`${label} must be a nonblank revision of at most 256 characters`);
  }
}

function snapshotReadiness(state: RoutingState, id: string): ToolReadiness {
  if (!Object.hasOwn(state.tools, id)) return Object.freeze({ kind: "unknown" });
  const value = state.tools[id];
  if (!value || value.kind === "unknown") return Object.freeze({ kind: "unknown" });
  if (value.kind === "ready") return Object.freeze({ kind: "ready" });
  if (
    value.kind !== "missing" ||
    !Array.isArray(value.resources) ||
    value.resources.length === 0 ||
    value.resources.length > 100 ||
    value.resources.some(
      (resource) => typeof resource !== "string" || !resource.trim() || resource.length > 256,
    )
  ) {
    throw new RangeError(`Invalid readiness for ${id}`);
  }
  return Object.freeze({ kind: "missing", resources: Object.freeze([...value.resources]) });
}

/**
 * Offline baseline only: recommends a tool, never authorizes or executes a call.
 * Missing prerequisites are surfaced, not automatically planned or fulfilled.
 */
export function routeTools(request: RouteRequest): RouteDecision {
  return prepareRoute(request).decision;
}

/** Shared immutable preparation; full ranking is not exposed through the display limit. */
export function prepareRoute(request: RouteRequest): {
  readonly decision: RouteDecision;
  readonly candidates: readonly RouteCandidate[];
} {
  assertRevision(request.policy.revision, "policy");
  assertRevision(request.state.revision, "state");
  if (
    !Array.isArray(request.policy.allowedToolIds) ||
    request.policy.allowedToolIds.length > 1_000 ||
    request.policy.allowedToolIds.some(
      (id) => typeof id !== "string" || id.length > 258 || !id.includes("::"),
    )
  ) {
    throw new RangeError("allowedToolIds must be an explicit list of namespaced tool IDs");
  }
  const known = new Set(request.catalog.tools.map((tool) => tool.id));
  const allowed = new Set(request.policy.allowedToolIds);
  for (const id of allowed) {
    if (!known.has(id)) throw new RangeError(`Policy references an unknown tool: ${id}`);
  }
  const permitted = request.catalog.tools.filter((tool) => allowed.has(tool.id));
  // Score all permitted tools before truncation, so limit=1 cannot conceal a tie.
  const ranked = rankCandidates(permitted, request.query);
  const limit = request.limit ?? 8;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new RangeError("Candidate limit must be an integer from 1 to 50");
  }
  const candidates = ranked.map(({ tool, lexicalScore }) =>
    Object.freeze({
      toolId: tool.id,
      lexicalScore,
      readiness: snapshotReadiness(request.state, tool.id),
    }),
  );
  const topScore = candidates[0]?.lexicalScore;
  const top = candidates.filter((candidate) => candidate.lexicalScore === topScore);
  const context: RouteContext = {
    advisory: true,
    catalogDigest: request.catalog.digest,
    policyRevision: request.policy.revision,
    stateRevision: request.state.revision,
    provider: "lexical-v1",
    candidates: Object.freeze(candidates.slice(0, limit)),
    deniedToolIds: Object.freeze(
      request.catalog.tools.filter((tool) => !allowed.has(tool.id)).map((tool) => tool.id),
    ),
  };
  const abstain = (
    reason: Extract<RouteDecision, { kind: "abstained" }>["reason"],
  ): RouteDecision => Object.freeze({ ...context, kind: "abstained", reason });
  const choose = (): RouteDecision => {
    if (permitted.length === 0) return abstain("no_allowed_tools");
    if (top.length === 0) return abstain("no_match");
    // Do not silently substitute a weaker ready tool for the best unavailable match.
    if (top.some((candidate) => candidate.readiness.kind === "unknown"))
      return abstain("state_unknown");
    if (top.some((candidate) => candidate.readiness.kind === "missing"))
      return abstain("needs_prerequisites");
    if (top.length > 1) return abstain("ambiguous");
    const winner = top[0];
    if (!winner) return abstain("no_match");
    return Object.freeze({ ...context, kind: "selected", toolId: winner.toolId });
  };
  return Object.freeze({ decision: choose(), candidates: Object.freeze(candidates) });
}

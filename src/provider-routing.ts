import type { DecisionInput, DecisionProvider } from "./decision-provider.js";
import { parseProviderDecision } from "./provider-output.js";
import {
  prepareRoute,
  type RouteCandidate,
  type RouteDecision,
  type RouteRequest,
} from "./routing.js";

type BaselineReason = Extract<RouteDecision, { kind: "abstained" }>["reason"];
type ProviderFailure = "provider_error" | "provider_timeout" | "cancelled";
export type ProviderStatus =
  | "not_called"
  | "selected"
  | "no_suitable_tool"
  | "uncertain"
  | "low_confidence"
  | "invalid_provider_output"
  | ProviderFailure;

export interface ProviderRouteOptions {
  readonly provider: DecisionProvider;
  /** Application-chosen experiment setting, not a calibrated probability guarantee. */
  readonly minConfidence: number;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly fallback?: "none" | "lexical";
  /** Separate from RouteRequest.limit (display only). Defaults to 8; maximum 32. */
  readonly candidateLimit?: number;
}

interface ProviderRouteContext {
  readonly advisory: true;
  readonly catalogDigest: string;
  readonly policyRevision: string;
  readonly stateRevision: string;
  readonly candidates: readonly RouteCandidate[];
  readonly deniedToolIds: readonly string[];
  readonly providerId: string;
  readonly providerCandidateIds: readonly string[];
  readonly providerStatus: ProviderStatus;
  readonly source: "guard" | "provider" | "lexical-fallback";
}

export type ProviderRouteDecision = ProviderRouteContext &
  (
    | { readonly kind: "selected"; readonly toolId: string; readonly confidence?: number }
    | {
        readonly kind: "abstained";
        readonly reason:
          | BaselineReason
          | "candidate_budget_exceeded"
          | Exclude<ProviderStatus, "not_called" | "selected">;
      }
  );

type CallResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: ProviderFailure };

/** Bounds our wait even when a trusted provider implementation ignores its signal. */
function callProvider(
  decide: DecisionProvider["decide"],
  input: DecisionInput,
  timeoutMs: number,
  externalSignal: AbortSignal | undefined,
): Promise<CallResult> {
  return new Promise((resolve) => {
    const controller = new AbortController();
    const deadline = performance.now() + timeoutMs;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: CallResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const stop = (reason: "cancelled" | "provider_timeout"): void => {
      finish({ ok: false, reason });
      controller.abort();
    };
    const onAbort = (): void => stop("cancelled");
    if (externalSignal?.aborted) {
      stop("cancelled");
      return;
    }
    externalSignal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => stop("provider_timeout"), timeoutMs);
    // Promise chaining normalizes synchronous throws and observes late rejections.
    void Promise.resolve()
      .then(() => {
        if (settled) return undefined;
        if (externalSignal?.aborted) {
          stop("cancelled");
          return undefined;
        }
        if (performance.now() >= deadline) {
          stop("provider_timeout");
          return undefined;
        }
        return decide(input, controller.signal);
      })
      .then(
        (value: unknown) => {
          if (settled) return;
          if (externalSignal?.aborted) stop("cancelled");
          else if (performance.now() >= deadline) stop("provider_timeout");
          else finish({ ok: true, value });
        },
        () => {
          if (settled) return;
          if (externalSignal?.aborted) stop("cancelled");
          else if (performance.now() >= deadline) stop("provider_timeout");
          else finish({ ok: false, reason: "provider_error" });
        },
      );
  });
}

/** Opt-in asynchronous scoring. Neither a provider response nor fallback authorizes execution. */
export async function routeWithProvider(
  request: RouteRequest,
  options: ProviderRouteOptions,
): Promise<ProviderRouteDecision> {
  // Copy trusted configuration before crossing an async boundary.
  const { provider, minConfidence, timeoutMs, signal } = options;
  const fallback = options.fallback ?? "none";
  const candidateLimit = options.candidateLimit ?? 8;
  const displayLimit = request.limit ?? 8;
  if (!Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1)
    throw new RangeError("minConfidence must be a finite value from 0 through 1");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000)
    throw new RangeError("timeoutMs must be an integer from 1 through 60000");
  if (!Number.isInteger(candidateLimit) || candidateLimit < 1 || candidateLimit > 32)
    throw new RangeError("candidateLimit must be an integer from 1 through 32");
  if (!Number.isInteger(displayLimit) || displayLimit < 1 || displayLimit > 50)
    throw new RangeError("limit must be an integer from 1 through 50");
  if (fallback !== "none" && fallback !== "lexical")
    throw new RangeError("fallback must be none or lexical");
  if (
    !provider ||
    typeof provider.id !== "string" ||
    !provider.id.trim() ||
    provider.id.length > 128 ||
    typeof provider.decide !== "function"
  )
    throw new RangeError("A named decision provider is required");

  const providerId = provider.id;
  const decide = provider.decide.bind(provider);
  const prepared = prepareRoute(request);
  const baseline = prepared.decision;
  const context = {
    advisory: true as const,
    catalogDigest: baseline.catalogDigest,
    policyRevision: baseline.policyRevision,
    stateRevision: baseline.stateRevision,
    candidates: baseline.candidates,
    deniedToolIds: baseline.deniedToolIds,
    providerId,
  };
  let providerCandidateIds: readonly string[] = Object.freeze([]);
  const abstain = (
    reason: Extract<ProviderRouteDecision, { kind: "abstained" }>["reason"],
    providerStatus: ProviderStatus,
    source: ProviderRouteContext["source"],
  ): ProviderRouteDecision =>
    Object.freeze({
      ...context,
      providerCandidateIds,
      providerStatus,
      source,
      kind: "abstained",
      reason,
    });
  if (signal?.aborted) return abstain("cancelled", "cancelled", "guard");
  if (baseline.kind === "abstained" && baseline.reason !== "ambiguous")
    return abstain(baseline.reason, "not_called", "guard");

  // An unavailable top match was already guarded above. Do not offer unavailable lower matches.
  const ready = prepared.candidates.filter((candidate) => candidate.readiness.kind === "ready");
  if (
    ready.length > candidateLimit &&
    ready[candidateLimit - 1]?.lexicalScore === ready[candidateLimit]?.lexicalScore
  )
    return abstain("candidate_budget_exceeded", "not_called", "guard");
  const offered = ready.slice(0, candidateLimit);
  providerCandidateIds = Object.freeze(offered.map((candidate) => candidate.toolId));
  const tools = new Map(request.catalog.tools.map((tool) => [tool.id, tool]));
  const input: DecisionInput = Object.freeze({
    query: request.query,
    candidates: Object.freeze(
      offered.map(({ toolId }) => {
        const tool = tools.get(toolId);
        if (!tool) throw new RangeError("Catalog snapshot is inconsistent");
        return Object.freeze({ toolId, name: tool.name, description: tool.description });
      }),
    ),
  });
  const result = await callProvider(decide, input, timeoutMs, signal);
  if (signal?.aborted) return abstain("cancelled", "cancelled", "provider");
  if (!result.ok) {
    if (fallback === "lexical" && result.reason !== "cancelled") {
      if (baseline.kind === "abstained")
        return abstain(baseline.reason, result.reason, "lexical-fallback");
      return Object.freeze({
        ...context,
        providerCandidateIds,
        providerStatus: result.reason,
        source: "lexical-fallback",
        kind: "selected",
        toolId: baseline.toolId,
      });
    }
    return abstain(result.reason, result.reason, "provider");
  }
  try {
    const decision = parseProviderDecision(result.value, providerCandidateIds);
    if (signal?.aborted) return abstain("cancelled", "cancelled", "provider");
    if (decision.kind === "abstained") return abstain(decision.reason, decision.reason, "provider");
    if (decision.confidence < minConfidence)
      return abstain("low_confidence", "low_confidence", "provider");
    return Object.freeze({
      ...context,
      providerCandidateIds,
      providerStatus: "selected",
      source: "provider",
      kind: "selected",
      toolId: decision.toolId,
      confidence: decision.confidence,
    });
  } catch {
    if (signal?.aborted) return abstain("cancelled", "cancelled", "provider");
    return abstain("invalid_provider_output", "invalid_provider_output", "provider");
  }
}

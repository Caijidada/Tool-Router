/** Contract for the next milestone; no model requests are made by the offline router. */
export interface DecisionCandidate {
  readonly toolId: string;
  readonly name: string;
  readonly description: string;
}

export interface DecisionInput {
  readonly query: string;
  readonly candidates: readonly DecisionCandidate[];
}

export type ProviderDecision =
  | { readonly kind: "selected"; readonly toolId: string; readonly confidence: number }
  | { readonly kind: "abstained"; readonly reason: "no_suitable_tool" | "uncertain" };

export interface DecisionProvider {
  readonly id: string;
  /** Treat the returned data as untrusted. The orchestrator must validate it. */
  decide(input: DecisionInput, signal: AbortSignal): Promise<unknown>;
}

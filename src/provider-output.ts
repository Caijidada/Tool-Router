import type { ProviderDecision } from "./decision-provider.js";

/** Deliberately excludes provider data and underlying exception details. */
export class ProviderOutputError extends Error {
  constructor() {
    super("Provider returned an invalid decision");
    this.name = "ProviderOutputError";
  }
}

/**
 * Accept only the exact decision envelope and this invocation's candidate IDs.
 * Ordinary accessors are inspected, never invoked. This validates data; it is
 * not a sandbox for executable JavaScript objects such as hostile Proxies.
 */
export function parseProviderDecision(
  input: unknown,
  candidateIds: readonly string[],
): ProviderDecision {
  try {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw new ProviderOutputError();
    }
    const prototype = Object.getPrototypeOf(input) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new ProviderOutputError();
    }
    const keys = Reflect.ownKeys(input);
    if (keys.length !== 2 && keys.length !== 3) throw new ProviderOutputError();
    const values = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      if (typeof key !== "string") throw new ProviderOutputError();
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        throw new ProviderOutputError();
      }
      values[key] = descriptor.value as unknown;
    }

    if (values["kind"] === "selected") {
      const toolId = values["toolId"];
      const confidence = values["confidence"];
      if (
        keys.length !== 3 ||
        typeof toolId !== "string" ||
        !candidateIds.includes(toolId) ||
        typeof confidence !== "number" ||
        !Number.isFinite(confidence) ||
        confidence < 0 ||
        confidence > 1
      ) {
        throw new ProviderOutputError();
      }
      return Object.freeze({ kind: "selected", toolId, confidence });
    }

    if (values["kind"] === "abstained") {
      const reason = values["reason"];
      if (keys.length !== 2 || (reason !== "no_suitable_tool" && reason !== "uncertain")) {
        throw new ProviderOutputError();
      }
      return Object.freeze({ kind: "abstained", reason });
    }
    throw new ProviderOutputError();
  } catch {
    // Includes reflection failures from Proxies without exposing their thrown data.
    throw new ProviderOutputError();
  }
}

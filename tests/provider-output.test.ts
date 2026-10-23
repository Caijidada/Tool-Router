import assert from "node:assert/strict";
import test from "node:test";
import { parseProviderDecision, ProviderOutputError } from "../src/provider-output.js";

const candidateIds = ["git::diff", "web::search"];
const selected = () => ({ kind: "selected", toolId: "git::diff", confidence: 0.8 });

function rejects(input: unknown, candidates: readonly string[] = candidateIds): void {
  assert.throws(
    () => parseProviderDecision(input, candidates),
    (error: unknown) =>
      error instanceof ProviderOutputError &&
      error.message === "Provider returned an invalid decision" &&
      !("cause" in error),
  );
}

test("accepts selected decisions including the exact confidence boundaries", () => {
  for (const confidence of [0, 0.5, 1]) {
    const input = { ...selected(), confidence };
    const result = parseProviderDecision(input, candidateIds);
    assert.deepEqual(result, input);
    assert.notEqual(result, input);
    assert.ok(Object.isFrozen(result));
  }
});

test("accepts both abstention reasons and does not require any candidates", () => {
  for (const reason of ["no_suitable_tool", "uncertain"]) {
    const input = { kind: "abstained", reason };
    const result = parseProviderDecision(input, []);
    assert.deepEqual(result, input);
    assert.ok(Object.isFrozen(result));
  }
});

test("accepts null-prototype envelopes and ignores property insertion order", () => {
  const input = Object.assign(Object.create(null) as object, {
    confidence: 0.75,
    toolId: "web::search",
    kind: "selected",
  });
  assert.deepEqual(parseProviderDecision(input, candidateIds), {
    kind: "selected",
    toolId: "web::search",
    confidence: 0.75,
  });
});

test("requires an exact candidate member, not merely a valid-looking tool ID", () => {
  for (const toolId of ["git::commit", "Git::diff", "git::diff ", "", 1, null, {}]) {
    rejects({ ...selected(), toolId });
  }
  rejects(selected(), []);
});

test("rejects nonfinite, out-of-range and nonnumeric confidence values", () => {
  for (const confidence of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    -Number.EPSILON,
    1 + Number.EPSILON,
    "0.9",
    true,
    null,
    undefined,
    1n,
    {},
  ]) {
    rejects({ ...selected(), confidence });
  }
});

test("rejects wrong kinds, missing fields, extra fields and invalid reasons", () => {
  for (const input of [
    {},
    { toolId: "git::diff", confidence: 1 },
    { kind: "selected", confidence: 1 },
    { kind: "selected", toolId: "git::diff" },
    { ...selected(), kind: "SELECTED" },
    { ...selected(), extra: "sensitive-data" },
    { ...selected(), reason: "uncertain" },
    { kind: "abstained" },
    { kind: "abstained", reason: "unknown" },
    { kind: "abstained", reason: null },
    { kind: "abstained", reason: "uncertain", confidence: 0 },
    { kind: "abstained", reason: "uncertain", toolId: "git::diff" },
  ]) {
    rejects(input);
  }
});

test("rejects primitives, arrays, class instances and inherited decision fields", () => {
  class Decision {
    kind = "selected";
    toolId = "git::diff";
    confidence = 1;
  }
  for (const input of [
    null,
    undefined,
    true,
    42,
    "selected",
    1n,
    Symbol("secret"),
    () => selected(),
    [],
    [selected()],
    new Date(),
    new Decision(),
    Object.create(selected()) as unknown,
    Object.assign(Object.create({ inherited: true }) as object, selected()),
  ]) {
    rejects(input);
  }
});

test("rejects symbol and nonenumerable properties", () => {
  const symbolExtra = { kind: "abstained", reason: "uncertain", [Symbol("secret")]: true };
  rejects(symbolExtra);
  for (const field of ["kind", "toolId", "confidence"]) {
    const input = selected();
    Object.defineProperty(input, field, { enumerable: false });
    rejects(input);
  }
  const hiddenExtra = { kind: "abstained", reason: "uncertain" };
  Object.defineProperty(hiddenExtra, "secret", { value: true, enumerable: false });
  rejects(hiddenExtra);
});

test("rejects accessors without invoking getters or setters", () => {
  let invoked = false;
  for (const field of ["kind", "toolId", "confidence"]) {
    const input = selected();
    Object.defineProperty(input, field, {
      enumerable: true,
      get() {
        invoked = true;
        throw new Error("private-provider-data");
      },
    });
    rejects(input);
  }
  const input = { kind: "abstained" };
  Object.defineProperty(input, "reason", {
    enumerable: true,
    set() {
      invoked = true;
    },
  });
  rejects(input);
  assert.equal(invoked, false);
});

test("does not retain ownership of the provider's mutable envelope", () => {
  const input = selected();
  const result = parseProviderDecision(input, candidateIds);
  input.toolId = "git::commit";
  input.confidence = 0;
  assert.deepEqual(result, { kind: "selected", toolId: "git::diff", confidence: 0.8 });
});

test("normalizes reflection failures and revoked Proxies without leaking thrown details", () => {
  for (const handler of [
    {
      getPrototypeOf: () => {
        throw new Error("private-prototype");
      },
    },
    {
      ownKeys: () => {
        throw "private-keys";
      },
    },
    {
      getOwnPropertyDescriptor: () => {
        throw new Error("private-descriptor");
      },
    },
  ]) {
    rejects(new Proxy(selected(), handler));
  }
  const { proxy, revoke } = Proxy.revocable(selected(), {});
  revoke();
  rejects(proxy);
});

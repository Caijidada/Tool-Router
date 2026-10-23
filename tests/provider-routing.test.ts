import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import test from "node:test";
import { buildCatalog } from "../src/catalog.js";
import type { DecisionInput, DecisionProvider } from "../src/decision-provider.js";
import {
  routeWithProvider,
  type ProviderRouteDecision,
  type ProviderRouteOptions,
} from "../src/provider-routing.js";
import type { RouteRequest, ToolReadiness } from "../src/routing.js";

const catalog = buildCatalog([
  {
    serverId: "git",
    name: "diff",
    description: "Show repository diff",
    inputSchema: { type: "object" },
  },
  {
    serverId: "git",
    name: "commit",
    description: "Commit repository changes",
    inputSchema: { type: "object" },
  },
  {
    serverId: "web",
    name: "search",
    description: "Search public websites",
    inputSchema: { type: "object" },
  },
]);
const testOptions = { timeout: 2_000 };

function request(overrides: Partial<RouteRequest> = {}): RouteRequest {
  return {
    query: "diff",
    catalog,
    policy: { revision: "policy-1", allowedToolIds: ["git::diff", "web::search"] },
    state: {
      revision: "state-1",
      tools: { "git::diff": { kind: "ready" }, "web::search": { kind: "ready" } },
    },
    ...overrides,
  };
}

function tiedRequest(overrides: Partial<RouteRequest> = {}): RouteRequest {
  return request({
    query: "repository",
    policy: { revision: "both", allowedToolIds: ["git::diff", "git::commit"] },
    state: {
      revision: "ready",
      tools: { "git::diff": { kind: "ready" }, "git::commit": { kind: "ready" } },
    },
    ...overrides,
  });
}

function selected(confidence = 0.8, toolId = "git::diff"): unknown {
  return { kind: "selected", toolId, confidence };
}

function options(
  decide: DecisionProvider["decide"] = async () => selected(),
  overrides: Partial<ProviderRouteOptions> = {},
): ProviderRouteOptions {
  return {
    provider: { id: "fake-provider", decide },
    minConfidence: 0.8,
    timeoutMs: 1_000,
    ...overrides,
  };
}

function assertAbstained(result: ProviderRouteDecision, reason: string): void {
  assert.equal(result.kind, "abstained");
  if (result.kind === "abstained") assert.equal(result.reason, reason);
  assert.equal("toolId" in result, false);
  assert.equal("confidence" in result, false);
}

function assertDeepFrozen(value: unknown): void {
  if (value !== null && typeof value === "object") {
    assert.ok(Object.isFrozen(value));
    for (const child of Object.values(value)) assertDeepFrozen(child);
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

test(
  "selects an offered tool at the confidence threshold, including zero and one",
  testOptions,
  async () => {
    for (const confidence of [0, 0.8, 1]) {
      let calls = 0;
      const result = await routeWithProvider(
        request(),
        options(
          async (input) => {
            calls += 1;
            assert.equal(input.query, "diff");
            assert.deepEqual(input.candidates, [
              { toolId: "git::diff", name: "diff", description: "Show repository diff" },
            ]);
            return selected(confidence);
          },
          { minConfidence: confidence },
        ),
      );
      assert.equal(calls, 1);
      assert.equal(result.kind, "selected");
      if (result.kind === "selected") {
        assert.equal(result.toolId, "git::diff");
        assert.equal(result.confidence, confidence);
      }
      assert.equal(result.source, "provider");
      assert.equal(result.providerStatus, "selected");
      assert.equal(result.providerId, "fake-provider");
      assert.equal(result.advisory, true);
      assert.equal(result.catalogDigest, catalog.digest);
      assert.equal(result.policyRevision, "policy-1");
      assert.equal(result.stateRevision, "state-1");
      assert.deepEqual(result.deniedToolIds, ["git::commit"]);
      assert.deepEqual(result.providerCandidateIds, ["git::diff"]);
      assertDeepFrozen(result);
    }
  },
);

test(
  "low confidence and both provider abstentions do not use lexical fallback",
  testOptions,
  async () => {
    for (const [value, reason] of [
      [selected(0.79), "low_confidence"],
      [{ kind: "abstained", reason: "no_suitable_tool" }, "no_suitable_tool"],
      [{ kind: "abstained", reason: "uncertain" }, "uncertain"],
    ] as const) {
      const result = await routeWithProvider(
        request(),
        options(async () => value, { fallback: "lexical" }),
      );
      assertAbstained(result, reason);
      assert.equal(result.providerStatus, reason);
      assert.equal(result.source, "provider");
    }
  },
);

test(
  "invalid data and IDs outside this invocation fail closed even with fallback enabled",
  testOptions,
  async () => {
    for (const value of [
      null,
      "selected",
      {},
      selected(0.9, "git::commit"),
      selected(0.9, "web::search"),
      selected(0.9, "unknown::tool"),
      selected(Number.NaN),
      selected(1.01),
      { kind: "selected", toolId: "git::diff", confidence: "0.9" },
      { kind: "selected", toolId: "git::diff", confidence: 1, extra: "private-data" },
      { kind: "abstained", reason: "provider_error" },
    ]) {
      const result = await routeWithProvider(
        request(),
        options(async () => value, { fallback: "lexical" }),
      );
      assertAbstained(result, "invalid_provider_output");
      assert.equal(result.providerStatus, "invalid_provider_output");
      assert.equal(result.source, "provider");
    }
  },
);

test(
  "a ready catalog tool excluded by candidateLimit is not a valid provider choice",
  testOptions,
  async () => {
    const result = await routeWithProvider(
      request({ query: "repository diff search" }),
      options(async () => selected(1, "web::search"), { candidateLimit: 1 }),
    );
    assert.deepEqual(result.providerCandidateIds, ["git::diff"]);
    assertAbstained(result, "invalid_provider_output");
  },
);

test(
  "guards do not call the provider for deny-all, no match or unavailable top matches",
  testOptions,
  async () => {
    const cases: readonly [RouteRequest, string][] = [
      [request({ policy: { revision: "deny-all", allowedToolIds: [] } }), "no_allowed_tools"],
      [request({ query: "weather forecast" }), "no_match"],
      [request({ state: { revision: "unknown", tools: {} } }), "state_unknown"],
      ...(["missing", "unknown"] as const).map((kind): [RouteRequest, string] => [
        request({
          query: "repository diff search",
          state: {
            revision: "unavailable-top",
            tools: {
              "git::diff": kind === "missing" ? { kind, resources: ["repository"] } : { kind },
              "web::search": { kind: "ready" },
            },
          },
        }),
        kind === "missing" ? "needs_prerequisites" : "state_unknown",
      ]),
    ];
    let calls = 0;
    for (const [input, reason] of cases) {
      const result = await routeWithProvider(
        input,
        options(
          async () => {
            calls += 1;
            return selected();
          },
          { fallback: "lexical" },
        ),
      );
      assertAbstained(result, reason);
      assert.equal(result.providerStatus, "not_called");
      assert.equal(result.source, "guard");
      assert.deepEqual(result.providerCandidateIds, []);
    }
    assert.equal(calls, 0);
  },
);

test(
  "display limit one still offers every member of a tied candidate group",
  testOptions,
  async () => {
    const result = await routeWithProvider(
      tiedRequest({ limit: 1 }),
      options(async (input) => {
        assert.deepEqual(
          input.candidates.map((candidate) => candidate.toolId),
          ["git::commit", "git::diff"],
        );
        return selected();
      }),
    );
    assert.equal(result.kind, "selected");
    if (result.kind === "selected") assert.equal(result.toolId, "git::diff");
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0]?.toolId, "git::commit");
    assert.deepEqual(result.providerCandidateIds, ["git::commit", "git::diff"]);
  },
);

test(
  "candidate budgets refuse to cut a tie, including groups larger than the display maximum",
  testOptions,
  async () => {
    const largeCatalog = buildCatalog(
      Array.from({ length: 60 }, (_, index) => ({
        serverId: "many",
        name: `tool${index}`,
        description: "shared operation",
        inputSchema: { type: "object" },
      })),
    );
    const ids = largeCatalog.tools.map((tool) => tool.id);
    const largeRequest = request({
      query: "shared",
      catalog: largeCatalog,
      policy: { revision: "all", allowedToolIds: ids },
      state: {
        revision: "all-ready",
        tools: Object.fromEntries(ids.map((id) => [id, { kind: "ready" as const }])),
      },
    });
    let calls = 0;
    for (const [input, candidateLimit] of [
      [tiedRequest({ limit: 1 }), 1],
      [largeRequest, 32],
    ] as const) {
      const result = await routeWithProvider(
        input,
        options(
          async () => {
            calls += 1;
            return selected();
          },
          { candidateLimit, fallback: "lexical" },
        ),
      );
      assertAbstained(result, "candidate_budget_exceeded");
      assert.equal(result.source, "guard");
      assert.equal(result.providerStatus, "not_called");
      assert.deepEqual(result.providerCandidateIds, []);
    }
    assert.equal(calls, 0);
  },
);

test(
  "provider input and output are frozen snapshots despite mutation during await",
  testOptions,
  async () => {
    const policy = {
      revision: "policy-before",
      allowedToolIds: ["git::diff", "git::commit", "web::search"],
    };
    const resources = ["repository"];
    const state: { revision: string; tools: Record<string, ToolReadiness> } = {
      revision: "state-before",
      tools: {
        "git::diff": { kind: "ready" },
        "git::commit": { kind: "missing", resources },
        "web::search": { kind: "ready" },
      },
    };
    const inputRequest = { ...request({ query: "repository diff search", policy, state }) };
    const started = deferred<DecisionInput>();
    const response = deferred<unknown>();
    const provider = {
      id: "before-provider",
      decide: (input: DecisionInput) => {
        started.resolve(input);
        return response.promise;
      },
    };
    const inputOptions = { ...options(provider.decide), provider };
    const pending = routeWithProvider(inputRequest, inputOptions);
    const input = await started.promise;
    assertDeepFrozen(input);
    assert.deepEqual(
      input.candidates.map((candidate) => candidate.toolId),
      ["git::diff", "web::search"],
    );
    assert.equal(Reflect.set(input, "query", "commit"), false);
    assert.equal(Reflect.set(input.candidates[0]!, "toolId", "git::commit"), false);
    assert.throws(() => (input.candidates as unknown[]).push({}), TypeError);

    policy.revision = "policy-after";
    policy.allowedToolIds.splice(0, policy.allowedToolIds.length, "git::commit");
    state.revision = "state-after";
    state.tools["git::diff"] = { kind: "unknown" };
    resources.push("changed");
    inputRequest.query = "commit";
    inputOptions.minConfidence = 1;
    provider.id = "after-provider";
    response.resolve(selected());

    const result = await pending;
    assert.equal(result.kind, "selected");
    if (result.kind === "selected") assert.equal(result.toolId, "git::diff");
    assert.equal(result.policyRevision, "policy-before");
    assert.equal(result.stateRevision, "state-before");
    assert.equal(result.providerId, "before-provider");
    assert.deepEqual(result.deniedToolIds, []);
    assert.deepEqual(
      result.candidates.find((candidate) => candidate.toolId === "git::diff")?.readiness,
      { kind: "ready" },
    );
    assert.deepEqual(
      result.candidates.find((candidate) => candidate.toolId === "git::commit")?.readiness,
      { kind: "missing", resources: ["repository"] },
    );
    assert.equal(input.query, "repository diff search");
    assertDeepFrozen(result);
  },
);

test(
  "synchronous throws and rejected promises abstain by default without exposing errors",
  testOptions,
  async () => {
    for (const decide of [
      () => {
        throw new Error("private-provider-error");
      },
      async () => {
        throw new Error("private-provider-error");
      },
    ]) {
      const result = await routeWithProvider(request(), options(decide));
      assertAbstained(result, "provider_error");
      assert.equal(result.providerStatus, "provider_error");
      assert.equal(result.source, "provider");
      assert.equal(JSON.stringify(result).includes("private-provider-error"), false);
    }
  },
);

test("an unresponsive provider times out and receives an aborted signal", testOptions, async () => {
  let providerSignal: AbortSignal | undefined;
  const result = await routeWithProvider(
    request(),
    options(
      (_input, signal) => {
        providerSignal = signal;
        return new Promise(() => {});
      },
      { timeoutMs: 20 },
    ),
  );
  assertAbstained(result, "provider_timeout");
  assert.equal(result.providerStatus, "provider_timeout");
  assert.equal(result.source, "provider");
  assert.equal(providerSignal?.aborted, true);
});

test("a deadline reached before dispatch prevents a provider call", testOptions, async () => {
  let calls = 0;
  const pending = routeWithProvider(
    request(),
    options(
      async () => {
        calls += 1;
        return selected();
      },
      { timeoutMs: 5 },
    ),
  );
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  assertAbstained(await pending, "provider_timeout");
  assert.equal(calls, 0);
});

test(
  "the provider method is captured before dispatch and keeps its receiver",
  testOptions,
  async () => {
    const provider = {
      id: "original-provider",
      toolId: "git::diff",
      async decide() {
        return selected(0.9, this.toolId);
      },
    };
    const pending = routeWithProvider(request(), options(undefined, { provider }));
    provider.decide = async () => {
      assert.fail("replacement method must not run");
    };
    const result = await pending;
    assert.equal(result.kind, "selected");
    if (result.kind === "selected") assert.equal(result.toolId, "git::diff");
  },
);

test(
  "explicit lexical fallback preserves failure status and has no provider confidence",
  testOptions,
  async () => {
    for (const [decide, status] of [
      [
        async () => {
          throw new Error("failed");
        },
        "provider_error",
      ],
      [() => new Promise<unknown>(() => {}), "provider_timeout"],
    ] as const) {
      const result = await routeWithProvider(
        request(),
        options(decide, { fallback: "lexical", timeoutMs: 20 }),
      );
      assert.equal(result.kind, "selected");
      if (result.kind === "selected") assert.equal(result.toolId, "git::diff");
      assert.equal(result.source, "lexical-fallback");
      assert.equal(result.providerStatus, status);
      assert.equal("confidence" in result, false);
      assertDeepFrozen(result);
    }
  },
);

test(
  "lexical fallback cannot break an existing tie even with display limit one",
  testOptions,
  async () => {
    const result = await routeWithProvider(
      tiedRequest({ limit: 1 }),
      options(
        async () => {
          throw new Error("failed");
        },
        { fallback: "lexical" },
      ),
    );
    assertAbstained(result, "ambiguous");
    assert.equal(result.source, "lexical-fallback");
    assert.equal(result.providerStatus, "provider_error");
  },
);

test("pre-cancelled requests never call the provider or fall back", testOptions, async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const result = await routeWithProvider(
    request(),
    options(
      async () => {
        calls += 1;
        return selected();
      },
      { signal: controller.signal, fallback: "lexical" },
    ),
  );
  assertAbstained(result, "cancelled");
  assert.equal(result.providerStatus, "cancelled");
  assert.equal(result.source, "guard");
  assert.equal(calls, 0);
});

test(
  "cancellation before dispatch prevents a provider call and fallback",
  testOptions,
  async () => {
    const controller = new AbortController();
    let calls = 0;
    const pending = routeWithProvider(
      request(),
      options(
        async () => {
          calls += 1;
          return selected();
        },
        { signal: controller.signal, fallback: "lexical" },
      ),
    );
    controller.abort();
    assertAbstained(await pending, "cancelled");
    assert.equal(calls, 0);
  },
);

test(
  "cancellation during provider work aborts its signal and never falls back",
  testOptions,
  async () => {
    const controller = new AbortController();
    const started = deferred<AbortSignal>();
    const pending = routeWithProvider(
      request(),
      options(
        (_input, signal) => {
          started.resolve(signal);
          return new Promise(() => {});
        },
        { signal: controller.signal, fallback: "lexical" },
      ),
    );
    const providerSignal = await started.promise;
    controller.abort();
    const result = await pending;
    assertAbstained(result, "cancelled");
    assert.equal(result.providerStatus, "cancelled");
    assert.equal(result.source, "provider");
    assert.equal(providerSignal.aborted, true);
  },
);

test(
  "cancellation wins when a successful response has not yet been delivered",
  testOptions,
  async () => {
    const controller = new AbortController();
    const started = deferred<void>();
    const response = deferred<unknown>();
    const pending = routeWithProvider(
      request(),
      options(
        () => {
          started.resolve();
          return response.promise;
        },
        { signal: controller.signal, fallback: "lexical" },
      ),
    );
    await started.promise;
    response.resolve(selected());
    controller.abort();
    const result = await pending;
    assertAbstained(result, "cancelled");
    assert.equal(result.source, "provider");
  },
);

test(
  "cancellation after a delivered success does not alter the result or abort its signal",
  testOptions,
  async () => {
    const controller = new AbortController();
    let providerSignal: AbortSignal | undefined;
    const result = await routeWithProvider(
      request(),
      options(
        async (_input, signal) => {
          providerSignal = signal;
          return selected();
        },
        { signal: controller.signal },
      ),
    );
    controller.abort();
    assert.equal(result.kind, "selected");
    assert.equal(result.providerStatus, "selected");
    assert.equal(providerSignal?.aborted, false);
  },
);

test(
  "late provider rejections after cancellation or timeout are observed",
  testOptions,
  async () => {
    const unhandled: unknown[] = [];
    const listener = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", listener);
    try {
      for (const reason of ["cancelled", "provider_timeout"] as const) {
        const controller = new AbortController();
        const response = deferred<unknown>();
        const started = deferred<void>();
        const pending = routeWithProvider(
          request(),
          options(
            () => {
              started.resolve();
              return response.promise;
            },
            { signal: controller.signal, timeoutMs: 20 },
          ),
        );
        await started.promise;
        if (reason === "cancelled") controller.abort();
        assertAbstained(await pending, reason);
        response.reject(new Error("late rejection"));
        await nextTurn();
        await nextTurn();
      }
      assert.deepEqual(unhandled, []);
    } finally {
      process.removeListener("unhandledRejection", listener);
    }
  },
);

test(
  "invalid provider options and display limits reject before calling the provider",
  testOptions,
  async () => {
    let calls = 0;
    const base = options(async () => {
      calls += 1;
      return selected();
    });
    const invalid: readonly Partial<ProviderRouteOptions>[] = [
      ...[-Number.EPSILON, 1 + Number.EPSILON, NaN, Infinity].map((minConfidence) => ({
        minConfidence,
      })),
      ...[0, -1, 1.5, 60_001, NaN, Infinity].map((timeoutMs) => ({ timeoutMs })),
      ...[0, -1, 1.5, 33, NaN, Infinity].map((candidateLimit) => ({ candidateLimit })),
      { fallback: "automatic" as NonNullable<ProviderRouteOptions["fallback"]> },
      ...[
        null,
        {},
        { id: "", decide: base.provider.decide },
        { id: " ", decide: base.provider.decide },
        { id: "x".repeat(129), decide: base.provider.decide },
        { id: 1, decide: base.provider.decide },
        { id: "missing-decide" },
      ].map((provider) => ({ provider: provider as DecisionProvider })),
    ];
    for (const override of invalid) {
      await assert.rejects(routeWithProvider(request(), { ...base, ...override }), RangeError);
    }
    for (const limit of [0, -1, 1.5, 51, NaN, Infinity]) {
      await assert.rejects(routeWithProvider(request({ limit }), base), RangeError);
    }
    assert.equal(calls, 0);
  },
);

test(
  "configuration boundaries are accepted without invoking a provider behind a guard",
  testOptions,
  async () => {
    for (const [minConfidence, timeoutMs, candidateLimit, limit] of [
      [0, 1, 1, 1],
      [1, 60_000, 32, 50],
    ] as const) {
      const result = await routeWithProvider(
        request({ limit, policy: { revision: "empty", allowedToolIds: [] } }),
        options(undefined, {
          minConfidence,
          timeoutMs,
          candidateLimit,
          provider: {
            id: "x".repeat(128),
            decide: async () => {
              assert.fail("guard must prevent provider calls");
            },
          },
        }),
      );
      assertAbstained(result, "no_allowed_tools");
    }
  },
);

test(
  "cancellation during output inspection wins even when reflection throws",
  testOptions,
  async () => {
    for (const shouldThrow of [false, true]) {
      const controller = new AbortController();
      const value = new Proxy(
        { kind: "selected", toolId: "git::diff", confidence: 0.9 },
        {
          getPrototypeOf() {
            controller.abort();
            if (shouldThrow) throw new Error("private-reflection-error");
            return Object.prototype;
          },
        },
      );
      const result = await routeWithProvider(
        request(),
        options(async () => value, { signal: controller.signal, fallback: "lexical" }),
      );
      assertAbstained(result, "cancelled");
      assert.equal(result.source, "provider");
      assert.equal(result.providerStatus, "cancelled");
    }
  },
);

test(
  "a synchronous provider completing after its deadline cannot return selected",
  testOptions,
  async () => {
    const result = await routeWithProvider(
      request(),
      options(
        async () => {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
          return selected();
        },
        { timeoutMs: 5 },
      ),
    );
    assertAbstained(result, "provider_timeout");
  },
);

test(
  "a late successful response cannot change an already returned timeout",
  testOptions,
  async () => {
    const response = deferred<unknown>();
    const result = await routeWithProvider(
      request(),
      options(() => response.promise, { timeoutMs: 20 }),
    );
    assertAbstained(result, "provider_timeout");
    const snapshot = JSON.stringify(result);
    response.resolve(selected());
    await nextTurn();
    assert.equal(JSON.stringify(result), snapshot);
    assertDeepFrozen(result);
  },
);

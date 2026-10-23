import assert from "node:assert/strict";
import test from "node:test";
import { buildCatalog } from "../src/catalog.js";
import { routeTools, type RouteRequest, type RoutingState } from "../src/routing.js";

const catalog = buildCatalog([
  {
    serverId: "git",
    name: "diff",
    description: "查看仓库未提交差异 Show repository diff",
    inputSchema: { type: "object" },
  },
  {
    serverId: "git",
    name: "commit",
    description: "提交仓库改动 Commit repository changes",
    inputSchema: { type: "object" },
  },
  {
    serverId: "web",
    name: "search",
    description: "Search public websites 搜索公开网页",
    inputSchema: { type: "object" },
  },
]);

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

test("selects a unique ready match as advice with explicit snapshot versions", () => {
  const result = routeTools(request());
  assert.equal(result.kind, "selected");
  if (result.kind !== "selected") return;
  assert.equal(result.toolId, "git::diff");
  assert.equal(result.advisory, true);
  assert.equal(result.catalogDigest, catalog.digest);
  assert.equal(result.policyRevision, "policy-1");
  assert.equal(result.stateRevision, "state-1");
  assert.deepEqual(result.deniedToolIds, ["git::commit"]);
});

test("a forbidden tool cannot enter candidates even if its name is an exact match", () => {
  const result = routeTools(request({ query: "commit" }));
  assert.equal(result.kind, "abstained");
  assert.ok(result.candidates.every((candidate) => candidate.toolId !== "git::commit"));
});

test("an empty explicit allowlist denies all tools", () => {
  const result = routeTools(request({ policy: { revision: "deny-all", allowedToolIds: [] } }));
  assert.equal(result.kind, "abstained");
  if (result.kind === "abstained") assert.equal(result.reason, "no_allowed_tools");
});

test("missing resources are reported without executing or silently substituting", () => {
  const result = routeTools(
    request({
      state: {
        revision: "state-2",
        tools: { "git::diff": { kind: "missing", resources: ["repository"] } },
      },
    }),
  );
  assert.equal(result.kind, "abstained");
  if (result.kind === "abstained") assert.equal(result.reason, "needs_prerequisites");
  assert.deepEqual(result.candidates[0]?.readiness, { kind: "missing", resources: ["repository"] });
});

test("missing state and explicit unknown state fail closed", () => {
  for (const tools of [{}, { "git::diff": { kind: "unknown" as const } }]) {
    const result = routeTools(request({ state: { revision: "state-unknown", tools } }));
    assert.equal(result.kind, "abstained");
    if (result.kind === "abstained") assert.equal(result.reason, "state_unknown");
  }
});

test("a matching lower-ranked ready tool does not hide an unavailable best match", () => {
  const result = routeTools(
    request({
      query: "repository diff search",
      state: {
        revision: "state-2",
        tools: {
          "git::diff": { kind: "missing", resources: ["repository"] },
          "web::search": { kind: "ready" },
        },
      },
    }),
  );
  assert.equal(result.kind, "abstained");
  if (result.kind === "abstained") assert.equal(result.reason, "needs_prerequisites");
});

test("no overlap abstains rather than selecting the first allowed tool", () => {
  const result = routeTools(request({ query: "weather forecast" }));
  assert.equal(result.kind, "abstained");
  if (result.kind === "abstained") assert.equal(result.reason, "no_match");
});

test("a tie remains ambiguous even when the requested output limit is one", () => {
  const result = routeTools(
    request({
      query: "repository",
      limit: 1,
      policy: { revision: "both", allowedToolIds: ["git::diff", "git::commit"] },
      state: {
        revision: "ready",
        tools: { "git::diff": { kind: "ready" }, "git::commit": { kind: "ready" } },
      },
    }),
  );
  assert.equal(result.kind, "abstained");
  if (result.kind === "abstained") assert.equal(result.reason, "ambiguous");
});

test("invalid revisions, allowlist IDs and limits are configuration errors", () => {
  for (const value of [
    request({ policy: { revision: "", allowedToolIds: [] } }),
    request({ state: { revision: " ", tools: {} } }),
    request({ policy: { revision: "p", allowedToolIds: ["git::unknown"] } }),
    request({ policy: { revision: "p", allowedToolIds: ["*"] } }),
    request({ limit: 0 }),
    request({ query: "" }),
  ])
    assert.throws(() => routeTools(value), RangeError);
});

test("malformed missing state is rejected, not interpreted as ready", () => {
  assert.throws(
    () =>
      routeTools(
        request({
          state: { revision: "broken", tools: { "git::diff": { kind: "missing", resources: [] } } },
        }),
      ),
    RangeError,
  );
});

test("a recommendation detaches dependency arrays from mutable caller state", () => {
  const resources = ["repository"];
  const state: RoutingState = {
    revision: "r",
    tools: { "git::diff": { kind: "missing", resources } },
  };
  const result = routeTools(request({ state }));
  resources.push("changed");
  assert.deepEqual(result.candidates[0]?.readiness, { kind: "missing", resources: ["repository"] });
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.candidates));
});

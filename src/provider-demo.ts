import { buildCatalog } from "./catalog.js";
import type { DecisionProvider } from "./decision-provider.js";
import { routeWithProvider } from "./provider-routing.js";

/** Entirely synthetic providers: no network traffic, credentials or tool execution. */
export async function runProviderDemo() {
  const catalog = buildCatalog(
    ["diff", "status", "commit"].map((name) => ({
      serverId: "git",
      name,
      description: `Repository ${name}`,
      inputSchema: { type: "object" },
    })),
  );
  const request = {
    query: "repository",
    catalog,
    policy: { revision: "demo-readonly-v1", allowedToolIds: ["git::diff", "git::status"] },
    state: {
      revision: "demo-ready-v1",
      tools: { "git::diff": { kind: "ready" as const }, "git::status": { kind: "ready" as const } },
    },
  };
  const settings = { minConfidence: 0.8, timeoutMs: 1_000 };
  const fixed = (toolId: string): DecisionProvider => ({
    id: "fixture-fixed",
    decide: async () => ({ kind: "selected", toolId, confidence: 0.9 }),
  });
  const cancelled = new AbortController();
  cancelled.abort();
  return {
    mode: "offline-provider-fixtures",
    executesTools: false,
    makesModelRequests: false,
    cases: [
      {
        name: "模拟评分器在并列候选中选择",
        result: await routeWithProvider(request, { ...settings, provider: fixed("git::diff") }),
      },
      {
        name: "拒绝评分器返回不在候选中的工具",
        result: await routeWithProvider(request, { ...settings, provider: fixed("git::commit") }),
      },
      {
        name: "评分器失败时显式回退，不伪造模型置信度",
        result: await routeWithProvider(
          { ...request, query: "diff" },
          {
            ...settings,
            fallback: "lexical",
            provider: {
              id: "fixture-error",
              decide: async () => {
                throw new Error("Synthetic unavailable provider");
              },
            },
          },
        ),
      },
      {
        name: "不响应取消信号的评分器也会结束路由等待",
        result: await routeWithProvider(request, {
          ...settings,
          timeoutMs: 10,
          provider: { id: "fixture-never-resolves", decide: () => new Promise(() => {}) },
        }),
      },
      {
        name: "取消请求不再选择或回退",
        result: await routeWithProvider(request, {
          ...settings,
          provider: fixed("git::diff"),
          signal: cancelled.signal,
          fallback: "lexical",
        }),
      },
    ],
  };
}

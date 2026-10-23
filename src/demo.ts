import { buildCatalog } from "./catalog.js";
import { routeTools } from "./routing.js";

/** Synthetic metadata only: this demo does not access Git, a filesystem, or the web. */
export function runOfflineDemo() {
  const catalog = buildCatalog([
    {
      serverId: "git",
      name: "diff",
      description: "查看 Git 仓库未提交的差异 Show repository diff",
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
      description: "搜索网页 Search public websites",
      inputSchema: { type: "object" },
    },
  ]);
  const policy = { revision: "demo-readonly-v1", allowedToolIds: ["git::diff", "web::search"] };
  const readyState = {
    revision: "demo-state-v1",
    tools: { "git::diff": { kind: "ready" as const }, "web::search": { kind: "ready" as const } },
  };
  return {
    mode: "offline-synthetic-fixture",
    executesTools: false,
    makesModelRequests: false,
    cases: [
      {
        name: "推荐查看差异",
        result: routeTools({
          query: "查看 Git 仓库未提交的差异",
          catalog,
          policy,
          state: readyState,
        }),
      },
      {
        name: "拒绝推荐不在白名单的提交工具",
        result: routeTools({ query: "commit", catalog, policy, state: readyState }),
      },
      {
        name: "缺少仓库时要求前置条件",
        result: routeTools({
          query: "diff",
          catalog,
          policy,
          state: {
            revision: "demo-state-v2",
            tools: { "git::diff": { kind: "missing", resources: ["repository"] } },
          },
        }),
      },
      {
        name: "没有适合工具时拒选",
        result: routeTools({
          query: "天气预报 weather forecast",
          catalog,
          policy,
          state: readyState,
        }),
      },
    ],
  };
}

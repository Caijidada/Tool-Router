import assert from "node:assert/strict";
import test from "node:test";
import { buildCatalog } from "../src/catalog.js";
import { retrieveCandidates } from "../src/retrieval.js";

function catalog(entries: readonly [name: string, description: string][]) {
  return buildCatalog(
    entries.map(([name, description]) => ({
      serverId: "fixture",
      name,
      description,
      inputSchema: { type: "object", properties: { secretCanary: { type: "string" } } },
    })),
  ).tools;
}

test("matches English case, camel names and underscores with explicit ranking weights", () => {
  const tools = catalog([
    ["getRepositoryDiff", "Read local changes"],
    ["read_file", "Read a repository document"],
    ["search_web", "Search public websites"],
  ]);
  const candidates = retrieveCandidates(tools, "REPOSITORY diff");
  assert.deepEqual(
    candidates.map(({ tool, lexicalScore }) => [tool.name, lexicalScore]),
    [
      ["getRepositoryDiff", 4],
      ["read_file", 1],
    ],
  );
  assert.equal(retrieveCandidates(tools, "read file")[0]?.tool.name, "read_file");
  assert.equal(retrieveCandidates(tools, "diff diff")[0]?.lexicalScore, 2);
});

test("matches Chinese descriptions and mixed Chinese/English queries", () => {
  const tools = catalog([
    ["git_diff", "查看 Git 仓库中的未提交差异"],
    ["search_web", "搜索网页和公开资料"],
  ]);
  assert.equal(retrieveCandidates(tools, "仓库差异")[0]?.tool.name, "git_diff");
  assert.equal(retrieveCandidates(tools, "Git 仓库差异")[0]?.tool.name, "git_diff");
});

test("abstains on no lexical overlap and does not search schemas or server IDs", () => {
  const tools = catalog([["git_diff", "Read repository changes"]]);
  for (const query of ["weather forecast", "secretCanary", "fixture", "!!!"]) {
    assert.deepEqual(retrieveCandidates(tools, query), []);
  }
  assert.deepEqual(retrieveCandidates([], "repository"), []);
});

test("ties use stable tool IDs, honor limit and leave input order unchanged", () => {
  const tools = catalog([
    ["z_reader", "Inspect files"],
    ["a_reader", "Inspect files"],
  ]);
  const reversed = [...tools].reverse();
  const before = [...reversed];
  const expected = ["fixture::a_reader", "fixture::z_reader"];
  for (const input of [tools, reversed]) {
    assert.deepEqual(
      retrieveCandidates(input, "files").map(({ tool }) => tool.id),
      expected,
    );
    assert.equal(retrieveCandidates(input, "files", 1)[0]?.tool.id, expected[0]);
  }
  assert.deepEqual(reversed, before);
  const result = retrieveCandidates(tools, "files");
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result[0]));
});

test("rejects blank or oversized queries and accepts the exact size boundary", () => {
  const tools = catalog([["reader", "Read files"]]);
  for (const query of ["", " \n\t", "x".repeat(4_001)]) {
    assert.throws(() => retrieveCandidates(tools, query), RangeError);
  }
  assert.doesNotThrow(() => retrieveCandidates(tools, "x".repeat(4_000)));
});

test("requires an integer candidate limit from 1 through 50", () => {
  for (const limit of [0, -1, 51, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => retrieveCandidates([], "query", limit), RangeError);
  }
  assert.doesNotThrow(() => retrieveCandidates([], "query", 1));
  assert.doesNotThrow(() => retrieveCandidates([], "query", 50));
});

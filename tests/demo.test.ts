import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runOfflineDemo } from "../src/demo.js";

test("offline fixture demonstrates selection, policy filtering, prerequisites and no match", () => {
  const output = runOfflineDemo();
  assert.equal(output.executesTools, false);
  assert.equal(output.makesModelRequests, false);
  assert.deepEqual(
    output.cases.map(({ result }) => result.kind),
    ["selected", "abstained", "abstained", "abstained"],
  );
  assert.deepEqual(
    output.cases.map(({ result }) => (result.kind === "abstained" ? result.reason : result.toolId)),
    ["git::diff", "no_match", "needs_prerequisites", "no_match"],
  );
});

test("compiled CLI runs from another directory and returns valid deterministic fixture JSON", () => {
  const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const actual: unknown = JSON.parse(
    execFileSync(process.execPath, [cliPath], {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      encoding: "utf8",
      timeout: 5_000,
    }),
  );
  assert.deepEqual(actual, runOfflineDemo());
});

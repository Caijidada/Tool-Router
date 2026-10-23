import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runProviderDemo } from "../src/provider-demo.js";

test("offline provider demo shows selection, validation, fallback, timeout and cancellation", async () => {
  const output = await runProviderDemo();
  assert.equal(output.executesTools, false);
  assert.equal(output.makesModelRequests, false);
  assert.deepEqual(
    output.cases.map(({ result }) => result.providerStatus),
    ["selected", "invalid_provider_output", "provider_error", "provider_timeout", "cancelled"],
  );
  assert.equal(output.cases[2]?.result.source, "lexical-fallback");
  assert.equal("confidence" in (output.cases[2]?.result ?? {}), false);
});

test("provider CLI works outside the repository without credentials", async () => {
  const cliPath = fileURLToPath(new URL("../src/provider-cli.js", import.meta.url));
  const actual: unknown = JSON.parse(
    execFileSync(process.execPath, [cliPath], {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      encoding: "utf8",
      timeout: 5_000,
    }),
  );
  assert.deepEqual(actual, await runProviderDemo());
});

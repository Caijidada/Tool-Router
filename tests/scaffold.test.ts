import assert from "node:assert/strict";
import test from "node:test";
import { projectStatus } from "../src/index.js";

test("the initial scaffold neither executes tools nor makes paid model requests", () => {
  assert.equal(projectStatus.executesTools, false);
  assert.equal(projectStatus.makesModelRequests, false);
  assert.equal(Object.isFrozen(projectStatus), true);
});

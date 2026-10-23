import assert from "node:assert/strict";
import test from "node:test";
import { buildCatalog, CatalogError } from "../src/catalog.js";

function tool(name = "diff", serverId = "git") {
  return {
    serverId,
    name,
    description: "Show working tree changes 查看工作区差异",
    inputSchema: { type: "object", properties: { path: { type: "string" } } },
  };
}

test("catalog identities include their server namespace and have stable order", () => {
  const a = buildCatalog([tool("diff", "b"), tool("diff", "a")]);
  const b = buildCatalog([tool("diff", "a"), tool("diff", "b")]);
  assert.equal(a.digest, b.digest);
  assert.deepEqual(
    a.tools.map((item) => item.id),
    ["a::diff", "b::diff"],
  );
  assert.match(a.digest, /^[a-f0-9]{64}$/);
});

test("object key order does not affect the digest", () => {
  const a = tool();
  const b = {
    inputSchema: { properties: { path: { type: "string" } }, type: "object" },
    description: a.description,
    name: a.name,
    serverId: a.serverId,
  };
  assert.equal(buildCatalog([a]).digest, buildCatalog([b]).digest);
});

test("descriptions and semantically ordered arrays affect the digest", () => {
  const base = tool();
  assert.notEqual(
    buildCatalog([base]).digest,
    buildCatalog([{ ...base, description: "Changed" }]).digest,
  );
  const withEnum = (values: string[]) => ({
    ...base,
    inputSchema: { type: "object", properties: { mode: { enum: values } } },
  });
  assert.notEqual(
    buildCatalog([withEnum(["a", "b"])]).digest,
    buildCatalog([withEnum(["b", "a"])]).digest,
  );
});

test("catalog is a deeply frozen detached snapshot", () => {
  const original = tool();
  const catalog = buildCatalog([original]);
  const serialized = JSON.stringify(catalog);
  original.description = "Mutated after ingestion";
  original.inputSchema.properties.path.type = "number";
  assert.equal(JSON.stringify(catalog), serialized);
  assert.equal(Object.isFrozen(catalog), true);
  assert.equal(Object.isFrozen(catalog.tools), true);
  assert.equal(Object.isFrozen(catalog.tools[0]?.inputSchema["properties"]), true);
});

test("duplicate tool identities and unexpected metadata are rejected", () => {
  assert.throws(() => buildCatalog([tool(), tool()]), CatalogError);
  assert.throws(() => buildCatalog([{ ...tool(), readOnlyHint: true }]), CatalogError);
});

test("invalid identifiers, descriptions and schema roots are rejected", () => {
  for (const candidate of [
    { ...tool(), serverId: "a::b" },
    { ...tool(), name: "" },
    { ...tool(), description: " " },
    { ...tool(), inputSchema: true },
    { ...tool(), inputSchema: { type: "array" } },
  ])
    assert.throws(() => buildCatalog([candidate]), CatalogError);
});

test("non-JSON and potentially side-effecting values are rejected", () => {
  for (const invalid of [undefined, NaN, Infinity, 1n, () => 1, new Date(), Symbol("x")]) {
    assert.throws(
      () => buildCatalog([{ ...tool(), inputSchema: { type: "object", invalid } }]),
      CatalogError,
    );
  }
  let invoked = false;
  const accessor = {
    ...tool(),
    get description() {
      invoked = true;
      return "hidden";
    },
  };
  assert.throws(() => buildCatalog([accessor]), CatalogError);
  assert.equal(invoked, false);
});

test("circular and sparse data are rejected without stack overflow", () => {
  const cycle: Record<string, unknown> = { type: "object" };
  cycle["self"] = cycle;
  assert.throws(() => buildCatalog([{ ...tool(), inputSchema: cycle }]), CatalogError);
  assert.throws(
    () => buildCatalog([{ ...tool(), inputSchema: { type: "object", values: new Array(2) } }]),
    CatalogError,
  );
});

test("__proto__ stays data rather than mutating object prototypes", () => {
  const inputSchema = JSON.parse(
    '{"type":"object","properties":{"__proto__":{"type":"string"}}}',
  ) as unknown;
  const catalog = buildCatalog([{ ...tool(), inputSchema }]);
  assert.match(JSON.stringify(catalog), /__proto__/);
  assert.equal(({} as Record<string, unknown>)["polluted"], undefined);
});

test("empty catalogs are valid, bounded and deterministic", () => {
  assert.deepEqual(buildCatalog([]).tools, []);
  assert.equal(buildCatalog([]).digest, buildCatalog([]).digest);
  assert.throws(() => buildCatalog(new Array(1_001).fill(tool())), CatalogError);
  assert.throws(() => buildCatalog([{ ...tool(), description: "x".repeat(8_001) }]), CatalogError);
});

test("root array accessors and custom iterators are rejected without invocation", () => {
  let invoked = false;
  const accessor: unknown[] = [];
  Object.defineProperty(accessor, "0", {
    enumerable: true,
    get() {
      invoked = true;
      return tool();
    },
  });
  assert.throws(() => buildCatalog(accessor), CatalogError);
  assert.equal(invoked, false);
  const customIterator = [tool()];
  Object.defineProperty(customIterator, Symbol.iterator, {
    value: function* () {
      invoked = true;
      yield tool();
    },
  });
  assert.throws(() => buildCatalog(customIterator), CatalogError);
  assert.equal(invoked, false);
});

test("non-enumerable length is only supported on arrays", () => {
  const inputSchema = { type: "object" };
  Object.defineProperty(inputSchema, "length", { value: 42 });
  assert.throws(() => buildCatalog([{ ...tool(), inputSchema }]), CatalogError);
});

test("deep or oversized metadata is rejected during bounded traversal", () => {
  let nested: unknown = "leaf";
  for (let index = 0; index < 40; index += 1) nested = { nested };
  assert.throws(
    () => buildCatalog([{ ...tool(), inputSchema: { type: "object", nested } }]),
    CatalogError,
  );
  const large = Object.fromEntries(
    Array.from({ length: 100 }, (_, i) => [String(i), "x".repeat(32_768)]),
  );
  assert.throws(
    () => buildCatalog([{ ...tool(), inputSchema: { type: "object", large } }]),
    CatalogError,
  );
});

import { createHash } from "node:crypto";

export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue;
}

export interface CatalogTool {
  readonly id: string;
  readonly serverId: string;
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<JsonObject>;
}

export interface CatalogSnapshot {
  readonly digest: string;
  readonly tools: readonly CatalogTool[];
}

export class CatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogError";
  }
}

const MAX_TOOLS = 1_000;
const MAX_DEPTH = 32;
const MAX_NODES_PER_TOOL = 10_000;
const MAX_CATALOG_BYTES = 2 * 1024 * 1024;
const COMPONENT = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

function charge(value: string, budget: { bytes: number }): void {
  budget.bytes += Buffer.byteLength(value, "utf8");
  if (budget.bytes > MAX_CATALOG_BYTES)
    throw new CatalogError("Metadata traversal exceeds 2 MiB limit");
}

function isObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Copy JSON data without invoking getters, following cycles, or retaining caller ownership. */
function copyJson(
  input: unknown,
  ancestors = new Set<object>(),
  depth = 0,
  count = { nodes: 0 },
  budget = { bytes: 0 },
): JsonValue {
  count.nodes += 1;
  if (depth > MAX_DEPTH || count.nodes > MAX_NODES_PER_TOOL) {
    throw new CatalogError("Tool metadata exceeds structural limits");
  }
  if (
    input === null ||
    typeof input === "boolean" ||
    (typeof input === "number" && Number.isFinite(input)) ||
    (typeof input === "string" && input.length <= 32_768)
  ) {
    charge(JSON.stringify(input), budget);
    return input;
  }
  if (typeof input !== "object" || input === null) {
    throw new CatalogError("Tool metadata must contain only finite, bounded JSON values");
  }
  if (ancestors.has(input)) throw new CatalogError("Tool metadata cannot contain cycles");
  const prototype = Object.getPrototypeOf(input) as unknown;
  if (!Array.isArray(input) && prototype !== Object.prototype && prototype !== null) {
    throw new CatalogError("Tool metadata must use plain JSON objects");
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (typeof key !== "string" || !descriptor || !("value" in descriptor)) {
      throw new CatalogError("Symbol keys and accessors are not JSON data");
    }
    if (
      key.length > 1_024 ||
      (!descriptor.enumerable && !(Array.isArray(input) && key === "length"))
    ) {
      throw new CatalogError("Unsupported metadata property");
    }
  }
  ancestors.add(input);
  try {
    if (Array.isArray(input)) {
      if (input.length > MAX_NODES_PER_TOOL) throw new CatalogError("Metadata array too large");
      if (Object.keys(descriptors).length !== input.length + 1) {
        throw new CatalogError("Sparse arrays and custom array properties are unsupported");
      }
      const result: JsonValue[] = [];
      for (let i = 0; i < input.length; i += 1) {
        const item = descriptors[String(i)];
        if (!item || !("value" in item)) throw new CatalogError("Sparse metadata array");
        result.push(copyJson(item.value, ancestors, depth + 1, count, budget));
      }
      return result;
    }
    const result = Object.create(null) as JsonObject;
    for (const key of Object.keys(descriptors).sort()) {
      const descriptor = descriptors[key];
      if (!descriptor) throw new CatalogError("Invalid metadata descriptor");
      charge(JSON.stringify(key), budget);
      result[key] = copyJson(descriptor.value, ancestors, depth + 1, count, budget);
    }
    return result;
  } finally {
    ancestors.delete(input);
  }
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function requiredString(record: JsonObject, key: string, max: number): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
    throw new CatalogError(`Invalid ${key}`);
  }
  return value;
}

/** Only these fields are supported; adapters must explicitly project upstream metadata. */
export function buildCatalog(input: unknown): CatalogSnapshot {
  if (!Array.isArray(input) || input.length > MAX_TOOLS) {
    throw new CatalogError(`Catalog must be an array of at most ${MAX_TOOLS} tools`);
  }
  const ids = new Set<string>();
  const budget = { bytes: 0 };
  let totalBytes = 0;
  const tools: CatalogTool[] = [];
  const rootDescriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(rootDescriptors).length !== input.length + 1) {
    throw new CatalogError("Catalog arrays cannot be sparse or have extra properties");
  }
  for (let index = 0; index < input.length; index += 1) {
    const item = rootDescriptors[String(index)];
    if (!item || !("value" in item) || !item.enumerable) {
      throw new CatalogError("Catalog entries must be own enumerable data properties");
    }
    const value = copyJson(item.value, new Set(), 0, { nodes: 0 }, budget);
    if (!isObject(value)) throw new CatalogError("Each tool must be an object");
    const allowed = new Set(["serverId", "name", "description", "inputSchema"]);
    if (Object.keys(value).some((key) => !allowed.has(key))) {
      throw new CatalogError("Unsupported tool field; project it explicitly in the adapter");
    }
    const serverId = requiredString(value, "serverId", 128);
    const name = requiredString(value, "name", 128);
    const description = requiredString(value, "description", 8_000);
    if (!COMPONENT.test(serverId) || !COMPONENT.test(name)) {
      throw new CatalogError("Tool identity contains unsupported characters");
    }
    const id = `${serverId}::${name}`;
    if (ids.has(id)) throw new CatalogError(`Duplicate tool identity: ${id}`);
    ids.add(id);
    const inputSchema = value["inputSchema"];
    if (inputSchema === undefined || !isObject(inputSchema) || inputSchema["type"] !== "object") {
      throw new CatalogError("inputSchema must be a JSON object with type: object");
    }
    const tool = { id, serverId, name, description, inputSchema };
    totalBytes += Buffer.byteLength(JSON.stringify(tool), "utf8");
    if (totalBytes > MAX_CATALOG_BYTES) throw new CatalogError("Catalog exceeds 2 MiB limit");
    tools.push(tool);
  }
  tools.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const digest = createHash("sha256").update(JSON.stringify(tools)).digest("hex");
  return freezeDeep({ digest, tools });
}

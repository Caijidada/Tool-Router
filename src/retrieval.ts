import type { CatalogTool } from "./catalog.js";

export interface Candidate {
  readonly tool: CatalogTool;
  /** Weighted token overlap for ranking only; not a probability or confidence. */
  readonly lexicalScore: number;
}

const segmenter = new Intl.Segmenter("zh", { granularity: "word" });
const MAX_QUERY_LENGTH = 4_000;

function tokens(text: string): ReadonlySet<string> {
  const normalized = text
    .normalize("NFKC")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
  return new Set(
    Array.from(segmenter.segment(normalized))
      .filter((part) => part.isWordLike)
      .map((part) => part.segment),
  );
}

/**
 * Exact word overlap: a name match contributes 2 and a description match 1.
 * Supports simple Chinese/English text and common tool-name separators.
 * This is not BM25, stemming, translation or semantic search. Word boundaries
 * depend on the runtime's ICU data; pin the Node runtime for reproducible evals.
 * Only name/description are searched, never server IDs or full schemas.
 */
export function retrieveCandidates(
  tools: readonly CatalogTool[],
  query: string,
  limit = 8,
): readonly Candidate[] {
  if (typeof query !== "string" || query.trim().length === 0 || query.length > MAX_QUERY_LENGTH) {
    throw new RangeError("Query must be nonblank and at most 4000 UTF-16 code units");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new RangeError("Candidate limit must be an integer from 1 to 50");
  }
  const queryTokens = tokens(query);
  const candidates: Candidate[] = [];
  for (const tool of tools) {
    const nameTokens = tokens(tool.name);
    const descriptionTokens = tokens(tool.description);
    let lexicalScore = 0;
    for (const token of queryTokens) {
      if (nameTokens.has(token)) lexicalScore += 2;
      if (descriptionTokens.has(token)) lexicalScore += 1;
    }
    if (lexicalScore > 0) {
      candidates.push(Object.freeze({ tool, lexicalScore }));
    }
  }
  candidates.sort(
    (left, right) =>
      right.lexicalScore - left.lexicalScore ||
      (left.tool.id < right.tool.id ? -1 : left.tool.id > right.tool.id ? 1 : 0),
  );
  return Object.freeze(candidates.slice(0, limit));
}

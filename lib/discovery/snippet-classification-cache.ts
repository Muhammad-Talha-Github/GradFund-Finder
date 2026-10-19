export type SnippetClassificationDecision = "ACCEPTED" | "REJECTED";

const cachePrefix = "TAVILY_SNIPPET_GEMINI_CACHE:";

export function createSnippetClassificationCacheMarker(decision: SnippetClassificationDecision, snippetHash: string, fetchError: string): string {
  return `${cachePrefix}${decision}:${snippetHash}\nPage fetch failure: ${fetchError.slice(0, 500)}`;
}

export function hasSnippetClassificationCache(marker: string | null | undefined, snippetHash: string): boolean {
  return ["ACCEPTED", "REJECTED"].some((decision) => marker?.startsWith(`${cachePrefix}${decision}:${snippetHash}`));
}

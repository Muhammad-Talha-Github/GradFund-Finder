import type { RawSearchResult, WebSearchProvider } from "./types";

type TavilyResponse = {
  results?: Array<{ title?: unknown; url?: unknown; content?: unknown }>;
  detail?: { error?: string };
};

export class TavilySearchProvider implements WebSearchProvider {
  constructor(private readonly apiKey: string) {}

  async search(query: string, domains: string[], maxResults = 15): Promise<RawSearchResult[]> {
    const retries = Math.max(0, Math.min(2, Math.trunc(Number(process.env.TAVILY_RETRIES) || 0)));
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { Authorization: "Bearer " + this.apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            query,
            search_depth: "basic",
            max_results: Math.max(1, Math.min(20, Math.trunc(maxResults))),
            include_answer: false,
            include_raw_content: false,
            include_domains: domains,
            ...(domains.length ? { include_domains_mode: "prefer" } : {}),
          }),
          signal: AbortSignal.timeout(20_000),
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => ({}))) as TavilyResponse;
        if (!response.ok) {
          const quota = response.status === 429 || response.status === 432;
          const message = response.status === 401
            ? "The web search provider rejected its API key. Check TAVILY_API_KEY."
            : quota
              ? "The web search provider limit was reached. Check your Tavily credits and try again later."
              : payload.detail?.error || "The web search provider could not complete the search.";
          // Quota and credential errors are final; retries would waste requests.
          if (!quota && response.status >= 500 && attempt < retries) {
            await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
            continue;
          }
          throw new Error(message);
        }

        return (payload.results ?? []).flatMap((result) => {
          if (typeof result.url !== "string" || typeof result.title !== "string") return [];
          try {
            const url = new URL(result.url);
            if (url.protocol !== "http:" && url.protocol !== "https:") return [];
            return [{ title: result.title, url: url.toString(), content: typeof result.content === "string" ? result.content : "" }];
          } catch { return []; }
        });
      } catch (error) {
        if (error instanceof Error && /provider rejected|limit was reached|HTTP|could not complete/.test(error.message)) throw error;
        if (attempt >= retries) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
    return [];
  }
}

export function getWebSearchProvider(): WebSearchProvider {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error("Web search is not configured. Add TAVILY_API_KEY to .env.local and restart the app.");
  }
  return new TavilySearchProvider(apiKey);
}

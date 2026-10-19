import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { Dataset, PlaywrightCrawler, createPlaywrightRouter } from "@crawlee/playwright";
import { extractReadableText, fetchPublicResource, validatePublicPageUrl } from "@/lib/fetching/safe-page-fetch";
import { getWebSearchProvider } from "@/lib/search/tavily-provider";

export const intentSignalPatterns = [
  /\b(?:hiring|openings?|vacanc(?:y|ies)|positions? available|funding available)\b/gi,
  /\b(?:seeking|recruiting|recruitment|accepting applications)\b[^.!?]{0,70}\b(?:ph\.?d|doctoral|graduate|master'?s?|students?|researchers?)\b/gi,
  /\b(?:ph\.?d|doctoral|graduate|master'?s?|students?|researchers?)\b[^.!?]{0,70}\b(?:sought|welcome|join|funded|funding|opening|position|apply)\b/gi,
];

export function decodeEncodedSearchQuery(value: string): string {
  const decoded = decodeURIComponent(value.replace(/\+/g, "%20")).trim();
  if (!decoded || decoded.length > 500) throw new Error("Provide a search query between 1 and 500 characters.");
  return decoded;
}

export function extractIntentSignals(text: string): string[] {
  const matches: string[] = [];
  for (const pattern of intentSignalPatterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) matches.push(match[0].replace(/\s+/g, " ").trim());
  }
  return [...new Set(matches.map((value) => value.toLowerCase()))].slice(0, 12);
}

export function extractRelevantIntentSignals(text: string, title = ""): string[] {
  const normalized = text.toLowerCase();
  const titleSuggestsUndergraduatePage = /\b(?:undergraduate|bachelor'?s?|bsc|b\.s\.|bs\s*[|:-])\b/i.test(title);
  return extractIntentSignals(text).filter((signal) => {
    const index = normalized.indexOf(signal);
    const left = Math.max(normalized.lastIndexOf(".", index), normalized.lastIndexOf("!", index), normalized.lastIndexOf("?", index)) + 1;
    const nextStops = [".", "!", "?"].map((stop) => normalized.indexOf(stop, index)).filter((position) => position >= 0);
    const right = nextStops.length ? Math.min(...nextStops) : normalized.length;
    const sentence = normalized.slice(left, right);
    const mentionsUndergraduate = /\b(?:undergrad(?:uate)?s?|bachelor'?s?|bsc|b\.s\.|bs students?)\b/i.test(sentence) || titleSuggestsUndergraduatePage;
    const explicitlyTargetsGraduate = /\b(?:ph\.?d|doctoral|graduate students?|master'?s?|msc|m\.?s\.?)\b/i.test(sentence);
    return !mentionsUndergraduate || explicitlyTargetsGraduate;
  });
}

export function extractContactEmails(...values: string[]): string[] {
  const found = values.flatMap((value) => value.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? []);
  return [...new Set(found.map((email) => email.toLowerCase()))].sort();
}

type ScoutUserData = {
  label: "GOOGLE_SERP" | "PROFESSOR_PAGE";
  query?: string;
  targetUrl?: string;
  searchTitle?: string;
  searchSnippet?: string;
};

function syntheticUrl(entryOrigin: string, label: ScoutUserData["label"], id: string) {
  return `${entryOrigin}/${label.toLowerCase()}/${encodeURIComponent(id)}`;
}

function sanitizedHtml(html: string) {
  return html.replace(/<(script|style|iframe|object|embed|noscript|svg)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, "")
    .replace(/<(?:link|base|img|source|video|audio|track)\b[^>]*\/?\s*>/gi, "")
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh[^>]*>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .slice(0, 1_500_000);
}

function browserSafeHtml(html: string) {
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; connect-src 'none'; img-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none">`;
  return /<head\b[^>]*>/i.test(html) ? html.replace(/<head\b[^>]*>/i, (head) => head + policy) : policy + html;
}

export async function runRecruitmentScout(encodedQueries: string[], limits = {}) {
  const queries = encodedQueries.map(decodeEncodedSearchQuery);
  if (!queries.length) throw new Error("Pass at least one --query=<encoded search query> argument.");
  const maxResults = Math.max(1, Math.min(10, Number(process.env.SCOUT_MAX_RESULTS) || 5));
  const maxPages = Math.max(1, Math.min(50, Number(process.env.SCOUT_MAX_PAGES) || 20));
  const maxConcurrency = Math.max(1, Math.min(3, Number(process.env.SCOUT_MAX_CONCURRENCY) || 2));
  const search = getWebSearchProvider();
  const datasetName = `recruitment-scout-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const dataset = await Dataset.open(datasetName);
  const entryServer = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end("<!doctype html><title>GradFund Scout</title><body>Offline crawler entry</body>");
  });
  await new Promise<void>((resolve, reject) => {
    entryServer.once("error", reject);
    entryServer.listen(0, "127.0.0.1", resolve);
  });
  const address = entryServer.address();
  if (!address || typeof address === "string") throw new Error("Could not open the scout's local entry listener.");
  const entryOrigin = `http://127.0.0.1:${address.port}`;
  const statistics = { queries: queries.length, urlsDiscovered: 0, pagesFetched: 0, leadsSaved: 0, skippedNoIntent: 0, failed: 0 };
  const discoveredUrls = new Set<string>();
  const router = createPlaywrightRouter();

  router.addHandler("GOOGLE_SERP", async ({ request, addRequests }) => {
    const data = request.userData as ScoutUserData;
    const results = await search.search(data.query!, [], maxResults);
    const requests = [];
    for (const result of results) {
      let target: URL;
      try { target = validatePublicPageUrl(result.url); } catch { continue; }
      if (!/^https?:$/.test(target.protocol)) continue;
      const canonicalUrl = target.toString();
      if (discoveredUrls.has(canonicalUrl) || discoveredUrls.size >= maxPages) continue;
      discoveredUrls.add(canonicalUrl);
      requests.push({
        url: syntheticUrl(entryOrigin, "PROFESSOR_PAGE", canonicalUrl),
        uniqueKey: `professor:${canonicalUrl}`,
        userData: { label: "PROFESSOR_PAGE", targetUrl: canonicalUrl, searchTitle: result.title, searchSnippet: result.content, query: data.query } satisfies ScoutUserData,
      });
    }
    statistics.urlsDiscovered += requests.length;
    if (requests.length) await addRequests(requests);
  });

  router.addHandler("PROFESSOR_PAGE", async ({ page, request }) => {
    const data = request.userData as ScoutUserData;
    const targetUrl = validatePublicPageUrl(data.targetUrl!).toString();
    // Use the project's DNS-pinned fetcher for redirects, robots, IP validation,
    // timeouts and response caps. Playwright parses the sanitized HTML offline.
    const response = await fetchPublicResource(targetUrl, /text\/html|application\/xhtml\+xml/i);
    await page.setContent(browserSafeHtml(sanitizedHtml(response.body.toString("utf8"))), { waitUntil: "domcontentloaded", timeout: 10_000 });
    const pageText = (await page.locator("body").innerText({ timeout: 5_000 })).slice(0, 40_000);
    const pageTitle = (await page.title()).trim().slice(0, 500);
    const signals = extractRelevantIntentSignals(pageText, pageTitle);
    statistics.pagesFetched += 1;
    if (!signals.length) {
      statistics.skippedNoIntent += 1;
      return;
    }
    const metadata = await page.locator("a[href^='mailto:']").evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
    const emails = extractContactEmails(pageText, ...metadata.map((href) => href.replace(/^mailto:/i, "")));
    const excerpt = pageText.match(/.{0,130}(?:hiring|openings?|vacanc(?:y|ies)|funding available|seeking|recruiting|accepting applications).{0,180}/i)?.[0]?.replace(/\s+/g, " ").trim() ?? "";
    await dataset.pushData({
      title: pageTitle || data.searchTitle || "Untitled page",
      sourceUrl: targetUrl,
      finalUrl: response.finalUrl,
      searchQuery: data.query ?? null,
      searchTitle: data.searchTitle ?? null,
      searchSnippet: data.searchSnippet ?? null,
      intentSignals: signals,
      evidenceExcerpt: excerpt,
      contactEmails: emails,
      classification: "POTENTIAL_RESEARCH_LEAD",
      verificationStatus: "UNVERIFIED",
      collectedAt: new Date().toISOString(),
    });
    statistics.leadsSaved += 1;
  });

  const crawler = new PlaywrightCrawler({
    requestHandler: router,
    maxRequestsPerCrawl: Math.min(maxPages + Math.min(queries.length, maxPages), 60),
    maxRequestRetries: 1,
    maxConcurrency,
    navigationTimeoutSecs: 15,
    requestHandlerTimeoutSecs: 30,
    launchContext: { launchOptions: { headless: true } },
    failedRequestHandler: async ({ request }, error) => {
      statistics.failed += 1;
      console.error(`[scout] ${request.userData.label} failed:`, error);
    },
  });

  const entries = queries.map((query, index) => ({
    url: syntheticUrl(entryOrigin, "GOOGLE_SERP", `${index}-${query}`),
    uniqueKey: `search:${index}:${query}`,
    userData: { label: "GOOGLE_SERP", query } satisfies ScoutUserData,
  }));
  try {
    await crawler.run(entries.slice(0, Math.min(queries.length, maxPages)));
  } finally {
    await crawler.teardown();
    await new Promise<void>((resolve) => entryServer.close(() => resolve()));
  }
  return { datasetId: dataset.id, datasetName, statistics };
}

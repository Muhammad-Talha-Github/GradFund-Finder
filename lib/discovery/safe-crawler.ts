import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { CheerioCrawler, type CheerioCrawlingContext } from "@crawlee/cheerio";
import { extractReadableText, fetchPublicResource, PageFetchError, validatePublicPageUrl } from "@/lib/fetching/safe-page-fetch";
import type { DiscoveredUrlReference } from "@/lib/discovery/discovered-urls";

export type CrawlSeed = {
  url: string;
  title: string;
  excerpt: string;
  provider: string;
  reference: DiscoveredUrlReference;
  sourceReferences: DiscoveredUrlReference[];
};

export type CrawledPage = CrawlSeed & {
  requestedUrl: string;
  finalUrl: string;
  text: string;
  contentHash: string;
  depth: number;
  parentUrl: string | null;
};

export type CrawlFailure = { url: string; error: string; blocked: boolean; deferred: boolean; retryable: boolean };
export type QueuedCrawlLink = { url: string; title: string; provider: string; reference: DiscoveredUrlReference; sourceReferences: DiscoveredUrlReference[]; depth: number; parentUrl: string };

export function classifyCrawlError(error: unknown): { blocked: boolean; deferred: boolean; retryable: boolean } {
  const message = error instanceof Error ? error.message : String(error);
  const fetchError = error instanceof PageFetchError ? error : null;
  const blocked = fetchError?.code === "ROBOTS" || fetchError?.code === "SSRF" || /robots policy disallows|non-public address|only public http/i.test(message);
  if (blocked) return { blocked: true, deferred: false, retryable: false };
  const httpMatch = message.match(/HTTP (\d{3})/i);
  const status = Number(httpMatch?.[1]);
  const transientHttp = status === 408 || status === 429 || status >= 500 && status <= 599;
  const deferred = fetchError?.code === "ROBOTS_UNREACHABLE" || fetchError?.code === "TIMEOUT" || fetchError?.code === "NETWORK" || transientHttp || !fetchError;
  const permanent = fetchError?.code === "CONTENT" || fetchError?.code === "SIZE" || fetchError?.code === "HTTP" && !transientHttp;
  return { blocked: false, deferred: deferred && !permanent, retryable: !permanent };
}

type SafeResponse = { finalUrl: string; type: string; body: Buffer; text: string; contentHash: string };

// Crawlee owns the bounded request queue and Cheerio parsing. Its HTTP client
// delegates every outbound request to the existing DNS-pinned, robots-aware fetcher.
class SafeCrawleeHttpClient {
  readonly responses = new Map<string, SafeResponse>();

  private async get(request: { url: string | URL }) {
    const requestedUrl = validatePublicPageUrl(String(request.url)).toString();
    const resource = await fetchPublicResource(requestedUrl, /text\/html|application\/xhtml\+xml/i);
    const text = extractReadableText(resource.body.toString("utf8"));
    if (!text) throw new Error("No readable page text was found.");
    const response: SafeResponse = {
      ...resource,
      text,
      contentHash: createHash("sha256").update(text).digest("hex"),
    };
    this.responses.set(requestedUrl, response);
    return response;
  }

  async sendRequest<T extends "json" | "text" | "buffer">(request: { url: string | URL; [key: string]: unknown }) {
    const response = await this.get(request);
    const body = request.responseType === "buffer" ? response.body : response.body.toString("utf8");
    return {
      request,
      url: response.finalUrl,
      statusCode: 200,
      statusMessage: "OK",
      headers: { "content-type": response.type },
      trailers: {},
      redirectUrls: [],
      complete: true,
      body,
    } as unknown;
  }

  async stream(request: { url: string | URL; [key: string]: unknown }) {
    const response = await this.get(request);
    const byteLength = response.body.byteLength;
    return {
      stream: Readable.from([response.body]),
      request,
      url: response.finalUrl,
      statusCode: 200,
      statusMessage: "OK",
      headers: { "content-type": response.type },
      trailers: {},
      redirectUrls: [],
      complete: true,
      downloadProgress: { percent: 1, transferred: byteLength, total: byteLength },
      uploadProgress: { percent: 1, transferred: 0, total: 0 },
    };
  }
}

const recruitmentPath = /join|openings?|positions?|vacanc(?:y|ies)|prospective[-_ ]students?|graduate[-_ ](?:students?|study|admissions|funding)|recruit(?:ing|ment)?|scholarships?|studentships?|assistantships?|fellowships?/i;

export async function crawlSafePages(
  seeds: CrawlSeed[],
  options: { maxPages: number; maxConcurrency: number; retries: number; sameDomainDelaySecs: number; linksPerPage: number },
): Promise<{ pages: CrawledPage[]; failures: CrawlFailure[]; queued: QueuedCrawlLink[] }> {
  if (!seeds.length || options.maxPages <= 0) return { pages: [], failures: [], queued: [] };
  const client = new SafeCrawleeHttpClient();
  const pages: CrawledPage[] = [];
  const failures: CrawlFailure[] = [];
  const queued: QueuedCrawlLink[] = [];
  const maxPages = Math.max(1, Math.min(500, Math.trunc(options.maxPages)));
  const crawler = new CheerioCrawler({
    httpClient: client as never,
    maxRequestsPerCrawl: maxPages,
    maxRequestRetries: Math.max(0, Math.min(3, Math.trunc(options.retries))),
    maxConcurrency: Math.max(1, Math.min(5, Math.trunc(options.maxConcurrency))),
    minConcurrency: 1,
    sameDomainDelaySecs: Math.max(0, Math.min(60, options.sameDomainDelaySecs)),
    navigationTimeoutSecs: 15,
    respectRobotsTxtFile: false, // fetchPublicResource checks policy before every request and redirect.
    async requestHandler(context: CheerioCrawlingContext) {
      const { $, request, response, enqueueLinks } = context;
      const data = request.userData as { seed: CrawlSeed; depth: number; rootHost: string; parentUrl: string | null };
      const requestedUrl = validatePublicPageUrl(String(request.url)).toString();
      const safeResponse = client.responses.get(requestedUrl);
      if (!safeResponse) throw new Error("Safe response metadata was unavailable.");
      const finalUrl = validatePublicPageUrl(String(response.url)).toString();
      const title = $("meta[property='og:title']").attr("content")?.trim() || $("h1").first().text().trim() || $("title").text().trim() || data.seed.title;
      $("script,style,noscript,svg,nav,footer,header,aside,form,iframe").remove();
      const text = extractReadableText($("body").html() ?? "").slice(0, 30_000);
      if (!text) throw new Error("The fetched page contained no readable content after removing navigation and boilerplate.");
      pages.push({ ...data.seed, title: title.slice(0, 1000), requestedUrl, finalUrl, text, contentHash: safeResponse.contentHash, depth: data.depth, parentUrl: data.parentUrl });
      // Search result URLs are the only crawl seeds. Internal links were
      // producing job boards, articles, and unrelated pages outside the
      // keyword result set, so do not enqueue them here.
      if (data.depth >= 2 || options.linksPerPage <= 0) return;

      const matches: string[] = [];
      $("a[href]").each((_index, element) => {
        const anchor = $(element);
        const rawHref = anchor.attr("href");
        if (!rawHref || !recruitmentPath.test(`${rawHref} ${anchor.text()}`)) return;
        try {
          const target = validatePublicPageUrl(new URL(rawHref, finalUrl).toString());
          if (target.hostname.toLowerCase() !== data.rootHost || target.toString() === finalUrl) return;
          target.hash = "";
          matches.push(target.toString());
        } catch { /* Reject malformed, credentialed, private and non-HTTP links. */ }
      });
      const distinct = [...new Set(matches)].slice(0, options.linksPerPage);
      const links = distinct.map((url) => ({ url, title: data.seed.title, provider: data.seed.provider, reference: data.seed.reference, sourceReferences: data.seed.sourceReferences, depth: data.depth + 1, parentUrl: finalUrl }));
      queued.push(...links);
      if (distinct.length) await enqueueLinks({
        urls: distinct,
        strategy: "same-hostname",
        limit: options.linksPerPage,
        userData: { seed: data.seed, depth: data.depth + 1, rootHost: data.rootHost, parentUrl: finalUrl },
      });
    },
    errorHandler({ request }, error) {
      // Robots denials, unsafe destinations, permanent HTTP misses and
      // unsupported content cannot improve through an automatic retry.
      if (!classifyCrawlError(error).retryable) request.noRetry = true;
    },
    async failedRequestHandler(context, error) {
      const { request } = context;
      const message = error instanceof Error ? error.message : String(error ?? "Crawl request failed.");
      failures.push({ url: String(request.url), error: message.slice(0, 500), ...classifyCrawlError(error) });
    },
  });

  try {
    await crawler.run(seeds.slice(0, maxPages).map((seed) => ({
      url: seed.url,
      userData: { seed, depth: 0, rootHost: new URL(seed.url).hostname.toLowerCase(), parentUrl: null },
    })));
  } finally {
    await crawler.teardown();
  }
  return { pages, failures, queued: [...new Map(queued.map((link) => [link.url, link])).values()] };
}


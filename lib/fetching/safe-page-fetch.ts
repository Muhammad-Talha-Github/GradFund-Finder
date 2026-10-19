import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import http from "node:http";
import https from "node:https";

const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 5;
const lastRequestAt = new Map<string, number>();
const domainLocks = new Map<string, Promise<void>>();
type PageResponse = { status: number; location: string | null; type: string; body: Buffer };
type RobotsDecision = { allowed: boolean; reason: string; unavailable?: boolean };
type FetchDependencies = {
  request?: (url: URL) => Promise<PageResponse>;
  robots?: (url: URL) => Promise<boolean | RobotsDecision>;
  robotsRequest?: (url: URL) => Promise<PageResponse>;
};

export class PageFetchError extends Error {
  constructor(message: string, readonly code: "SSRF" | "ROBOTS" | "ROBOTS_UNREACHABLE" | "HTTP" | "TIMEOUT" | "SIZE" | "CONTENT" | "NETWORK") {
    super(message);
    this.name = "PageFetchError";
  }
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const parts = address.split(".").map(Number);
    const [a, b] = parts;
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0));
  }
  if (family !== 6) return false;
  const ip = address.toLowerCase().split("%", 1)[0];
  if (ip.startsWith("::ffff:")) return isPublicAddress(ip.slice(7));
  // Permit global unicast only; reject loopback, unspecified, ULA, link-local and special ranges.
  return /^2[0-9a-f]{3}:/i.test(ip) && !/^2001:(?:0|db8|10|20):/i.test(ip);
}

export function validatePublicPageUrl(input: string): URL {
  let url: URL;
  try { url = new URL(input); } catch { throw new PageFetchError("Invalid page URL.", "SSRF"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !url.hostname ||
    url.port && !(url.protocol === "http:" && url.port === "80" || url.protocol === "https:" && url.port === "443")) {
    throw new PageFetchError("Only public HTTP(S) page URLs on standard ports are allowed.", "SSRF");
  }
  if (isIP(url.hostname) && !isPublicAddress(url.hostname)) throw new PageFetchError("The page host is not public.", "SSRF");
  return url;
}

async function resolvePublic(host: string) {
  if (isIP(host)) {
    if (!isPublicAddress(host)) throw new PageFetchError("The page host resolves to a non-public address.", "SSRF");
    return [{ address: host, family: isIP(host) }];
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await Promise.race([
      lookup(host, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new PageFetchError(`DNS lookup timed out for ${host}.`, "TIMEOUT")), TIMEOUT_MS); }),
    ]).finally(() => { if (timer) clearTimeout(timer); });
  } catch (error) {
    if (error instanceof PageFetchError) throw error;
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "unknown DNS error";
    throw new PageFetchError(`DNS lookup failed for ${host} (${code}).`, "NETWORK");
  }
  if (!addresses.length || addresses.some((item) => !isPublicAddress(item.address))) {
    throw new PageFetchError("The page host resolves to a non-public address.", "SSRF");
  }
  return addresses;
}

async function reserveDomainRequest(host: string): Promise<() => void> {
  const previous = domainLocks.get(host) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  domainLocks.set(host, current);
  try {
    await previous;
    const configuredInterval = Number(process.env.CRAWL_DOMAIN_DELAY_MS);
    const minIntervalMs = Number.isFinite(configuredInterval) ? Math.max(250, Math.min(60_000, Math.trunc(configuredInterval))) : 1_000;
    const wait = Math.max(0, (lastRequestAt.get(host) ?? 0) + minIntervalMs - Date.now());
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt.set(host, Date.now());
    return () => {
      release();
      if (domainLocks.get(host) === current) domainLocks.delete(host);
    };
  } catch (error) {
    release();
    if (domainLocks.get(host) === current) domainLocks.delete(host);
    throw error;
  }
}

export function createPinnedAddressLookup(addresses: Array<{ address: string; family: number }>): NonNullable<https.RequestOptions["lookup"]> {
  if (!addresses.length) throw new PageFetchError("No validated public addresses are available.", "NETWORK");
  return (_hostname, options, callback) => {
    // autoSelectFamily asks for all records so Node can try IPv6/IPv4 candidates
    // sequentially. Return only the DNS answers already checked by resolvePublic.
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0]!.address, addresses[0]!.family);
  };
}

async function requestText(url: URL): Promise<PageResponse> {
  const addresses = await resolvePublic(url.hostname);
  const releaseDomain = await reserveDomainRequest(url.hostname);
  const transport = url.protocol === "https:" ? https : http;
  try { return await new Promise((resolve, reject) => {
    let settled = false;
    const finishError = (error: Error) => { if (!settled) { settled = true; reject(error); } };
    const req = transport.request(url, {
      method: "GET",
      headers: { "User-Agent": "GradFundFinder/1.0 (+public opportunity discovery; respects robots.txt)", Accept: "text/html,application/xhtml+xml" },
      timeout: TIMEOUT_MS,
      maxHeaderSize: 16_384,
      lookup: createPinnedAddressLookup(addresses),
      ...(url.protocol === "https:" ? { servername: url.hostname } : {}),
    }, (res) => {
      const status = res.statusCode ?? 0;
      const type = String(res.headers["content-type"] ?? "").toLowerCase();
      const length = Number(res.headers["content-length"] ?? 0);
      if (length > MAX_BYTES) { res.destroy(); finishError(new PageFetchError("Page exceeds the 1.5 MB response limit.", "SIZE")); return; }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BYTES) { res.destroy(); finishError(new PageFetchError("Page exceeds the 1.5 MB response limit.", "SIZE")); }
        else chunks.push(chunk);
      });
      res.on("error", (error) => finishError(error));
      res.on("end", () => {
        if (settled) return;
        settled = true;
        resolve({ status, location: typeof res.headers.location === "string" ? res.headers.location : null, type, body: Buffer.concat(chunks) });
      });
    });
    req.on("timeout", () => { req.destroy(); finishError(new PageFetchError("Page request timed out.", "TIMEOUT")); });
    req.on("error", (error: NodeJS.ErrnoException) => {
      if (error instanceof PageFetchError) { finishError(error); return; }
      const code = error.code ?? "unknown";
      const tls = code.startsWith("CERT_") || code.startsWith("ERR_TLS_") || code === "DEPTH_ZERO_SELF_SIGNED_CERT";
      const aggregateDetails = error instanceof AggregateError
        ? error.errors.map((item) => {
          const nestedCode = item && typeof item === "object" && "code" in item ? ` (${String(item.code)})` : "";
          return `${item instanceof Error ? item.message : String(item)}${nestedCode}`;
        }).join("; ")
        : "";
      const detail = error.message || aggregateDetails || "no additional socket details";
      finishError(new PageFetchError(`${tls ? "TLS" : "HTTP transport"} request failed for ${url.hostname} (${code}): ${detail}`, "NETWORK"));
    });
    req.end();
  }); } finally { releaseDomain(); }
}

function decodeHtml(value: string): string {
  return value.replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Math.min(0x10ffff, Number(n))))
    .replace(/&#x([\da-f]+);/gi, (_, n: string) => String.fromCodePoint(Math.min(0x10ffff, parseInt(n, 16))));
}

export function extractReadableText(html: string): string {
  return decodeHtml(html.replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|nav|footer|header|aside|form|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")).replace(/[\t\r ]+/g, " ").replace(/\n\s*/g, "\n").trim().slice(0, 80_000);
}

type RobotsRule = { allow: boolean; path: string; specificity: number; regex: RegExp };
type RobotsGroup = { agents: string[]; rules: RobotsRule[] };
type RobotsPolicy = { groups: RobotsGroup[] };
const robotsCache = new Map<string, { expiresAt: number; policy?: RobotsPolicy; error?: PageFetchError; reason: string }>();
const ROBOTS_CACHE_MS = 60 * 60 * 1000;
const ROBOTS_ERROR_CACHE_MS = 30 * 1000;

function robotsRule(pattern: string, allow: boolean): RobotsRule | null {
  const normalized = pattern.trim();
  if (!normalized.startsWith("/")) return null;
  const endAnchored = normalized.endsWith("$");
  const expression = (endAnchored ? normalized.slice(0, -1) : normalized)
    .split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  try {
    return { allow, path: normalized, specificity: Buffer.byteLength(normalized.replace(/\*|\$$/g, "")), regex: new RegExp(`^${expression}${endAnchored ? "$" : ""}`) };
  } catch { return null; }
}

function parseRobots(body: Buffer): RobotsPolicy {
  const source = body.toString("utf8").replace(/^\uFEFF/, "");
  let invalidLines = 0;
  const groups: RobotsGroup[] = [];
  let agents: string[] = [];
  let rules: RobotsRule[] = [];
  let hasDirective = false;
  const flush = () => {
    if (agents.length) groups.push({ agents, rules });
    agents = [];
    rules = [];
    hasDirective = false;
  };

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.split("#", 1)[0]?.trim() ?? "";
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) { invalidLines++; continue; }
    const directive = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (directive === "user-agent") {
      // Consecutive User-agent lines form one group. A new agent after rules
      // starts the next group as required by the robots grammar.
      if (hasDirective) flush();
      if (value) agents.push(value.toLowerCase()); else invalidLines++;
      continue;
    }
    if (directive === "allow" || directive === "disallow") {
      if (!agents.length) { invalidLines++; continue; }
      hasDirective = true;
      if (!value) continue; // Empty Disallow means no restriction.
      const parsed = robotsRule(value, directive === "allow");
      if (parsed) rules.push(parsed); else invalidLines++;
    }
    // Unknown extension directives are ignored by RFC 9309 parsers.
  }
  flush();
  if (invalidLines) console.warn(`[crawler:robots] ignored ${invalidLines} malformed robots.txt line(s)`);
  return { groups };
}

function robotsAllows(policy: RobotsPolicy, pageUrl: URL): RobotsDecision {
  const groups = policy.groups;
  const matching = groups.filter((group) => group.agents.some((agent) => agent === "*" || "gradfundfinder".includes(agent)));
  const specific = matching.flatMap((group) => group.agents).filter((agent) => agent !== "*" && "gradfundfinder".includes(agent));
  const selected = specific.length
    ? matching.filter((group) => group.agents.some((agent) => agent !== "*" && "gradfundfinder".includes(agent) && agent.length === Math.max(...specific.map((item) => item.length))))
    : matching.filter((group) => group.agents.includes("*"));
  const target = pageUrl.pathname + pageUrl.search;
  const candidates = selected.flatMap((group) => group.rules).filter((rule) => rule.regex.test(target));
  if (!candidates.length) return { allowed: true, reason: "No matching robots.txt rule." };
  const longest = Math.max(...candidates.map((rule) => rule.specificity));
  const winners = candidates.filter((rule) => rule.specificity === longest);
  const winner = winners.find((rule) => rule.allow) ?? winners[0]!;
  return winner.allow
    ? { allowed: true, reason: `robots.txt Allow rule matched ${winner.path}.` }
    : { allowed: false, reason: `robots.txt Disallow rule matched ${winner.path}.` };
}

async function fetchRobotsPolicy(pageUrl: URL, request: (url: URL) => Promise<PageResponse> = requestText): Promise<{ policy: RobotsPolicy; reason: string }> {
  const robotsUrl = new URL("/robots.txt", pageUrl.origin);
  let current = validatePublicPageUrl(robotsUrl.toString());
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    let response: PageResponse;
    try { response = await request(current); }
    catch (error) {
      const cause = error instanceof Error ? error.message : "unknown transport error";
      const code = error instanceof PageFetchError ? error.code : "NETWORK";
      if (code === "SSRF") throw new PageFetchError(`robots.txt redirect/host rejected by public-address validation: ${cause}`, "SSRF");
      throw new PageFetchError(`robots.txt is unreachable (${code}): ${cause}`, "ROBOTS_UNREACHABLE");
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (!response.location) throw new PageFetchError(`robots.txt returned HTTP ${response.status} without a Location header.`, "ROBOTS_UNREACHABLE");
      if (redirects === MAX_REDIRECTS) throw new PageFetchError(`robots.txt exceeded the ${MAX_REDIRECTS}-redirect limit.`, "ROBOTS_UNREACHABLE");
      try { current = validatePublicPageUrl(new URL(response.location, current).toString()); }
      catch (error) { throw new PageFetchError(`robots.txt redirect was rejected: ${error instanceof Error ? error.message : "invalid destination"}`, "SSRF"); }
      continue;
    }
    if (response.status === 429) throw new PageFetchError("robots.txt returned HTTP 429 (rate limited); defer this origin.", "ROBOTS_UNREACHABLE");
    if (response.status >= 400 && response.status < 500) {
      const reason = `robots.txt unavailable with HTTP ${response.status}; RFC 9309 permits access when the file is unavailable.`;
      console.info(`[crawler:robots] ${reason} ${pageUrl.origin}`);
      return { policy: { groups: [] }, reason };
    }
    if (response.status >= 500) throw new PageFetchError(`robots.txt is unreachable: HTTP ${response.status}.`, "ROBOTS_UNREACHABLE");
    if (response.status < 200 || response.status >= 300) throw new PageFetchError(`robots.txt returned unexpected HTTP ${response.status}.`, "ROBOTS_UNREACHABLE");
    if (response.body.byteLength > 512_000) throw new PageFetchError("robots.txt exceeded the 500 KB parsing limit.", "ROBOTS_UNREACHABLE");
    const policy = parseRobots(response.body);
    return { policy, reason: "robots.txt fetched and parsed." };
  }
  throw new PageFetchError("robots.txt redirect processing did not complete.", "ROBOTS_UNREACHABLE");
}

async function isAllowedByRobots(pageUrl: URL, request?: (url: URL) => Promise<PageResponse>): Promise<RobotsDecision> {
  const key = pageUrl.origin.toLowerCase();
  const cached = robotsCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    if (cached.error) throw cached.error;
    return robotsAllows(cached.policy!, pageUrl);
  }
  try {
    const fetched = await fetchRobotsPolicy(pageUrl, request);
    robotsCache.set(key, { expiresAt: Date.now() + ROBOTS_CACHE_MS, policy: fetched.policy, reason: fetched.reason });
    return robotsAllows(fetched.policy, pageUrl);
  } catch (error) {
    const cause = error instanceof PageFetchError ? error : new PageFetchError(`robots.txt parsing/fetch failed: ${error instanceof Error ? error.message : "unknown error"}`, "ROBOTS_UNREACHABLE");
    robotsCache.set(key, { expiresAt: Date.now() + ROBOTS_ERROR_CACHE_MS, error: cause, reason: cause.message });
    throw cause;
  }
}

export async function fetchPublicResource(
  input: string,
  acceptedContentType: RegExp,
  dependencies: FetchDependencies = {},
): Promise<{ finalUrl: string; type: string; body: Buffer }> {
  let current = validatePublicPageUrl(input);
  const request = dependencies.request ?? requestText;
  const robots = dependencies.robots ?? ((url: URL) => isAllowedByRobots(url, dependencies.robotsRequest));
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    let decision: boolean | RobotsDecision;
    try { decision = await robots(current); }
    catch (error) {
      if (error instanceof PageFetchError) throw error;
      throw new PageFetchError(`robots.txt processing failed: ${error instanceof Error ? error.message : "unknown parsing error"}`, "ROBOTS_UNREACHABLE");
    }
    const allowed = typeof decision === "boolean" ? decision : decision.allowed;
    if (!allowed) throw new PageFetchError(typeof decision === "boolean" ? `robots.txt rule disallows ${current.pathname}${current.search}.` : decision.reason, "ROBOTS");
    const response = await request(current);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (!response.location || redirects === MAX_REDIRECTS) throw new PageFetchError("Too many or invalid page redirects.", "HTTP");
      current = validatePublicPageUrl(new URL(response.location, current).toString());
      continue;
    }
    if (response.status < 200 || response.status >= 300) throw new PageFetchError(`Page returned HTTP ${response.status}.`, "HTTP");
    if (!acceptedContentType.test(response.type)) throw new PageFetchError("Page has an unsupported content type.", "CONTENT");
    return { finalUrl: current.toString(), type: response.type, body: response.body };
  }
  throw new PageFetchError("Too many page redirects.", "HTTP");
}

export async function fetchPublicHtml(input: string, dependencies: FetchDependencies = {}): Promise<{ finalUrl: string; text: string; contentHash: string }> {
  const response = await fetchPublicResource(input, /text\/html|application\/xhtml\+xml/, dependencies);
  const html = response.body.toString("utf8");
  const text = extractReadableText(html);
  if (!text) throw new PageFetchError("No readable text was found on the page.", "CONTENT");
  const { createHash } = await import("node:crypto");
  return { finalUrl: response.finalUrl, text, contentHash: createHash("sha256").update(text).digest("hex") };
}

import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeUrl, classifyFunding, normalizeTitle, paginate } from "../lib/opportunities/domain";
import { normalizeSearchResults } from "../lib/search/normalize-results";
import { createPinnedAddressLookup, extractReadableText, fetchPublicHtml, isPublicAddress, validatePublicPageUrl, PageFetchError } from "../lib/fetching/safe-page-fetch";
import { extractWithFallback, isLegacyGemini404, isUnchangedContent, mergeEvidence } from "../lib/discovery/extraction-pipeline";
import { GeminiExtractionProvider, validateGeminiOutput } from "../lib/extraction/gemini-extractor";
import type { CandidateEvidence, OpportunityExtractionProvider } from "../lib/extraction/types";
import { categorizeLead, getLeadStatus, isPlausibleProfessorPhdSnippet, isPotentiallyRelevant, isProfessorOrLabLead, isProfessorPhdRecruitmentPost } from "../lib/discovery/lead-classification";
import { buildOpportunitySearch } from "../lib/opportunities/search";
import { classifyCrawlError } from "../lib/discovery/safe-crawler";
import { createSnippetClassificationCacheMarker, hasSnippetClassificationCache } from "../lib/discovery/snippet-classification-cache";
import { mysqlStatement } from "../lib/db";

test("canonical URLs remove tracking and fragments", () => {
  assert.equal(canonicalizeUrl("https://www.example.edu/opps/?utm_source=mail#details"), "https://example.edu/opps");
});

test("funding classification is conservative", () => {
  assert.equal(classifyFunding("Fully funded tuition and stipend"), "FULL");
  assert.equal(classifyFunding("Scholarship available"), "UNCLEAR");
  assert.equal(classifyFunding(""), "NO_EVIDENCE");
});

test("titles normalize accents and punctuation for duplicate matching", () => {
  assert.equal(normalizeTitle("École — Funded Ph.D.!"), "ecole funded ph d");
});

test("unknown extracted fields remain unknown and web results unverified", () => {
  const [result] = normalizeSearchResults([{ title: "Graduate position", url: "https://example.edu/job", content: "Funding details will be announced." }]);
  assert.equal(result.country, "Unknown");
  assert.equal(result.degree, "Unknown");
  assert.equal(result.deadline, "Unknown");
  assert.equal(result.verified, false);
});

test("pagination clamps page size and page", () => {
  assert.deepEqual(paginate([1, 2, 3], 20, 2), { items: [3], page: 2, pageSize: 2, total: 3, pages: 2 });
});

test("MySQL adapter binds numbered placeholders used by collector inserts", () => {
  const statement = mysqlStatement("INSERT IGNORE INTO `Opportunity` (`id`,`title`,`deadline`) VALUES ($1,$2,$3)", ["id-1", "PhD position", null]);
  assert.equal(statement.sql, "INSERT IGNORE INTO `Opportunity` (`id`,`title`,`deadline`) VALUES (?,?,?)");
  assert.deepEqual(statement.parameters, ["id-1", "PhD position", null]);
});

test("broad discovery retains professor and lab leads without funding or degree evidence", () => {
  const title = "Professor Amina Rahman - Molecular Ecology Lab";
  const snippet = "Our research group studies coastal ecosystems and welcomes prospective researchers.";
  assert.equal(isPotentiallyRelevant(title, snippet), true);
  const category = categorizeLead(title, snippet);
  assert.equal(category, "LAB");
  assert.equal(getLeadStatus(category, "NO_EVIDENCE"), "PROFESSOR_OR_LAB_LEAD");
  assert.equal(getLeadStatus("FUNDED_POSITION", "FULL", "UNCERTAIN"), "POTENTIAL_OPPORTUNITY");
  assert.equal(getLeadStatus("FUNDED_POSITION", "FULL", "OPEN"), "CONFIRMED_FUNDED");
  assert.equal(categorizeLead("Top 20 funded PhD scholarships: yearly roundup", "Apply now; fully funded scholarships listed."), "OTHER_RESEARCH_LEAD");
  assert.equal(getLeadStatus("OTHER_RESEARCH_LEAD", "FULL", "OPEN"), "POTENTIAL_OPPORTUNITY");
  assert.equal(categorizeLead("Graduate research program", "Admissions information for prospective doctoral students."), "GRADUATE_PROGRAM");
  assert.equal(isPotentiallyRelevant("Casino bonus claim", "Graduate scholarship PhD"), false);
});

test("clearly informational and postdoctoral pages do not enter the graduate lead list", () => {
  assert.equal(isPotentiallyRelevant("How to Email Potential PhD Advisors and Grad Students (Free Templates)", "Our research labs welcome applicants."), false);
  assert.equal(isPotentiallyRelevant("How to join a lab as a Master's student - Research - The GradCafe Forums", "Graduate research lab."), false);
  assert.equal(isPotentiallyRelevant("Postdoctoral Researcher: Experimental Fracture Mechanics", "Join the laboratory team."), false);
  assert.equal(categorizeLead("Faculty Accepting Graduate Students for Fall 2026", "The laboratory welcomes students."), "PROFESSOR");
});

test("collection accepts active professor PhD recruitment posts and excludes general advice and scholarship pages", () => {
  assert.equal(isProfessorPhdRecruitmentPost("Professor Lee's Computer Vision Lab", "I am recruiting PhD students to join my lab in Fall 2027."), true);
  assert.equal(isProfessorPhdRecruitmentPost("Professor Wu — Language Systems Lab", "Looking for new PhD students to join our AI and large language models group."), true);
  assert.equal(isProfessorOrLabLead("Dr. Ana Smith - Computer Science Faculty", "I am Professor Smith and am seeking PhD students for my computer science research group."), true);
  assert.equal(isProfessorPhdRecruitmentPost("Professor Chen - Machine Learning", "Research interests include machine learning and distributed systems."), false);
  assert.equal(isProfessorPhdRecruitmentPost("Graduate Admissions Advice", "How to email professors and find PhD scholarships."), false);
  assert.equal(isProfessorPhdRecruitmentPost("Top PhD Scholarships for International Students", "A list of scholarship options and application tips."), false);
  assert.equal(isProfessorPhdRecruitmentPost("Professor Kim's Lab", "We are not currently recruiting PhD students."), false);
  assert.equal(isProfessorPhdRecruitmentPost("Professor Green's Biology Lab", "I am recruiting PhD students to join my lab in Fall 2027."), false);
  assert.equal(isProfessorPhdRecruitmentPost("4 Best Ways to Join a Research Lab", "Professors recruit PhD students. Computer science is a popular field."), false);
  assert.equal(isProfessorPhdRecruitmentPost("Professor Lee's Computer Vision Lab", "The lab studies computer vision and machine learning."), false);
  assert.equal(isProfessorPhdRecruitmentPost("Fully Funded PhD Scholarships for International Students", "Professor advice: we are recruiting students. Computer science funding guide."), false);
  assert.equal(isProfessorPhdRecruitmentPost("Professors Seeking PhD Students: Open Positions for Aspiring Researchers", "We are recruiting computer science PhD students."), false);
  assert.equal(isProfessorPhdRecruitmentPost("Open Positions", "We are recruiting computer science PhD students. This site is archival and will no longer be updated."), false);
  assert.equal(isProfessorOrLabLead("Graduate Admissions Advice", "How to email a professor and find scholarships."), false);
  assert.equal(isProfessorOrLabLead("University Home", "The university offers many programs and services."), false);
});

test("snippet Gemini gate is broad but excludes advice, postdoc-only, spam, and aggregators", () => {
  assert.equal(isPlausibleProfessorPhdSnippet("Professor Jane Doe - Computer Science", "I am recruiting PhD students for my lab."), true);
  assert.equal(isPlausibleProfessorPhdSnippet("How to email a professor", "Professors recruit PhD students in computer science."), false);
  assert.equal(isPlausibleProfessorPhdSnippet("Professor Jane Doe", "Hiring postdoctoral researchers in machine learning."), false);
  assert.equal(isPlausibleProfessorPhdSnippet("PhD openings", "Professor recruiting PhD students in CS.", "https://findaphd.com/result"), false);
  assert.equal(isPlausibleProfessorPhdSnippet("Casino bonus", "Computer science PhD professor hiring."), false);
});

test("snippet classification cache matches URL record hash and accepted/rejected decisions", () => {
  const accepted = createSnippetClassificationCacheMarker("ACCEPTED", "hash-1", "robots denied");
  const rejected = createSnippetClassificationCacheMarker("REJECTED", "hash-2", "timeout");
  assert.equal(hasSnippetClassificationCache(accepted, "hash-1"), true);
  assert.equal(hasSnippetClassificationCache(rejected, "hash-2"), true);
  assert.equal(hasSnippetClassificationCache(accepted, "hash-3"), false);
  assert.equal(hasSnippetClassificationCache("Gemini unavailable", "hash-1"), false);
});


test("database search applies preferences after broad ingestion and treats missing facts as unknown", () => {
  const broad = buildOpportunitySearch(new URLSearchParams("pageSize=50"));
  assert.equal(broad.where, "");
  assert.deepEqual(broad.values, []);
  const filtered = buildOpportunitySearch(new URLSearchParams("degree=PhD&country=Canada&funding=FULL&eligibility=international"));
  assert.match(filtered.where, /degreeLevel.*doctoral/);
  assert.match(filtered.where, /country.*ILIKE/);
  assert.match(filtered.where, /fundingClassification/);
  assert.match(filtered.where, /eligibilityRequirements/);
  assert.deepEqual(filtered.values, ["%Canada%", "FULL", "%international%"]);
});

test("United States country filter matches common US country labels", () => {
  const search = buildOpportunitySearch(new URLSearchParams("country=United%20States"));
  assert.match(search.where, /country.*\$1.*OR.*country.*\$4/);
  assert.deepEqual(search.values, ["%United States%", "USA", "US", "U.S."]);
});

test("research field filters search extracted fields and supporting page text without changing record fields", () => {
  const search = buildOpportunitySearch(new URLSearchParams("field=Computer%20Science"));
  for (const column of ["researchField", "title", "description", "department", "institution", "labGroup"]) {
    assert.match(search.where, new RegExp(`o\\."${column}" ILIKE`));
  }
  assert.match(search.where, /evidenceExcerpts/);
  assert.deepEqual(search.values, ["%Computer Science%"]);
});

test("fetcher blocks private IP ranges, credentials, and non-HTTP schemes", () => {
  assert.equal(isPublicAddress("127.0.0.1"), false);
  assert.equal(isPublicAddress("10.20.30.40"), false);
  assert.equal(isPublicAddress("169.254.169.254"), false);
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.throws(() => validatePublicPageUrl("http://127.0.0.1/admin"), { code: "SSRF" });
  assert.throws(() => validatePublicPageUrl("file:///etc/passwd"), { code: "SSRF" });
  assert.throws(() => validatePublicPageUrl("https://user:pass@example.edu/"), { code: "SSRF" });
  assert.ok(new PageFetchError("x", "HTTP") instanceof Error);
});

test("pinned DNS lookup returns all validated addresses for Node address-family failover", () => {
  const answers = [
    { address: "2001:4860:4860::8888", family: 6 },
    { address: "8.8.8.8", family: 4 },
  ];
  const lookup = createPinnedAddressLookup(answers);
  let allResults: string | Array<{ address: string; family: number }> | undefined;
  lookup("public.example", { all: true, family: 0, hints: 0, verbatim: true }, (_error, address) => { allResults = address; });
  assert.deepEqual(allResults, answers);
  let singleAddress: string | Array<{ address: string; family: number }> | undefined;
  let family: number | undefined;
  lookup("public.example", { all: false, family: 0, hints: 0, verbatim: true }, (_error, address, resultFamily) => { singleAddress = address; family = resultFamily; });
  assert.equal(singleAddress, answers[0]?.address);
  assert.equal(family, 6);
});

test("crawl failures distinguish permanent robots blocks from retryable network errors", () => {
  assert.deepEqual(classifyCrawlError(new PageFetchError("robots.txt Disallow rule matched /private.", "ROBOTS")), { blocked: true, deferred: false, retryable: false });
  assert.deepEqual(classifyCrawlError(new PageFetchError("Page returned HTTP 404.", "HTTP")), { blocked: false, deferred: false, retryable: false });
  assert.deepEqual(classifyCrawlError(new PageFetchError("Page request timed out.", "TIMEOUT")), { blocked: false, deferred: true, retryable: true });
  assert.deepEqual(classifyCrawlError(new PageFetchError("robots.txt unreachable: HTTP 503.", "ROBOTS_UNREACHABLE")), { blocked: false, deferred: true, retryable: true });
});

test("robots.txt follows validated redirects and applies longest-match Allow precedence", async () => {
  let fetchedPage = false;
  const result = await fetchPublicHtml("https://unique-robots-allow.example/private/open", {
    robotsRequest: async (url) => url.host === "unique-robots-allow.example"
      ? { status: 302, location: "https://robots-cdn.example/policy", type: "text/plain", body: Buffer.alloc(0) }
      : { status: 200, location: null, type: "text/plain", body: Buffer.from("User-agent: *\nDisallow: /private\nAllow: /private/open") },
    request: async () => { fetchedPage = true; return { status: 200, location: null, type: "text/html", body: Buffer.from("<p>Opportunity</p>") }; },
  });
  assert.equal(result.text, "Opportunity");
  assert.equal(fetchedPage, true);
});

test("robots.txt 4xx is unavailable under RFC 9309, while server and transport errors defer", async () => {
  let pageFetched = false;
  await fetchPublicHtml("https://unique-robots-404.example/open", {
    robotsRequest: async () => ({ status: 404, location: null, type: "text/plain", body: Buffer.alloc(0) }),
    request: async () => { pageFetched = true; return { status: 200, location: null, type: "text/html", body: Buffer.from("<p>Open</p>") }; },
  });
  assert.equal(pageFetched, true);

  await assert.rejects(fetchPublicHtml("https://unique-robots-503.example/open", {
    robotsRequest: async () => ({ status: 503, location: null, type: "text/plain", body: Buffer.alloc(0) }),
    request: async () => { throw new Error("page must not be fetched"); },
  }), { code: "ROBOTS_UNREACHABLE" });
  await assert.rejects(fetchPublicHtml("https://unique-robots-reset.example/open", {
    robotsRequest: async () => { throw new PageFetchError("connection reset (ECONNRESET)", "NETWORK"); },
    request: async () => { throw new Error("page must not be fetched"); },
  }), { code: "ROBOTS_UNREACHABLE", message: /NETWORK.*ECONNRESET/ });
});

test("robots.txt matching disallows actual rules and unsafe robots redirects", async () => {
  await assert.rejects(fetchPublicHtml("https://unique-robots-block.example/private/phd", {
    robotsRequest: async () => ({ status: 200, location: null, type: "text/plain", body: Buffer.from("User-agent: *\nDisallow: /private") }),
    request: async () => { throw new Error("disallowed page must not be fetched"); },
  }), { code: "ROBOTS", message: /Disallow rule matched \/private/ });
  await assert.rejects(fetchPublicHtml("https://unique-robots-ssrf.example/open", {
    robotsRequest: async () => ({ status: 301, location: "http://127.0.0.1/robots.txt", type: "text/plain", body: Buffer.alloc(0) }),
    request: async () => { throw new Error("page must not be fetched"); },
  }), { code: "SSRF" });
});

test("fetcher validates redirects, robots policy, HTTP status, and timeout failures", async () => {
  let calls = 0;
  await assert.rejects(fetchPublicHtml("https://public.example/path", {
    robots: async () => true,
    request: async () => { calls += 1; return { status: 302, location: "http://127.0.0.1/private", type: "", body: Buffer.alloc(0) }; },
  }), { code: "SSRF" });
  assert.equal(calls, 1);
  await assert.rejects(fetchPublicHtml("https://public.example/path", {
    robots: async () => false,
    request: async () => { throw new Error("should not request"); },
  }), { code: "ROBOTS" });
  await assert.rejects(fetchPublicHtml("https://public.example/path", {
    robots: async () => true,
    request: async () => ({ status: 503, location: null, type: "text/html", body: Buffer.from("unavailable") }),
  }), { code: "HTTP" });
  await assert.rejects(fetchPublicHtml("https://public.example/path", {
    robots: async () => true,
    request: async () => { throw new PageFetchError("Page request timed out.", "TIMEOUT"); },
  }), { code: "TIMEOUT" });
});

test("HTML text extraction removes active content and decodes entities", () => {
  assert.equal(extractReadableText("<h1>Funded &amp; open</h1><script>alert(1)</script><p>Apply now</p>"), "Funded & open\nApply now");
});

test("unchanged content hashes skip extraction and evidence is preserved", () => {
  assert.equal(isUnchangedContent("same", "same"), true);
  assert.equal(isUnchangedContent("old", "new"), false);
  const previous = [{ field: "funding", excerpt: "Full tuition" }];
  assert.deepEqual(mergeEvidence(previous, [{ field: "funding", excerpt: "Full tuition" }, { field: "deadline", excerpt: "Apply by June 1" }]), [previous[0], { field: "deadline", excerpt: "Apply by June 1" }]);
});

test("Gemini failure uses clearly labeled Tavily rules fallback", async () => {
  const candidate: CandidateEvidence = { title: "PhD studentship", url: "https://example.edu", content: "Fully funded PhD studentship with stipend." };
  const brokenProvider: OpportunityExtractionProvider = { name: "gemini", async extract() { throw new Error("Gemini unavailable"); } };
  const result = await extractWithFallback(candidate, false, () => brokenProvider);
  assert.equal(result.method, "tavily-fallback+gemini-failed+rules-fallback");
  assert.match(result.error ?? "", /Gemini unavailable/);
});

test("only legacy bare Gemini 404 notes qualify for a one-time retry", () => {
  assert.equal(isLegacyGemini404("Gemini extraction failed with HTTP 404."), true);
  assert.equal(isLegacyGemini404("Gemini extraction failed with HTTP 404. Model 'gemini-3.5-flash-lite' unavailable."), false);
  assert.equal(isLegacyGemini404("Gemini extraction failed with HTTP 503."), false);
});

test("Gemini claims need exact source evidence and full funding evidence", () => {
  const candidate: CandidateEvidence = { title: "PhD", url: "https://example.edu", content: "A scholarship is available for PhD applicants." };
  const parsed = validateGeminiOutput({ country: "Canada", evidence: [
    { field: "country", value: "Canada", excerpt: "Canada" },
    { field: "funding", value: "scholarship", excerpt: "A scholarship is available for PhD applicants." },
  ] }, candidate);
  assert.equal(parsed.country, null);
  assert.equal(parsed.fundingClassification, "UNCLEAR");
  assert.equal(parsed.evidenceExcerpts[0]?.sourceUrl, candidate.url);
});

test("Gemini accepts a normalized ISO deadline only when the same date appears in its source excerpt", () => {
  const candidate: CandidateEvidence = { title: "CS PhD position", url: "https://example.edu/lab", content: "Applications close December 1, 2026. The lab recruits computer science PhD students." };
  const parsed = validateGeminiOutput({ evidence: [
    { field: "deadline", value: "2026-12-01", excerpt: "Applications close December 1, 2026." },
  ] }, candidate);
  assert.equal(parsed.deadline?.toISOString().slice(0, 10), "2026-12-01");

  assert.throws(() => validateGeminiOutput({ evidence: [
    { field: "deadline", value: "2027-12-01", excerpt: "Applications close December 1, 2026." },
  ] }, candidate), /no claims with verifiable source evidence/);
});

test("partial Gemini extraction is completed with conservative source rules", async () => {
  const candidate: CandidateEvidence = {
    title: "PhD studentship in machine learning",
    url: "https://example.edu/lab",
    content: "Professor Jane Doe is recruiting computer science PhD students. Fully funded with tuition and a stipend.",
  };
  const provider: OpportunityExtractionProvider = {
    name: "gemini-v2",
    async extract() {
      return validateGeminiOutput({ evidence: [
        { field: "supervisor", value: "Professor Jane Doe", excerpt: "Professor Jane Doe is recruiting computer science PhD students." },
      ] }, candidate);
    },
  };
  const result = await extractWithFallback(candidate, true, () => provider);
  assert.equal(result.method, "page+gemini-v2+rules-fill");
  assert.equal(result.result.supervisorName, "Professor Jane Doe");
  assert.equal(result.result.degreeLevel, "PhD");
  assert.match(result.result.fundingEvidence ?? "", /Fully funded with tuition and a stipend/);
  assert.equal(result.result.fundingClassification, "FULL");
  assert.equal(result.error, null);
});

test("Gemini HTTP/API failures throw to the fallback handler", async () => {
  const provider = new GeminiExtractionProvider("test-only", async () => new Response("{}", { status: 503 }));
  await assert.rejects(provider.extract({ title: "PhD", url: "https://example.edu", content: "Text" }), /HTTP 503/);
});

test("LangGraph Gemini page workflow returns only source-supported extraction", async () => {
  const candidate: CandidateEvidence = {
    title: "Computer vision PhD position",
    url: "https://example.edu/lab/openings",
    content: "University of Example is recruiting PhD students in computer vision. Fully funded with tuition and stipend. Apply by December 1, 2026.",
  };
  const output = { evidence: [
    { field: "institution", value: "University of Example", excerpt: "University of Example is recruiting PhD students in computer vision." },
    { field: "degreeLevel", value: "PhD", excerpt: "University of Example is recruiting PhD students in computer vision." },
    { field: "researchField", value: "computer vision", excerpt: "University of Example is recruiting PhD students in computer vision." },
    { field: "funding", value: "Fully funded with tuition and stipend", excerpt: "Fully funded with tuition and stipend." },
    { field: "deadline", value: "2026-12-01", excerpt: "Apply by December 1, 2026." },
  ] };
  const provider = new GeminiExtractionProvider("test-key", async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(output) }] } }],
  }), { status: 200 }));

  const result = await provider.extract(candidate);
  assert.equal(result.institution, "University of Example");
  assert.equal(result.degreeLevel, "PhD");
  assert.equal(result.researchField, "computer vision");
  assert.equal(result.fundingClassification, "FULL");
  assert.equal(result.deadline?.toISOString().slice(0, 10), "2026-12-01");
  assert.equal(result.evidenceExcerpts.every((item) => item.sourceUrl === candidate.url), true);
});

test("Gemini classifies exact Tavily snippet evidence and keeps snippet funding unconfirmed", async () => {
  const candidate: CandidateEvidence = {
    title: "Professor Jane Doe - Computer Science",
    url: "https://cs.example.edu/jane",
    content: "I am recruiting computer science PhD students to join my lab in Fall 2027.",
  };
  const output = {
    activeProfessorPhdRecruitment: true,
    classificationEvidence: candidate.content,
    reason: "The snippet explicitly describes active CS PhD recruitment.",
    evidence: [{ field: "researchField", value: "computer science", excerpt: candidate.content }],
  };
  const provider = new GeminiExtractionProvider("test-key", async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(output) }] } }],
  }), { status: 200 }));
  const result = await provider.classifyAndExtractSnippet(candidate);
  assert.equal(result.accepted, true);
  assert.equal(result.category, "LAB");
  assert.equal(result.result?.fundingClassification, "NO_EVIDENCE");
  assert.equal(result.result?.fundingEvidence, null);
  assert.equal(result.result?.status, "UNCERTAIN");
  assert.equal(result.result?.evidenceExcerpts.some((item) => item.field === "recruitment" && item.excerpt === candidate.content && item.sourceUrl === candidate.url), true);
});

test("Gemini rejects snippet classifications without exact positive recruitment evidence", async () => {
  const candidate: CandidateEvidence = {
    title: "Professor Jane Doe - Computer Science",
    url: "https://cs.example.edu/jane",
    content: "My research focuses on computer science. PhD students are welcome to apply.",
  };
  const output = { activeProfessorPhdRecruitment: true, classificationEvidence: "Professor is recruiting PhD students.", reason: "unsupported", evidence: [] };
  const provider = new GeminiExtractionProvider("test-key", async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(output) }] } }],
  }), { status: 200 }));
  const result = await provider.classifyAndExtractSnippet(candidate);
  assert.equal(result.accepted, false);
});

test("Gemini snippet classification API failures remain errors for retry", async () => {
  const provider = new GeminiExtractionProvider("test-key", async () => new Response("{}", { status: 503 }));
  await assert.rejects(provider.classifyAndExtractSnippet({
    title: "Professor Jane Doe computer science PhD lab",
    url: "https://cs.example.edu/jane",
    content: "Recruiting PhD students in computer science.",
  }), /HTTP 503/);
});

test("Gemini uses the configured model and includes safe provider details for 404s", async () => {
  let requestedUrl = "";
  const provider = new GeminiExtractionProvider("secret-test-key", async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({ error: { message: "Model is unavailable for this API key." } }), { status: 404 });
  }, "gemini-test-model");
  await assert.rejects(
    provider.extract({ title: "PhD", url: "https://example.edu", content: "Text" }),
    (error: unknown) => error instanceof Error
      && /HTTP 404/.test(error.message)
      && /Model is unavailable/.test(error.message)
      && !error.message.includes("secret-test-key"),
  );
  assert.match(requestedUrl, /models\/gemini-test-model:generateContent$/);
});

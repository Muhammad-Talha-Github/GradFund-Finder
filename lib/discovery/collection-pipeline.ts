import { createHash, randomUUID } from "node:crypto";
import type { DatabasePool } from "@/lib/db";
import { canonicalizeUrl } from "@/lib/opportunities/domain";
import { saveDiscoveredUrl, type DiscoveredUrlReference, type DiscoveredUrlRow } from "@/lib/discovery/discovered-urls";
import { crawlSafePages, type CrawlSeed } from "@/lib/discovery/safe-crawler";
import { ingestCandidate } from "@/lib/discovery/ingest-candidate";
import { isLegacyGemini404 } from "@/lib/discovery/extraction-pipeline";
import { isExcludedRecruitmentSource, isPlausibleProfessorPhdSnippet, isProfessorPhdRecruitmentPost, isProfessorOrLabLead } from "@/lib/discovery/lead-classification";
import { GeminiExtractionProvider } from "@/lib/extraction/gemini-extractor";
import { createSnippetClassificationCacheMarker, hasSnippetClassificationCache } from "@/lib/discovery/snippet-classification-cache";
import { getWebSearchProvider } from "@/lib/search/tavily-provider";
import type { RawSearchResult } from "@/lib/search/types";

function envLimit(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.trunc(value))) : fallback;
}


export type CollectionSummary = {
  id: string;
  status: string;
  urlsRetrieved: number;
  urlsDiscovered: number;
  urlsStored: number;
  pagesCrawled: number;
  pagesBlocked: number;
  pagesFailed: number;
  pagesDeferred: number;
  pagesEnriched: number;
  snippetLeadFallbacks: number;
  snippetCandidates: number;
  snippetsSentToGemini: number;
  snippetsAcceptedByGemini: number;
  snippetsRejectedByGemini: number;
  snippetsCached: number;
  pendingRetry: number;
  opportunitiesCreated: number;
  pagesChanged: number;
  pagesUnchanged: number;
  opportunitiesInserted: number;
  opportunitiesUpdated: number;
  skipped: number;
  failed: number;
  errors: Array<{ source: string; error: string }>;
};

export type CollectionQuery = { name: string; query: string; maxResults?: number };

export async function runCollection(db: DatabasePool, options: { queries: CollectionQuery[]; batchSize?: number; crawlOnly?: boolean }): Promise<CollectionSummary> {
  const maxQueries = envLimit("TAVILY_MAX_QUERIES_PER_RUN", 12, 1, 12);
  const batchSize = Math.min(maxQueries, envLimit("TAVILY_QUERIES_PER_RUN", options.batchSize ?? 12, 1, 12));
  // Keep Tavily calls per run bounded, but rotate through larger query sets so
  // repeated collections discover different CS subfields and recruitment wording.
  const priorRunCount = options.crawlOnly ? 0 : Number((await db.query<{ total: number | string }>(`SELECT COUNT(*) AS total FROM "DiscoveryRun" WHERE "queryOrSource" <> 'Crawl-only refresh'`)).rows[0]?.total ?? 0);
  const queryBatchCount = Math.max(1, Math.ceil(options.queries.length / batchSize));
  const queryBatch = priorRunCount % queryBatchCount;
  const queryStart = queryBatch * batchSize;
  const queries = options.crawlOnly ? [] : Array.from({ length: Math.min(batchSize, options.queries.length) }, (_, index) => options.queries[(queryStart + index) % options.queries.length]);
  const currentRunCanonicalUrls = new Set<string>();
  let snippetGeminiProvider: GeminiExtractionProvider | null = null;
  const id = randomUUID();
  await db.query('INSERT INTO "DiscoveryRun" ("id","queryOrSource") VALUES ($1,$2)', [id, options.crawlOnly ? "Crawl-only refresh" : queries.map((item) => item.name).join("; ")]);

  const summary: CollectionSummary = { id, status: "RUNNING", urlsRetrieved: 0, urlsDiscovered: 0, urlsStored: 0, pagesCrawled: 0, pagesBlocked: 0, pagesFailed: 0, pagesDeferred: 0, pagesEnriched: 0, snippetLeadFallbacks: 0, snippetCandidates: 0, snippetsSentToGemini: 0, snippetsAcceptedByGemini: 0, snippetsRejectedByGemini: 0, snippetsCached: 0, pendingRetry: 0, opportunitiesCreated: 0, pagesChanged: 0, pagesUnchanged: 0, opportunitiesInserted: 0, opportunitiesUpdated: 0, skipped: 0, failed: 0, errors: [] };
  const recordErrors = (source: string, error: unknown) => {
    summary.failed++;
    const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Collection step failed.";
    summary.errors.push({ source, error: message.slice(0, 500) });
  };
  const saveCandidate = async (result: RawSearchResult, reference: DiscoveredUrlReference, provider: string) => {
    // Do not pollute the persistent crawl queue with known scholarship
    // directories, job aggregators, and social/advice pages.
    if (isExcludedRecruitmentSource(result.title, result.url)) { summary.skipped++; return; }
    try {
      const saved = await saveDiscoveredUrl(db, { url: result.url, title: result.title, excerpt: result.content, provider, reference });
      currentRunCanonicalUrls.add(saved.canonicalUrl);
      summary.urlsStored++;
    } catch (error) {
      summary.skipped++;
      if (error instanceof Error && !/Only public|Invalid page URL|http/i.test(error.message)) recordErrors(provider, error);
    }
  };

  if (queries.length) {
    try {
      const provider = getWebSearchProvider();
      for (const item of queries) {
        try {
          const results = await provider.search(item.query, [], envLimit("TAVILY_MAX_RESULTS_PER_QUERY", Number(item.maxResults) || 15, 1, 20));
          summary.urlsRetrieved += results.length;
          for (const result of results) {
            await saveCandidate(result, { provider: "TAVILY", query: item.query, sourceUrl: result.url }, "TAVILY");
          }
        } catch (error) { recordErrors(`Tavily: ${String(item.name)}`, error); }
      }
    } catch (error) { recordErrors("Tavily setup", error); }
  }


  // Retry pending/failed pages and refresh crawls older than the configured cadence.
  const refreshDays = envLimit("CRAWL_REFRESH_DAYS", 7, 1, 90);
  const maxPages = envLimit("CRAWL_MAX_PAGES", 200, 1, 500);
  const rootLimit = Math.min(maxPages, envLimit("CRAWL_ROOTS_PER_RUN", 200, 1, 500));
  const runUrls = [...currentRunCanonicalUrls];
  const allowedQueryValues = options.queries.map((item) => item.query);
  const crawlOnlyScope = allowedQueryValues.length
    ? `AND depth=0 AND provider='TAVILY' AND (${allowedQueryValues.map((_, index) => `JSON_SEARCH(source_references,'one',$${index + 4},NULL,'$[*].query') IS NOT NULL`).join(" OR ")})`
    : "AND 1=0";
  const runScopeSql = options.crawlOnly
    ? crawlOnlyScope
    : runUrls.length ? `AND canonical_url IN (${runUrls.map((_, index) => `$${index + 4}`).join(",")})` : "AND 1=0";
  const scopeValues = options.crawlOnly ? allowedQueryValues : runUrls;
  const geminiBackfillSql = `EXISTS (
          SELECT 1 FROM "Opportunity" o
          WHERE (o."id"=discovered_urls.opportunity_id OR o."canonicalUrl"=discovered_urls.canonical_url)
            AND (
              ((o."researchField" IS NULL OR o."institution" IS NULL OR o."degreeLevel" IS NULL OR o."fundingEvidence" IS NULL OR o."deadline" IS NULL OR o."eligibilityRequirements" IS NULL)
                AND COALESCE(o."extractionMethod",'') NOT LIKE '%gemini-v3%'
                AND (o."extractionError" IS NULL OR o."lastExtractionAt" < DATE_SUB(NOW(), INTERVAL 1 DAY)))
              OR (o."extractionError" LIKE '%Gemini extraction failed with HTTP 404.%'
                AND o."extractionError" NOT LIKE '%Model %')
            )
        )`;
  const roots = await db.query<DiscoveredUrlRow>(
    `SELECT * FROM discovered_urls
     WHERE (status='PENDING'
        OR (status='DEFERRED' AND next_attempt_at IS NOT NULL AND next_attempt_at <= NOW() AND attempts < 3)
        OR (status='CRAWLING' AND updated_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE))
        OR (status IN ('CRAWLED','UNCHANGED') AND enrichment_error IS NOT NULL AND attempts < 3 AND (next_attempt_at IS NULL OR next_attempt_at <= NOW()))
        OR (status IN ('CRAWLED','UNCHANGED') AND last_crawled_at < DATE_SUB(NOW(), INTERVAL $1 DAY))
        OR (canonical_url IN (${(options.crawlOnly ? [] : runUrls).map((_, index) => `$${index + 4}`).join(",") || "NULL"}) AND status IN ('CRAWLED','UNCHANGED') AND opportunity_id IS NULL)
        OR ($3::boolean AND status IN ('CRAWLED','UNCHANGED') AND ${geminiBackfillSql})) ${runScopeSql}
     ORDER BY CASE WHEN $3::boolean AND status IN ('CRAWLED','UNCHANGED') AND ${geminiBackfillSql} THEN 0
                   WHEN status='DEFERRED' THEN 1 WHEN status='PENDING' THEN 2 ELSE 3 END,created_at ASC
     LIMIT $2`,
    [refreshDays, rootLimit, process.env.EXTRACTION_PROVIDER === "gemini", ...scopeValues],
  );
  const crawlSeeds: CrawlSeed[] = roots.rows.map((row) => ({
    url: row.source_url,
    title: row.title,
    excerpt: row.excerpt ?? "",
    provider: row.provider,
    reference: (Array.isArray(row.source_references) ? row.source_references : []).at(-1) ?? { provider: row.provider },
    sourceReferences: Array.isArray(row.source_references) ? row.source_references : [],
  }));
  for (const row of roots.rows) await db.query("UPDATE discovered_urls SET status='CRAWLING',attempts=attempts+1,updated_at=NOW() WHERE id=$1", [row.id]);

  let crawl: Awaited<ReturnType<typeof crawlSafePages>> = { pages: [], failures: [], queued: [] };
  try {
    crawl = await crawlSafePages(crawlSeeds, {
      maxPages,
      maxConcurrency: envLimit("CRAWL_MAX_CONCURRENCY", 2, 1, 5),
      retries: envLimit("CRAWL_RETRIES", 1, 0, 3),
      sameDomainDelaySecs: envLimit("CRAWL_DOMAIN_DELAY_SECONDS", 1, 0, 60),
      linksPerPage: 0,
    });
  } catch (error) {
    recordErrors("Crawlee setup", error);
    const message = error instanceof Error ? error.message.slice(0, 500) : "Crawler failed.";
    for (const row of roots.rows) crawl.failures.push({ url: row.source_url, error: message, blocked: false, deferred: true, retryable: true });
  }

  // Store all discovered internal links, including those waiting for a later run.
  for (const page of crawl.pages) {
    if (page.depth === 0) continue;
    for (const reference of page.sourceReferences) await saveDiscoveredUrl(db, {
      url: page.requestedUrl, title: page.title, excerpt: page.text, provider: page.provider,
      reference: { ...reference, sourceUrl: page.parentUrl ?? reference.sourceUrl }, depth: page.depth, parentUrl: page.parentUrl,
    });
  }
  for (const link of crawl.queued) for (const reference of link.sourceReferences) await saveDiscoveredUrl(db, {
    url: link.url, title: link.title, excerpt: null, provider: link.provider,
    reference: { ...reference, sourceUrl: link.parentUrl }, depth: link.depth, parentUrl: link.parentUrl,
  });

  const rootIdByCanonical = new Map(roots.rows.map((row) => [row.canonical_url, row.id]));
  const erroredRoots = new Set<string>();
  for (const failure of crawl.failures) {
    const canonicalUrl = (() => { try { return canonicalizeUrl(failure.url); } catch { return ""; } })();
    const failedRow = await db.query<{ id: string; attempts: number }>("SELECT id,attempts FROM discovered_urls WHERE canonical_url=$1", [canonicalUrl]);
    if (failedRow.rows[0]) {
      const rowId = failedRow.rows[0].id;
      erroredRoots.add(rowId);
    }
    if (failure.blocked) summary.pagesBlocked++;
    const wasRoot = rootIdByCanonical.has(canonicalUrl);
    const attemptsAfterThisFailure = Number(failedRow.rows[0]?.attempts ?? 0) + (wasRoot ? 0 : 1);
    const willDefer = failure.retryable && attemptsAfterThisFailure < 3;
    if (!failure.blocked) {
      if (willDefer) summary.pagesDeferred++;
      else summary.pagesFailed++;
    }
    recordErrors(failure.url, failure.error);
    const failedRoot = roots.rows.find((root) => root.canonical_url === canonicalUrl);
    const snippet = failedRoot?.excerpt?.trim() ?? "";
    // A search-provider excerpt can preserve a useful lead, but never bypasses
    // robots or converts the page into a verified/funded opportunity.
    const geminiSnippetMode = process.env.EXTRACTION_PROVIDER === "gemini" && Boolean(process.env.GEMINI_API_KEY?.trim());
    const snippetPassesGate = geminiSnippetMode
      ? isPlausibleProfessorPhdSnippet(failedRoot?.title ?? "", snippet, failedRoot?.source_url)
      : isProfessorOrLabLead(failedRoot?.title ?? "", snippet, failedRoot?.source_url);
    if (failedRoot && snippet && snippetPassesGate) {
      try {
        const contentHash = createHash("sha256").update(snippet).digest("hex");
        const existingCandidate = await db.query<{ errorDetails: string | null }>(
          'SELECT "errorDetails" FROM "DiscoveryCandidate" WHERE "canonicalUrl"=$1',
          [canonicalUrl],
        );
        const cacheMarker = existingCandidate.rows[0]?.errorDetails ?? "";
        const cacheHit = geminiSnippetMode && hasSnippetClassificationCache(cacheMarker, contentHash);
        if (cacheHit) {
          summary.snippetsCached++;
        } else if (geminiSnippetMode) {
          summary.snippetCandidates++;
          summary.snippetsSentToGemini++;
          const candidate = { title: failedRoot.title, url: failedRoot.source_url, sourceUrl: failedRoot.source_url, content: snippet };
          snippetGeminiProvider ??= new GeminiExtractionProvider(process.env.GEMINI_API_KEY!);
          const classification = await snippetGeminiProvider.classifyAndExtractSnippet(candidate);
          const decision = classification.accepted ? "ACCEPTED" : "REJECTED";
          const marker = createSnippetClassificationCacheMarker(decision, contentHash, failure.error);
          if (!classification.accepted || !classification.result || !classification.category) {
            summary.snippetsRejectedByGemini++;
            summary.skipped++;
            await db.query(
              `INSERT INTO "DiscoveryCandidate" ("id","canonicalUrl","sourceUrl","title","excerpt","discoveredVia","runId","lastDiscoveredAt","errorDetails","updatedAt")
               VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),$8,NOW())
               ON DUPLICATE KEY UPDATE "sourceUrl"=VALUES("sourceUrl"),"title"=VALUES("title"),"excerpt"=VALUES("excerpt"),"discoveredVia"=VALUES("discoveredVia"),"runId"=VALUES("runId"),"lastDiscoveredAt"=NOW(),"errorDetails"=VALUES("errorDetails"),"updatedAt"=NOW()`,
              [randomUUID(), canonicalUrl, failedRoot.source_url, failedRoot.title.slice(0, 1000), snippet.slice(0, 8000), "Tavily snippet classified by Gemini; no supported active recruitment evidence", id, marker],
            );
          } else {
            summary.snippetsAcceptedByGemini++;
            const ingested = await ingestCandidate(db, candidate, {
              runId: id,
              discoveredVia: `Tavily snippet + Gemini classification (${failure.blocked ? "page robots-blocked" : "page fetch failed"})`,
              sourceReferences: failedRoot.source_references,
              prefetched: {
                finalUrl: failedRoot.source_url,
                text: snippet,
                contentHash,
                isFetched: false,
                fetchError: `Page not fetched; Tavily snippet + Gemini classification fallback only. ${failure.error}`,
              },
              snippetExtraction: {
                result: classification.result,
                method: "tavily-snippet+gemini-v3-classified",
                category: classification.category,
              },
            });
            await db.query('UPDATE "DiscoveryCandidate" SET "errorDetails"=$1,"updatedAt"=NOW() WHERE "canonicalUrl"=$2', [marker, canonicalUrl]);
            summary.snippetLeadFallbacks++;
            if (ingested.enriched) summary.pagesEnriched++;
            if (ingested.action === "inserted") summary.opportunitiesInserted++;
            else if (ingested.action === "updated") summary.opportunitiesUpdated++;
            else summary.skipped++;
          }
        } else {
        const ingested = await ingestCandidate(db, {
          title: failedRoot.title,
          url: failedRoot.source_url,
          content: snippet,
        }, {
          runId: id,
          discoveredVia: `TAVILY snippet fallback (${failure.blocked ? "robots blocked" : "page fetch failed"})`,
          sourceReferences: failedRoot.source_references,
          prefetched: {
            finalUrl: failedRoot.source_url,
            text: snippet,
            contentHash,
            isFetched: false,
            fetchError: `Page not fetched; Tavily snippet fallback only. ${failure.error}`,
          },
        });
        summary.snippetLeadFallbacks++;
        if (ingested.enriched) summary.pagesEnriched++;
        if (ingested.action === "inserted") summary.opportunitiesInserted++;
        else if (ingested.action === "updated") summary.opportunitiesUpdated++;
        else summary.skipped++;
        }
      } catch (error) {
        recordErrors(`${failure.url} snippet fallback`, error);
      }
    }
    await db.query(
      `UPDATE discovered_urls
       SET status=$1, attempts=attempts+$2, crawl_error=$3, last_crawled_at=NOW(),
           next_attempt_at=$4,
           updated_at=NOW()
       WHERE canonical_url=$5`,
      [failure.blocked ? "BLOCKED" : willDefer ? "DEFERRED" : "FAILED", wasRoot ? 0 : 1, failure.error.slice(0, 500), willDefer ? new Date(Date.now() + Math.min(86_400_000, 300_000 * 2 ** Math.max(0, attemptsAfterThisFailure - 1))) : null, canonicalUrl],
    );
  }

  for (const page of crawl.pages) {
    summary.pagesCrawled++;
    const requestedCanonical = canonicalizeUrl(page.requestedUrl);
    const existing = await db.query<{ id: string; content_hash: string | null; last_enriched_at: Date | null; researchField: string | null; institution: string | null; degreeLevel: string | null; fundingEvidence: string | null; deadline: Date | null; eligibilityRequirements: string | null; extractionMethod: string | null; extractionError: string | null }>(
      `SELECT d.id,d.content_hash,d.last_enriched_at,o."researchField",o."institution",o."degreeLevel",o."fundingEvidence",o."deadline",o."eligibilityRequirements",o."extractionMethod",o."extractionError"
       FROM discovered_urls d LEFT JOIN LATERAL (
         SELECT * FROM "Opportunity" candidate WHERE candidate."id"=d.opportunity_id OR candidate."canonicalUrl"=d.canonical_url
         ORDER BY (candidate."id"=d.opportunity_id) DESC LIMIT 1
       ) o ON true WHERE d.canonical_url=$1`,
      [requestedCanonical],
    );
    const row = existing.rows[0];
    const changed = !row?.content_hash || row.content_hash !== page.contentHash;
    if (changed) summary.pagesChanged++; else summary.pagesUnchanged++;
    const promising = isProfessorPhdRecruitmentPost(page.title, page.text, page.finalUrl);
    let opportunityId: string | null = null;
    let enrichmentError: string | null = null;
    const missingFields = [row?.researchField, row?.institution, row?.degreeLevel, row?.fundingEvidence, row?.deadline, row?.eligibilityRequirements].some((value) => value === null || value === undefined || value === "");
    const geminiBackfill = process.env.EXTRACTION_PROVIDER === "gemini"
      && ((missingFields && !String(row?.extractionMethod ?? "").includes("gemini-v3")) || isLegacyGemini404(row?.extractionError));
    let didEnrich = false;
    if (promising && (changed || !row?.last_enriched_at || geminiBackfill)) {
      try {
        const result = { title: page.title, url: page.finalUrl, content: page.text };
        const ingested = await ingestCandidate(db, result, {
          runId: id,
          discoveredVia: `${page.provider} crawl depth ${page.depth}`,
          sourceReferences: page.sourceReferences,
          prefetched: { finalUrl: page.finalUrl, text: page.text, contentHash: page.contentHash },
        });
        didEnrich = Boolean(ingested.enriched);
        if (didEnrich) summary.pagesEnriched++;
        if (ingested.action === "inserted") summary.opportunitiesInserted++;
        else if (ingested.action === "updated") summary.opportunitiesUpdated++;
        else summary.skipped++;
        const found = await db.query<{ id: string }>('SELECT "id" FROM "Opportunity" WHERE "canonicalUrl"=$1', [canonicalizeUrl(page.finalUrl)]);
        opportunityId = found.rows[0]?.id ?? null;
      } catch (error) {
        enrichmentError = error instanceof Error ? error.message.slice(0, 500) : "Page enrichment failed.";
        recordErrors(page.finalUrl, error);
      }
    } else if (!promising) summary.skipped++;

    const rowId = row?.id ?? rootIdByCanonical.get(requestedCanonical);
    const root = roots.rows.find((candidate) => candidate.canonical_url === requestedCanonical);
    const attemptAfterThisPage = Number(root?.attempts ?? 0) + 1;
    const retryEnrichment = Boolean(enrichmentError && root && attemptAfterThisPage < 3);
    const pageStatus = enrichmentError ? (retryEnrichment ? "DEFERRED" : "FAILED") : changed ? "CRAWLED" : "UNCHANGED";
    const retryAt = retryEnrichment ? new Date(Date.now() + Math.min(86_400_000, 300_000 * 2 ** Math.max(0, attemptAfterThisPage - 1))) : null;
    if (enrichmentError) {
      if (retryEnrichment) summary.pagesDeferred++;
      else summary.pagesFailed++;
    }
    if (rowId) await db.query(
      `UPDATE discovered_urls SET status=$1,content_hash=$2,opportunity_id=COALESCE($3,opportunity_id),last_crawled_at=NOW(),last_enriched_at=CASE WHEN $4 THEN NOW() ELSE last_enriched_at END,crawl_error=NULL,enrichment_error=$5,next_attempt_at=$6,updated_at=NOW() WHERE id=$7`,
      [pageStatus, page.contentHash, opportunityId, didEnrich, enrichmentError, retryAt, rowId],
    );
  }
  for (const row of roots.rows) if (!erroredRoots.has(row.id) && !crawl.pages.some((page) => canonicalizeUrl(page.requestedUrl) === row.canonical_url)) {
    const willDefer = row.attempts + 1 < 3;
    if (willDefer) summary.pagesDeferred++; else summary.pagesFailed++;
    await db.query("UPDATE discovered_urls SET status=$1,crawl_error=COALESCE(crawl_error,'Crawl request did not complete.'),last_crawled_at=NOW(),next_attempt_at=$2,updated_at=NOW() WHERE id=$3", [willDefer ? "DEFERRED" : "FAILED", willDefer ? new Date(Date.now() + Math.min(86_400_000, 300_000 * 2 ** Math.max(0, row.attempts))) : null, row.id]);
  }

  const status = summary.failed === 0 ? "COMPLETE" : summary.pagesCrawled || summary.urlsRetrieved ? "PARTIAL" : "FAILED";
  const queueCounts = await db.query<{ pending: string; retryable: string }>(
    `SELECT SUM(status='PENDING') AS pending,
            SUM(status='DEFERRED' AND next_attempt_at IS NOT NULL) AS retryable
     FROM discovered_urls`,
  );
  summary.pendingRetry = Number(queueCounts.rows[0]?.pending ?? 0) + Number(queueCounts.rows[0]?.retryable ?? 0);
  summary.urlsDiscovered = summary.urlsRetrieved;
  summary.opportunitiesCreated = summary.opportunitiesInserted;
  summary.status = status;
  await db.query(
    'UPDATE "DiscoveryRun" SET "status"=$1::"DiscoveryRunStatus","endedAt"=NOW(),"candidatesDiscovered"=$2,"recordsInserted"=$3,"recordsUpdated"=$4,"recordsSkipped"=$5,"duplicatesSkipped"=$5,"failures"=$6,"errors"=$7::jsonb WHERE "id"=$8',
    [status, summary.urlsRetrieved, summary.opportunitiesInserted, summary.opportunitiesUpdated, summary.skipped, summary.failed, JSON.stringify(summary.errors), id],
  );
  return summary;
}


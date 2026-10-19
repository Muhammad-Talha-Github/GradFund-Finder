import { createHash, randomUUID } from "node:crypto";
import type { DatabasePool as Pool } from "@/lib/db";
import { canonicalizeUrl, normalizeTitle } from "@/lib/opportunities/domain";
import { getExtractionProvider } from "@/lib/extraction/evidence-extractor";
import { fetchPublicHtml, PageFetchError } from "@/lib/fetching/safe-page-fetch";
import { extractWithFallback, isLegacyGemini404, isUnchangedContent, mergeEvidence } from "@/lib/discovery/extraction-pipeline";
import type { ExtractedOpportunity } from "@/lib/extraction/types";
import { categorizeLead, describeResearchLead, identifyDepartment, identifyLabGroup, isExcludedRecruitmentSource, isProfessorPhdRecruitmentPost } from "@/lib/discovery/lead-classification";
import type { RawSearchResult } from "@/lib/search/types";

type OpportunityRow = {
  [key: string]: unknown;
  id: string;
  canonicalUrl: string;
  contentHash: string | null;
  fundingClassification: string;
  status: string;
  evidenceExcerpts: unknown;
  description: string | null;
  department: string | null;
  labGroup: string | null;
  category: string;
};

type IngestResult = { action: "inserted" | "updated" | "skipped"; reason?: string; enriched?: boolean };
type IngestContext = {
  runId: string;
  discoveredVia: string;
  sourceReferences?: Array<{ provider: string; sourceUrl?: string }>;
  prefetched?: { finalUrl: string; text: string; contentHash: string; isFetched?: boolean; fetchError?: string };
  snippetExtraction?: { result: ExtractedOpportunity; method: string; category: "PROFESSOR" | "LAB" };
};

async function upsertSourceLink(db: Pool, values: { opportunityId: string; sourceUrl: string; canonicalUrl: string; sourceHost: string; discoveredVia: string; contentHash: string; checkedAt?: Date }) {
  const now = values.checkedAt ?? new Date();
  await db.query(
    `INSERT INTO "OpportunitySource" ("id","opportunityId","sourceUrl","canonicalUrl","sourceHost","discoveredVia","contentHash","lastCheckedAt","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$8)
     ON DUPLICATE KEY UPDATE "sourceUrl"=VALUES("sourceUrl"), "discoveredVia"=VALUES("discoveredVia"), "contentHash"=VALUES("contentHash"), "lastCheckedAt"=VALUES("lastCheckedAt"), "updatedAt"=VALUES("updatedAt")`,
    [randomUUID(), values.opportunityId, values.sourceUrl, values.canonicalUrl, values.sourceHost, values.discoveredVia, values.contentHash, now],
  );
}

export async function ingestCandidate(db: Pool, result: RawSearchResult, context: IngestContext): Promise<IngestResult> {
  let canonicalUrl: string;
  try { canonicalUrl = canonicalizeUrl(result.url); } catch { return { action: "skipped", reason: "invalid-url" }; }
  if (!result.title.trim()) return { action: "skipped", reason: "missing-title" };
  const sourceHost = new URL(canonicalUrl).hostname;
  const normalizedTitle = normalizeTitle(result.title);
  let found = await db.query<OpportunityRow>('SELECT * FROM "Opportunity" WHERE "canonicalUrl"=$1', [canonicalUrl]);
  if (!found.rowCount && normalizedTitle.length > 12) found = await db.query<OpportunityRow>('SELECT * FROM "Opportunity" WHERE "normalizedTitle"=$1 AND "sourceHost"=$2 LIMIT 1', [normalizedTitle, sourceHost]);
  const existing = found.rows[0];

  let pageFetched = Boolean(context.prefetched) && context.prefetched?.isFetched !== false;
  let sourceUrl = context.prefetched?.finalUrl ?? result.url;
  let sourceText = context.prefetched?.text.slice(0, 30_000) ?? result.content.slice(0, 10_000);
  let fetchError: string | null = context.prefetched?.fetchError?.slice(0, 500) ?? null;
  if (!context.prefetched) {
    try {
      const page = await fetchPublicHtml(result.url);
      sourceUrl = page.finalUrl; sourceText = page.text.slice(0, 30_000); pageFetched = true;
    } catch (error) {
      if (error instanceof PageFetchError && (error.code === "SSRF" || /HTTP (?:404|410)\b/.test(error.message))) return { action: "skipped", reason: error.code === "SSRF" ? "unsafe-url" : "page-not-found" };
      fetchError = error instanceof Error ? error.message.slice(0, 500) : "Public page fetch failed.";
    }
  }
  if ((!context.snippetExtraction && !isProfessorPhdRecruitmentPost(result.title, sourceText, result.url)) || isExcludedRecruitmentSource(result.title, result.url)) return { action: "skipped", reason: "not-an-active-professor-phd-recruitment-post" };

  const now = new Date();
  const candidateId = randomUUID();
  await db.query(
    `INSERT INTO "DiscoveryCandidate" ("id","canonicalUrl","sourceUrl","title","excerpt","discoveredVia","runId","lastDiscoveredAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
     ON DUPLICATE KEY UPDATE "sourceUrl"=VALUES("sourceUrl"), "title"=VALUES("title"), "excerpt"=VALUES("excerpt"), "discoveredVia"=VALUES("discoveredVia"), "lastDiscoveredAt"=VALUES("lastDiscoveredAt"), "runId"=VALUES("runId"), "status"='DISCOVERED', "errorDetails"=NULL, "updatedAt"=VALUES("updatedAt")`,
    [candidateId, canonicalUrl, result.url, result.title.slice(0, 1000), result.content.slice(0, 8000) || null, context.discoveredVia, context.runId, now],
  );
  const savedCandidate = await db.query<{ id: string }>('SELECT "id" FROM "DiscoveryCandidate" WHERE "canonicalUrl"=$1', [canonicalUrl]);
  if (!savedCandidate.rows[0]) throw new Error("The discovery candidate could not be saved.");
  const savedCandidateId = savedCandidate.rows[0].id;
  const contentHash = context.prefetched?.contentHash ?? createHash("sha256").update(sourceText).digest("hex");
  try {
    const priorLink = existing ? await db.query<{ contentHash: string | null }>('SELECT "contentHash" FROM "OpportunitySource" WHERE "opportunityId"=$1 AND "canonicalUrl"=$2', [existing.id, canonicalUrl]) : null;
    const sourceWasAdded = Boolean(existing && !priorLink?.rowCount);
    const priorHash = priorLink?.rows[0]?.contentHash ?? (existing?.canonicalUrl === canonicalUrl ? existing.contentHash : null);
    const missingStructuredData = existing && ["researchField", "institution", "degreeLevel", "fundingEvidence", "deadline", "eligibilityRequirements"]
      .some((field) => existing[field] === null || existing[field] === undefined || existing[field] === "");
    const shouldBackfillWithGemini = process.env.EXTRACTION_PROVIDER === "gemini"
      && ((Boolean(missingStructuredData) && !String(existing?.extractionMethod ?? "").includes("gemini-v3")) || isLegacyGemini404(existing?.extractionError));
    if (existing && isUnchangedContent(priorHash, contentHash) && !shouldBackfillWithGemini) {
      await upsertSourceLink(db, { opportunityId: existing.id, sourceUrl: result.url, canonicalUrl, sourceHost, discoveredVia: context.discoveredVia, contentHash, checkedAt: now });
      await db.query('UPDATE "Opportunity" SET "lastCheckedAt"=$1,"updatedAt"=$1 WHERE "id"=$2', [now, existing.id]);
      await db.query('UPDATE "DiscoveryCandidate" SET "opportunityId"=$1,"status"=$2::"CandidateStatus","updatedAt"=$3 WHERE "id"=$4', [existing.id,"DUPLICATE",now,savedCandidateId]);
      return { action: "skipped", reason: "unchanged", enriched: false };
    }

    const pipeline = context.snippetExtraction
      ? { result: context.snippetExtraction.result, method: context.snippetExtraction.method, error: null }
      : await extractWithFallback({ title: result.title, url: result.url, sourceUrl, content: sourceText }, pageFetched, getExtractionProvider);
    const extracted = pipeline.result;
    const extractionError = [fetchError, pipeline.error].filter(Boolean).join("; ").slice(0, 1000) || null;
    const category = context.snippetExtraction?.category ?? categorizeLead(result.title, sourceText, sourceUrl);
    const description = describeResearchLead(sourceText);
    const department = identifyDepartment(sourceText);
    const labGroup = identifyLabGroup(sourceText);
    const hash = contentHash;
    let opportunityId: string;
    let changed = false;
    let opportunityInserted = false;
    if (existing) {
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      const updates: Record<string, unknown> = {
        lastCheckedAt: now, lastSuccessfulExtractionAt: now, extractionStatus: "NEEDS_REVIEW", extractionMethod: pipeline.method,
        extractionError, lastExtractionAt: now, verificationStatus: "UNVERIFIED", errorDetails: null,
        contentHash: pageFetched ? hash : existing.contentHash, updatedAt: now,
        evidenceExcerpts: JSON.stringify(mergeEvidence(existing.evidenceExcerpts, extracted.evidenceExcerpts)),
      };
      const fields: Array<[string, unknown]> = [
        ["title", result.title.slice(0,1000)], ["institution", extracted.institution], ["country", extracted.country], ["degreeLevel", extracted.degreeLevel], ["researchField", extracted.researchField],
        ["fundingType", extracted.fundingType], ["fundingEvidence", extracted.fundingEvidence], ["eligibilityRequirements", extracted.eligibilityRequirements],
        ["deadline", extracted.deadline], ["intakeTerm", extracted.intakeTerm], ["intakeYear", extracted.intakeYear], ["supervisorName", extracted.supervisorName], ["contactEmail", extracted.contactEmail],
        ["description", description && !existing.description ? description : null], ["department", department && !existing.department ? department : null],
        ["labGroup", labGroup && !existing.labGroup ? labGroup : null], ["category", existing.category === "OTHER" ? category : null],
      ];
      for (const [key, value] of fields) if (value !== null && value !== "" && existing[key] !== value) { changes[key] = { from: existing[key] ?? null, to: value }; updates[key] = value; }
      const conflict = existing.fundingClassification === "FULL" && extracted.fundingClassification === "PARTIAL" || existing.fundingClassification === "PARTIAL" && extracted.fundingClassification === "FULL";
      if (conflict) { changes.fundingClassification = { from: existing.fundingClassification, to: "UNCLEAR" }; updates.fundingClassification = "UNCLEAR"; }
      else if (existing.fundingClassification === "NO_EVIDENCE" || existing.fundingClassification === "UNCLEAR" && extracted.fundingClassification !== "NO_EVIDENCE") {
        if (existing.fundingClassification !== extracted.fundingClassification) { changes.fundingClassification = { from: existing.fundingClassification, to: extracted.fundingClassification }; updates.fundingClassification = extracted.fundingClassification; }
      }
      if (extracted.status !== "UNCERTAIN" && extracted.status !== existing.status) { changes.status = { from: existing.status, to: extracted.status }; updates.status = extracted.status; }
      const set = Object.keys(updates).map((key, i) => `"${key}"=$${i+1}`).join(", ");
      await db.query(`UPDATE "Opportunity" SET ${set} WHERE "id"=$${Object.keys(updates).length+1}`, [...Object.values(updates), existing.id]);
      opportunityId = existing.id;
      changed = Object.keys(changes).length > 0 || sourceWasAdded || !isUnchangedContent(priorHash, hash);
      if (changed) await db.query('INSERT INTO "OpportunityChange" ("id","opportunityId","changes") VALUES ($1,$2,$3::jsonb)', [randomUUID(),existing.id,JSON.stringify(changes)]);
    } else {
      const columns = ["id","canonicalUrl","sourceUrl","sourceHost","normalizedTitle","title","institution","description","department","labGroup","category","country","degreeLevel","researchField","fundingType","fundingEvidence","fundingClassification","eligibilityRequirements","deadline","intakeTerm","intakeYear","supervisorName","contactEmail","evidenceExcerpts","status","discoveryDate","lastCheckedAt","lastSuccessfulExtractionAt","extractionStatus","extractionMethod","extractionError","lastExtractionAt","verificationStatus","contentHash","createdAt","updatedAt"];
      const values = [randomUUID(),canonicalUrl,sourceUrl,new URL(sourceUrl).hostname,result.title?normalizeTitle(result.title):"",result.title.slice(0,1000),extracted.institution,description,department,labGroup,category,extracted.country,extracted.degreeLevel,extracted.researchField,extracted.fundingType,extracted.fundingEvidence,extracted.fundingClassification,extracted.eligibilityRequirements,extracted.deadline,extracted.intakeTerm,extracted.intakeYear,extracted.supervisorName,extracted.contactEmail,JSON.stringify(extracted.evidenceExcerpts),extracted.status,now,now,now,"NEEDS_REVIEW",pipeline.method,extractionError,now,"UNVERIFIED",hash,now,now];
      const opportunityIdForInsert = String(values[0]);
      const created = await db.query(`INSERT IGNORE INTO "Opportunity" (${columns.map((c)=>`"${c}"`).join(",")}) VALUES (${columns.map((_, index)=>`$${index + 1}`).join(",")})`,values);
      if (created.rowCount > 0) { opportunityId=opportunityIdForInsert; opportunityInserted=true; changed=true; }
      else {
        const raced = await db.query<{ id: string }>('SELECT "id" FROM "Opportunity" WHERE "canonicalUrl"=$1',[canonicalUrl]);
        if (!raced.rows[0]) throw new Error("The opportunity could not be saved after a concurrent discovery.");
        opportunityId=raced.rows[0].id;
      }
    }
    await upsertSourceLink(db,{opportunityId,sourceUrl:result.url,canonicalUrl,sourceHost,discoveredVia:context.discoveredVia,contentHash,checkedAt:now});
    for (const reference of context.sourceReferences ?? []) {
      if (!reference.sourceUrl || reference.sourceUrl === result.url) continue;
      try {
        const referenceCanonical = canonicalizeUrl(reference.sourceUrl);
        await upsertSourceLink(db, {
          opportunityId,
          sourceUrl: reference.sourceUrl,
          canonicalUrl: referenceCanonical,
          sourceHost: new URL(referenceCanonical).hostname,
          discoveredVia: reference.provider,
          contentHash,
          checkedAt: now,
        });
      } catch { /* Keep invalid external references out of opportunity source links. */ }
    }
    if (sourceUrl !== result.url) {
      const finalCanonical = canonicalizeUrl(sourceUrl);
      await upsertSourceLink(db,{opportunityId,sourceUrl,canonicalUrl:finalCanonical,sourceHost:new URL(finalCanonical).hostname,discoveredVia:context.discoveredVia,contentHash,checkedAt:now});
    }
    await db.query('UPDATE "DiscoveryCandidate" SET "opportunityId"=$1,"status"=$2::"CandidateStatus","updatedAt"=$3 WHERE "id"=$4',[opportunityId,existing||!opportunityInserted?"DUPLICATE":"IMPORTED",now,savedCandidateId]);
    return { action: existing ? (changed ? "updated" : "skipped") : opportunityInserted ? "inserted" : "updated", enriched: true };
  } catch (error) {
    await db.query('UPDATE "DiscoveryCandidate" SET "status"=$1::"CandidateStatus","errorDetails"=$2,"updatedAt"=NOW() WHERE "id"=$3',["FAILED",error instanceof Error?error.message.slice(0,1000):"Extraction failed.",savedCandidateId]);
    throw error;
  }
}

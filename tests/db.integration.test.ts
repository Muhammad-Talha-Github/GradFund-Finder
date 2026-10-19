import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { loadEnvConfig } from "@next/env";
import { createDatabase } from "../lib/db";
import { buildOpportunitySearch } from "../lib/opportunities/search";

loadEnvConfig(process.cwd());

test("MySQL schema, parameterized CRUD, source upserts, and field filtering", { skip: !process.env.DATABASE_URL }, async () => {
  const db = createDatabase(process.env.DATABASE_URL!, { connectionLimit: 1 });
  const client = await db.connect();
  const id = randomUUID();
  const runId = randomUUID();
  const host = `integration-${id}.example.edu`;
  const canonicalUrl = `https://${host}/group`;
  try {
    await client.beginTransaction();
    const tables = await client.query<{ tableCount: number }>(
      "SELECT COUNT(*) AS tableCount FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('Opportunity','OpportunitySource','discovered_urls','DiscoveryCandidate','EmailDraft')",
    );
    assert.equal(Number(tables.rows[0]?.tableCount), 5, "the initial MySQL schema should be installed");
    const intervals = await client.query<{ recent: number; daily: number }>(
      "SELECT DATE_SUB(NOW(), INTERVAL 15 MINUTE) < NOW() AS recent, DATE_SUB(NOW(), INTERVAL 1 DAY) < NOW() AS daily",
    );
    assert.equal(Number(intervals.rows[0]?.recent), 1, "stale crawl detection should use MySQL interval syntax");
    assert.equal(Number(intervals.rows[0]?.daily), 1, "extraction backfill should use MySQL interval syntax");
    const targetQuery = "CS faculty prospective PhD pages";
    for (const [depth, provider, source] of [[0, "TAVILY", "keyword-root"], [1, "TAVILY", "internal-link"], [0, "RSS", "non-keyword"]] as const) {
      await client.query(
        `INSERT INTO discovered_urls (id,canonical_url,source_url,title,provider,depth,source_references) VALUES ($1,$2,$2,$3,$4,$5,$6::json)`,
        [randomUUID(), `https://${host}/${source}`, source, provider, depth, JSON.stringify([{ provider, query: targetQuery }])],
      );
    }
    const keywordRoots = await client.query(
      `SELECT id FROM discovered_urls WHERE depth=0 AND provider='TAVILY' AND JSON_SEARCH(source_references,'one',$1,NULL,'$[*].query') IS NOT NULL`,
      [targetQuery],
    );
    assert.equal(keywordRoots.rowCount, 1, "crawl-only eligibility should use only depth-zero Tavily query results");
    await client.query(
      `SELECT * FROM discovered_urls
       WHERE status='PENDING'
          OR (status='DEFERRED' AND next_attempt_at IS NOT NULL AND next_attempt_at <= NOW() AND attempts < 3)
          OR (status='CRAWLING' AND updated_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE))
          OR (status IN ('CRAWLED','UNCHANGED') AND last_crawled_at < DATE_SUB(NOW(), INTERVAL $1 DAY))
          OR ($3::boolean AND status IN ('CRAWLED','UNCHANGED') AND EXISTS (
            SELECT 1 FROM Opportunity o WHERE (o.id=discovered_urls.opportunity_id OR o.canonicalUrl=discovered_urls.canonical_url)
              AND (o.researchField IS NULL OR o.institution IS NULL OR o.degreeLevel IS NULL OR o.fundingEvidence IS NULL OR o.deadline IS NULL OR o.eligibilityRequirements IS NULL)
              AND COALESCE(o.extractionMethod,'') NOT LIKE '%gemini%'
              AND (o.extractionError IS NULL OR o.lastExtractionAt < DATE_SUB(NOW(), INTERVAL 1 DAY))))
       ORDER BY CASE WHEN status='DEFERRED' THEN 0 WHEN status='PENDING' THEN 1 ELSE 2 END,created_at ASC LIMIT $2`,
      [7, 1, false],
    );

    await client.query('INSERT INTO "DiscoveryRun" ("id","queryOrSource") VALUES ($1,$2)', [runId, "integration test"]);
    await client.query(
      `INSERT INTO "Opportunity" ("id","canonicalUrl","sourceUrl","sourceHost","normalizedTitle","title","description","evidenceExcerpts","department","category","fundingClassification","status","extractionStatus","verificationStatus","discoveryDate","createdAt","updatedAt")
       VALUES ($1,$2,$2,$3,$4,$5,$6,$7::json,'Department of Computer Science','LAB','NO_EVIDENCE','UNCERTAIN','NEEDS_REVIEW','UNVERIFIED',NOW(),NOW(),NOW())`,
      [id, canonicalUrl, host, "professor computer science lab phd", "Professor Computer Science Lab", "I am recruiting PhD students to join my lab.", JSON.stringify([{ excerpt: "I am recruiting CS PhD students to join my Computer Science research lab." }])],
    );

    const sourceUrls = [`https://${host}/group`, `https://${host}/prospective-students`];
    for (const url of sourceUrls) await client.query(
      `INSERT INTO "OpportunitySource" ("id","opportunityId","sourceUrl","canonicalUrl","sourceHost","discoveredVia","contentHash","updatedAt") VALUES ($1,$2,$3,$3,$4,'integration test','hash-1',NOW())
       ON DUPLICATE KEY UPDATE "contentHash"=VALUES("contentHash"),"updatedAt"=NOW()`,
      [randomUUID(), id, url, host],
    );
    await client.query(
      `INSERT INTO "OpportunitySource" ("id","opportunityId","sourceUrl","canonicalUrl","sourceHost","discoveredVia","contentHash","updatedAt") VALUES ($1,$2,$3,$3,$4,'integration refresh','hash-2',NOW())
       ON DUPLICATE KEY UPDATE "contentHash"=VALUES("contentHash"),"updatedAt"=NOW()`,
      [randomUUID(), id, sourceUrls[0], host],
    );

    const record = await client.query<{ degreeLevel: string | null; fundingEvidence: string | null; deadline: Date | null; sourceCount: number }>(
      `SELECT o."degreeLevel",o."fundingEvidence",o."deadline",(SELECT count(*) FROM "OpportunitySource" s WHERE s."opportunityId"=o."id") AS "sourceCount" FROM "Opportunity" o WHERE o."id"=$1`, [id],
    );
    assert.equal(record.rows[0]?.degreeLevel, null);
    assert.equal(record.rows[0]?.fundingEvidence, null);
    assert.equal(record.rows[0]?.deadline, null);
    assert.equal(Number(record.rows[0]?.sourceCount), 2);

    const broad = buildOpportunitySearch(new URLSearchParams());
    const broadRows = await client.query(`SELECT o."id" FROM "Opportunity" o ${broad.where} ${broad.where ? "AND" : "WHERE"} o."id"=$1`, [id]);
    assert.equal(broadRows.rowCount, 1);
    const fieldSearch = buildOpportunitySearch(new URLSearchParams("field=Computer%20Science"));
    const fieldRows = await client.query(`SELECT o."id" FROM "Opportunity" o ${fieldSearch.where} AND o."id"=$${fieldSearch.values.length + 1}`, [...fieldSearch.values, id]);
    assert.equal(fieldRows.rowCount, 1, "field filtering should match department text when researchField is unknown");

    const duplicate = await client.query('INSERT IGNORE INTO "Opportunity" ("id","canonicalUrl","sourceUrl","sourceHost","normalizedTitle","title") VALUES ($1,$2,$2,$3,$4,$5)', [randomUUID(), canonicalUrl, host, "duplicate", "Duplicate"]);
    assert.equal(duplicate.rowCount, 0, "canonical URL uniqueness should prevent duplicate opportunities");
  } finally {
    await client.rollback();
    client.release();
    await db.end();
  }
});

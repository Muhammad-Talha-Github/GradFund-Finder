import { randomUUID } from "node:crypto";
import type { DatabasePool } from "@/lib/db";
import { canonicalizeUrl } from "@/lib/opportunities/domain";

export type DiscoveredUrlReference = {
  provider: string;
  sourceUrl?: string;
  query?: string;
  discoveredAt?: string;
};

export type DiscoveredUrlRow = {
  id: string;
  canonical_url: string;
  source_url: string;
  title: string;
  excerpt: string | null;
  provider: string;
  depth: number;
  parent_url: string | null;
  source_references: DiscoveredUrlReference[];
  status: string;
  attempts: number;
  content_hash: string | null;
  opportunity_id: string | null;
  last_crawled_at: Date | null;
  last_enriched_at: Date | null;
};

export async function saveDiscoveredUrl(
  db: DatabasePool,
  item: {
    url: string;
    title: string;
    excerpt?: string | null;
    provider: string;
    reference: DiscoveredUrlReference;
    depth?: number;
    parentUrl?: string | null;
  },
): Promise<{ canonicalUrl: string; previousHash: string | null; row: DiscoveredUrlRow }> {
  const canonicalUrl = canonicalizeUrl(item.url);
  const ref = { ...item.reference, discoveredAt: item.reference.discoveredAt ?? new Date().toISOString() };
  await db.query(
    `INSERT INTO discovered_urls
      (id,canonical_url,source_url,title,excerpt,provider,depth,parent_url,source_references,last_discovered_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,NOW(),NOW())
     ON DUPLICATE KEY UPDATE
       source_url=VALUES(source_url),
       title=CASE WHEN discovered_urls.title='' THEN VALUES(title) ELSE discovered_urls.title END,
       excerpt=COALESCE(VALUES(excerpt),discovered_urls.excerpt),
       source_references=IF(JSON_CONTAINS(discovered_urls.source_references,VALUES(source_references)),discovered_urls.source_references,JSON_MERGE_PRESERVE(discovered_urls.source_references,VALUES(source_references))),
       depth=LEAST(discovered_urls.depth,VALUES(depth)),
       parent_url=IF(VALUES(depth)=0,NULL,discovered_urls.parent_url),
       last_discovered_at=NOW(), updated_at=NOW(),
       status=CASE WHEN discovered_urls.status IN ('CRAWLED','UNCHANGED','CRAWLING','FAILED','BLOCKED') THEN discovered_urls.status ELSE 'PENDING' END
     `,
    [randomUUID(), canonicalUrl, item.url, item.title.slice(0, 1000), item.excerpt?.slice(0, 8000) ?? null, item.provider, Math.max(0, Math.min(2, item.depth ?? 0)), item.parentUrl ? canonicalizeUrl(item.parentUrl) : null, JSON.stringify([ref])],
  );
  const result = await db.query<DiscoveredUrlRow>("SELECT * FROM discovered_urls WHERE canonical_url=$1", [canonicalUrl]);
  const row = result.rows[0];
  return { canonicalUrl, previousHash: row.content_hash, row };
}


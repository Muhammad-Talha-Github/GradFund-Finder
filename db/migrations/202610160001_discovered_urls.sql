CREATE TABLE IF NOT EXISTS discovered_urls (
  id TEXT PRIMARY KEY,
  canonical_url TEXT NOT NULL UNIQUE,
  source_url TEXT NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT,
  provider TEXT NOT NULL,
  depth INTEGER NOT NULL DEFAULT 0 CHECK (depth BETWEEN 0 AND 2),
  parent_url TEXT,
  source_references JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CRAWLING','CRAWLED','UNCHANGED','FAILED')),
  content_hash TEXT,
  opportunity_id TEXT REFERENCES "Opportunity"("id") ON DELETE SET NULL,
  last_discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_crawled_at TIMESTAMPTZ,
  last_enriched_at TIMESTAMPTZ,
  crawl_error TEXT,
  enrichment_error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS discovered_urls_status_last_discovered_idx ON discovered_urls(status, last_discovered_at);
CREATE INDEX IF NOT EXISTS discovered_urls_last_crawled_idx ON discovered_urls(last_crawled_at);

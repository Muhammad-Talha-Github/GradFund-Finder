-- Distinguish robots-blocked pages from transient crawl failures and keep
-- transient retries bounded. This migration preserves all discovered URLs.
ALTER TABLE discovered_urls
  DROP CONSTRAINT IF EXISTS discovered_urls_status_check;

ALTER TABLE discovered_urls
  ADD CONSTRAINT discovered_urls_status_check
  CHECK (status IN ('PENDING','CRAWLING','CRAWLED','UNCHANGED','FAILED','BLOCKED'));

ALTER TABLE discovered_urls
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;

UPDATE discovered_urls
SET status='BLOCKED', next_attempt_at=NULL
WHERE status='FAILED'
  AND (crawl_error ILIKE '%robots policy disallows%' OR crawl_error ILIKE '%robots.txt%could not be checked%');

UPDATE discovered_urls
SET next_attempt_at=NOW()
WHERE status='FAILED' AND next_attempt_at IS NULL AND attempts < 3;

CREATE INDEX IF NOT EXISTS discovered_urls_retry_idx
  ON discovered_urls(status, next_attempt_at, attempts);

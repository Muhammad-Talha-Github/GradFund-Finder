-- Make robots policy denials distinct from temporary inability to retrieve
-- robots.txt. Keep legacy ambiguous outcomes retryable once for re-evaluation.
ALTER TABLE discovered_urls
  DROP CONSTRAINT IF EXISTS discovered_urls_status_check;

ALTER TABLE discovered_urls
  ADD CONSTRAINT discovered_urls_status_check
  CHECK (status IN ('PENDING','CRAWLING','CRAWLED','UNCHANGED','FAILED','DEFERRED','BLOCKED'));

UPDATE discovered_urls
SET status='DEFERRED', attempts=0, next_attempt_at=NOW(),
    crawl_error='Legacy robots result was ambiguous; queued for a precise robots.txt recheck.', updated_at=NOW()
WHERE status='BLOCKED'
  AND crawl_error='Robots policy disallows fetching this page or robots.txt could not be checked.';

UPDATE discovered_urls
SET status='DEFERRED'
WHERE status='FAILED' AND next_attempt_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS discovered_urls_retry_idx
  ON discovered_urls(status, next_attempt_at, attempts);

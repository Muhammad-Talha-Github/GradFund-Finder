ALTER TABLE "Source" ADD COLUMN IF NOT EXISTS "collectorType" TEXT NOT NULL DEFAULT 'TAVILY_DISCOVERY';
ALTER TABLE "Source" ADD COLUMN IF NOT EXISTS "collectorUrl" TEXT;
ALTER TABLE "Source" ADD COLUMN IF NOT EXISTS "collectionNote" TEXT;
ALTER TABLE "Source" ADD COLUMN IF NOT EXISTS "termsUrl" TEXT;

CREATE INDEX IF NOT EXISTS "Source_enabled_collectorType_idx" ON "Source"("enabled", "collectorType");

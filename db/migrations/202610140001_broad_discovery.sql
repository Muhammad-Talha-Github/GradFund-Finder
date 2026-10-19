ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "department" TEXT;
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "labGroup" TEXT;
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT 'OTHER';

ALTER TABLE "DiscoveryRun" ADD COLUMN IF NOT EXISTS "recordsInserted" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DiscoveryRun" ADD COLUMN IF NOT EXISTS "recordsSkipped" INTEGER NOT NULL DEFAULT 0;

UPDATE "Opportunity" SET "category" = CASE
  WHEN "title" ~* '(scholarship|fellowship|studentship award)' THEN 'SCHOLARSHIP'
  WHEN "title" ~* '(assistantship|studentship|funded.*(position|project)|ph\.?d.*(position|opening|vacancy))' THEN 'FUNDED_POSITION'
  WHEN "title" ~* '(laboratory|research lab|research group)' THEN 'LAB'
  WHEN "title" ~* '(professor|faculty member|principal investigator|supervisor)' THEN 'PROFESSOR'
  WHEN "title" ~* '(graduate program|graduate programme|master.*program|doctoral program|ph\.?d program)' THEN 'GRADUATE_PROGRAM'
  ELSE 'OTHER_RESEARCH_LEAD' END
WHERE "category" = 'OTHER';

CREATE TABLE IF NOT EXISTS "OpportunitySource" (
  "id" TEXT NOT NULL,
  "opportunityId" TEXT NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "canonicalUrl" TEXT NOT NULL,
  "sourceHost" VARCHAR(255) NOT NULL,
  "sourceId" TEXT,
  "discoveredVia" TEXT NOT NULL,
  "contentHash" TEXT,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastCheckedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OpportunitySource_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OpportunitySource_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OpportunitySource_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "OpportunitySource_opportunityId_canonicalUrl_key" ON "OpportunitySource"("opportunityId", "canonicalUrl");
CREATE INDEX IF NOT EXISTS "OpportunitySource_canonicalUrl_idx" ON "OpportunitySource"("canonicalUrl");

INSERT INTO "OpportunitySource" ("id", "opportunityId", "sourceUrl", "canonicalUrl", "sourceHost", "sourceId", "discoveredVia", "contentHash", "lastCheckedAt", "updatedAt")
SELECT gen_random_uuid()::text, o."id", o."sourceUrl", o."canonicalUrl", o."sourceHost", o."sourceId", 'existing opportunity', o."contentHash", o."lastCheckedAt", NOW()
FROM "Opportunity" o
ON CONFLICT ("opportunityId", "canonicalUrl") DO NOTHING;

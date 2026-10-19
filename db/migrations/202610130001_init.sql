-- CreateEnum
CREATE TYPE "FundingClassification" AS ENUM ('FULL', 'PARTIAL', 'UNCLEAR', 'NO_EVIDENCE');

-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('OPEN', 'CLOSED', 'UNCERTAIN');

-- CreateEnum
CREATE TYPE "ExtractionStatus" AS ENUM ('PENDING', 'NEEDS_REVIEW', 'EXTRACTED', 'FAILED');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('UNVERIFIED', 'SOURCE_CHECKED', 'MANUALLY_VERIFIED');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('UNIVERSITY', 'LAB', 'PROFESSOR', 'SCHOLARSHIP', 'OFFICIAL_DATABASE', 'RSS', 'CUSTOM');

-- CreateEnum
CREATE TYPE "DiscoveryRunStatus" AS ENUM ('RUNNING', 'COMPLETE', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "CandidateStatus" AS ENUM ('DISCOVERED', 'IMPORTED', 'DUPLICATE', 'FAILED');

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "sourceHost" VARCHAR(255) NOT NULL,
    "normalizedTitle" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "institution" TEXT,
    "country" TEXT,
    "degreeLevel" TEXT,
    "researchField" TEXT,
    "fundingType" TEXT,
    "fundingEvidence" TEXT,
    "fundingClassification" "FundingClassification" NOT NULL DEFAULT 'NO_EVIDENCE',
    "eligibilityRequirements" TEXT,
    "deadline" DATE,
    "intakeTerm" TEXT,
    "intakeYear" INTEGER,
    "supervisorName" TEXT,
    "contactEmail" TEXT,
    "evidenceExcerpts" JSONB NOT NULL DEFAULT '[]',
    "status" "OpportunityStatus" NOT NULL DEFAULT 'UNCERTAIN',
    "discoveryDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCheckedAt" TIMESTAMP(3),
    "lastSuccessfulExtractionAt" TIMESTAMP(3),
    "extractionStatus" "ExtractionStatus" NOT NULL DEFAULT 'PENDING',
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "errorDetails" TEXT,
    "isSaved" BOOLEAN NOT NULL DEFAULT false,
    "contentHash" TEXT,
    "sourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sourceType" "SourceType" NOT NULL DEFAULT 'CUSTOM',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "countryTag" TEXT,
    "degreeTag" TEXT,
    "fieldTag" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "lastRunStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryQuery" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "degreeTag" TEXT,
    "countryTag" TEXT,
    "fieldTag" TEXT,
    "intakeTag" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "maxResults" INTEGER NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoveryQuery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryRun" (
    "id" TEXT NOT NULL,
    "status" "DiscoveryRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "queryOrSource" TEXT NOT NULL,
    "candidatesDiscovered" INTEGER NOT NULL DEFAULT 0,
    "duplicatesSkipped" INTEGER NOT NULL DEFAULT 0,
    "recordsUpdated" INTEGER NOT NULL DEFAULT 0,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,

    CONSTRAINT "DiscoveryRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryCandidate" (
    "id" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT,
    "discoveredVia" TEXT NOT NULL,
    "status" "CandidateStatus" NOT NULL DEFAULT 'DISCOVERED',
    "lastDiscoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "runId" TEXT NOT NULL,
    "queryId" TEXT,
    "sourceId" TEXT,
    "opportunityId" TEXT,
    "errorDetails" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoveryCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityChange" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpportunityChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailDraft" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT,
    "recipientName" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Opportunity_canonicalUrl_key" ON "Opportunity"("canonicalUrl");

-- CreateIndex
CREATE INDEX "Opportunity_status_deadline_idx" ON "Opportunity"("status", "deadline");

-- CreateIndex
CREATE INDEX "Opportunity_degreeLevel_country_researchField_idx" ON "Opportunity"("degreeLevel", "country", "researchField");

-- CreateIndex
CREATE INDEX "Opportunity_fundingClassification_isSaved_idx" ON "Opportunity"("fundingClassification", "isSaved");

-- CreateIndex
CREATE INDEX "Opportunity_lastCheckedAt_idx" ON "Opportunity"("lastCheckedAt");

-- CreateIndex
CREATE INDEX "Opportunity_normalizedTitle_sourceHost_idx" ON "Opportunity"("normalizedTitle", "sourceHost");

-- CreateIndex
CREATE UNIQUE INDEX "Source_url_key" ON "Source"("url");

-- CreateIndex
CREATE INDEX "Source_enabled_sourceType_idx" ON "Source"("enabled", "sourceType");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryQuery_name_key" ON "DiscoveryQuery"("name");

-- CreateIndex
CREATE INDEX "DiscoveryQuery_enabled_priority_idx" ON "DiscoveryQuery"("enabled", "priority");

-- CreateIndex
CREATE INDEX "DiscoveryRun_startedAt_idx" ON "DiscoveryRun"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryCandidate_canonicalUrl_key" ON "DiscoveryCandidate"("canonicalUrl");

-- CreateIndex
CREATE INDEX "DiscoveryCandidate_status_lastDiscoveredAt_idx" ON "DiscoveryCandidate"("status", "lastDiscoveredAt");

-- CreateIndex
CREATE INDEX "DiscoveryCandidate_opportunityId_idx" ON "DiscoveryCandidate"("opportunityId");

-- CreateIndex
CREATE INDEX "OpportunityChange_opportunityId_detectedAt_idx" ON "OpportunityChange"("opportunityId", "detectedAt");

-- CreateIndex
CREATE INDEX "EmailDraft_updatedAt_idx" ON "EmailDraft"("updatedAt");

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryCandidate" ADD CONSTRAINT "DiscoveryCandidate_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DiscoveryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryCandidate" ADD CONSTRAINT "DiscoveryCandidate_queryId_fkey" FOREIGN KEY ("queryId") REFERENCES "DiscoveryQuery"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryCandidate" ADD CONSTRAINT "DiscoveryCandidate_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryCandidate" ADD CONSTRAINT "DiscoveryCandidate_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityChange" ADD CONSTRAINT "OpportunityChange_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailDraft" ADD CONSTRAINT "EmailDraft_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

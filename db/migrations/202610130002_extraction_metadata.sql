ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "extractionMethod" TEXT;
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "extractionError" TEXT;
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "lastExtractionAt" TIMESTAMP(3);

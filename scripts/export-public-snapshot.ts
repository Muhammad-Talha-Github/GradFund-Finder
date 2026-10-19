import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { query } from "../lib/db";

type OpportunityRow = {
  id: string;
  title: string;
  sourceUrl: string;
  canonicalUrl: string;
  description: string | null;
  institution: string | null;
  country: string | null;
  degreeLevel: string | null;
  researchField: string | null;
  fundingType: string | null;
  fundingClassification: string;
  deadline: string | null;
  supervisorName: string | null;
  category: string;
  status: string;
  verificationStatus: string;
  updatedAt: Date | string;
};

type SourceRow = { opportunityId: string; sourceUrl: string };

const outputPath = path.join(process.cwd(), "snapshot", "opportunities.json");
loadEnvConfig(process.cwd());

async function main() {
  const result = await query<OpportunityRow>(`
    SELECT id, title, sourceUrl, canonicalUrl, description, institution, country,
      degreeLevel, researchField, fundingType, fundingClassification,
      DATE_FORMAT(deadline, '%Y-%m-%d') AS deadline, supervisorName, category,
      status, verificationStatus, updatedAt
    FROM Opportunity
    ORDER BY updatedAt DESC, title ASC
  `);
  const sourcesResult = await query<SourceRow>(`
    SELECT opportunityId, sourceUrl FROM OpportunitySource
  `);

  const sourceMap = new Map<string, Set<string>>();
  for (const row of sourcesResult.rows) {
    const values = sourceMap.get(row.opportunityId) ?? new Set<string>();
    values.add(row.sourceUrl);
    sourceMap.set(row.opportunityId, values);
  }

  const opportunities = result.rows.map((row) => ({
    title: row.title,
    description: row.description,
    institution: row.institution,
    country: row.country,
    degreeLevel: row.degreeLevel,
    researchField: row.researchField,
    fundingType: row.fundingType,
    fundingClassification: row.fundingClassification,
    deadline: row.deadline,
    professor: row.supervisorName,
    category: row.category,
    status: row.status,
    verificationStatus: row.verificationStatus,
    sourceUrl: row.sourceUrl,
    sourceUrls: [...new Set([row.sourceUrl, row.canonicalUrl, ...(sourceMap.get(row.id) ?? [])])].filter(Boolean),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
  }));

  const snapshot = {
    generatedAt: new Date().toISOString(),
    count: opportunities.length,
    opportunities,
  };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  console.log(`Exported ${opportunities.length} public opportunities to snapshot/opportunities.json.`);
  console.log("Export includes opportunity listings and source links only; it excludes accounts, sessions, drafts, Gmail tokens, and settings.");
}

main().catch((error: unknown) => {
  console.error("Snapshot export failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

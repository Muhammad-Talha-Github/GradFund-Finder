import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type PublicOpportunity = {
  title: string;
  description: string | null;
  institution: string | null;
  country: string | null;
  degreeLevel: string | null;
  researchField: string | null;
  fundingType: string | null;
  fundingClassification: string;
  deadline: string | null;
  professor: string | null;
  category: string;
  status: string;
  verificationStatus: string;
  sourceUrl: string;
  sourceUrls: string[];
  updatedAt: string;
};

const root = process.cwd();
const inputPath = path.join(root, "snapshot", "opportunities.json");
const outputDir = path.join(root, "snapshot-site");
const publicText = (value: unknown, maxLength = 20_000): string | null =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : null;

function publicUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch { return null; }
}

function sanitizeOpportunity(value: unknown): PublicOpportunity | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const sourceUrl = publicUrl(row.sourceUrl);
  const title = publicText(row.title, 1_000);
  if (!sourceUrl || !title) return null;
  const sourceUrls = Array.isArray(row.sourceUrls)
    ? [...new Set(row.sourceUrls.map(publicUrl).filter((url): url is string => Boolean(url)))].slice(0, 20)
    : [];
  if (!sourceUrls.includes(sourceUrl)) sourceUrls.unshift(sourceUrl);
  return {
    title,
    description: publicText(row.description),
    institution: publicText(row.institution, 1_000),
    country: publicText(row.country, 150),
    degreeLevel: publicText(row.degreeLevel, 150),
    researchField: publicText(row.researchField, 255),
    fundingType: publicText(row.fundingType, 2_000),
    fundingClassification: publicText(row.fundingClassification, 30) ?? "NO_EVIDENCE",
    deadline: publicText(row.deadline, 80),
    professor: publicText(row.professor, 255),
    category: publicText(row.category, 60) ?? "OTHER_RESEARCH_LEAD",
    status: publicText(row.status, 30) ?? "UNCERTAIN",
    verificationStatus: publicText(row.verificationStatus, 30) ?? "UNVERIFIED",
    sourceUrl,
    sourceUrls,
    updatedAt: publicText(row.updatedAt, 80) ?? "",
  };
}

async function main() {
  const snapshot = JSON.parse(await readFile(inputPath, "utf8")) as Record<string, unknown>;
  if (!Array.isArray(snapshot.opportunities)) throw new Error("snapshot/opportunities.json must contain an opportunities array.");
  const opportunities = snapshot.opportunities.map(sanitizeOpportunity).filter((item): item is PublicOpportunity => item !== null);
  const safeSnapshot = {
    generatedAt: publicText(snapshot.generatedAt, 80),
    count: opportunities.length,
    opportunities,
  };

  await mkdir(outputDir, { recursive: true });
  await copyFile(path.join(root, "snapshot", "index.html"), path.join(outputDir, "index.html"));
  await writeFile(path.join(outputDir, "opportunities.json"), `${JSON.stringify(safeSnapshot, null, 2)}\n`, "utf8");
  console.log(`Built database-independent public snapshot in snapshot-site/ (${opportunities.length} opportunities).`);
}

main().catch((error: unknown) => {
  console.error("Snapshot build failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

import { EvidenceOnlyExtractor } from "@/lib/extraction/evidence-extractor";
import type { CandidateEvidence, ExtractedOpportunity, OpportunityExtractionProvider } from "@/lib/extraction/types";

export function isUnchangedContent(previousHash: string | null, currentHash: string): boolean {
  return Boolean(previousHash && currentHash && previousHash === currentHash);
}

export function mergeEvidence(previous: unknown, next: unknown[]): unknown[] {
  const old = Array.isArray(previous) ? previous.filter((item) => typeof item === "string" || Boolean(item && typeof item === "object")) : [];
  const merged = [...old, ...next];
  return merged.filter((item, index) => merged.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(item)) === index).slice(-40);
}

// Older builds stored a bare HTTP 404 without the model name or provider
// response. Let those records receive one retry after the model fix.
export function isLegacyGemini404(error: unknown): boolean {
  return typeof error === "string"
    && error.includes("Gemini extraction failed with HTTP 404.")
    && !error.includes("Model '");
}

export async function extractWithFallback(
  candidate: CandidateEvidence,
  pageFetched: boolean,
  providerFactory: () => OpportunityExtractionProvider,
): Promise<{ result: ExtractedOpportunity; method: string; error: string | null }> {
  let attemptedProvider: OpportunityExtractionProvider | null = null;
  try {
    const provider = providerFactory();
    attemptedProvider = provider;
    const extracted = await provider.extract(candidate);
    const prefix = pageFetched ? "page+" : "tavily-fallback+";
    if (!provider.name.startsWith("gemini")) return { result: extracted, method: prefix + provider.name, error: null };

    // Cheap evidence-only completion fills fields Gemini could not verify
    // without replacing any Gemini value or relaxing the funding evidence rules.
    const rules = await new EvidenceOnlyExtractor().extract(candidate);
    const result = { ...extracted };
    const textFields = ["institution", "country", "degreeLevel", "researchField", "fundingType", "fundingEvidence", "intakeTerm", "supervisorName", "contactEmail", "eligibilityRequirements"] as const;
    let filledMissingField = false;
    for (const field of textFields) {
      if (!result[field] && rules[field]) {
        result[field] = rules[field] as never;
        filledMissingField = true;
      }
    }
    if (!result.deadline && rules.deadline) { result.deadline = rules.deadline; filledMissingField = true; }
    if (!result.intakeYear && rules.intakeYear) { result.intakeYear = rules.intakeYear; filledMissingField = true; }
    if (result.fundingClassification === "NO_EVIDENCE" && rules.fundingEvidence) result.fundingClassification = rules.fundingClassification;
    if (result.status === "UNCERTAIN" && rules.status !== "UNCERTAIN") result.status = rules.status;
    result.evidenceExcerpts = mergeEvidence(result.evidenceExcerpts, rules.evidenceExcerpts) as ExtractedOpportunity["evidenceExcerpts"];
    return { result, method: prefix + provider.name + (filledMissingField ? "+rules-fill" : ""), error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Configured extraction provider failed.";
    const fallback = await new EvidenceOnlyExtractor().extract(candidate);
    const failedProvider = attemptedProvider?.name.startsWith("gemini") ? `${attemptedProvider.name}-failed+` : "";
    return { result: fallback, method: (pageFetched ? "page+" : "tavily-fallback+") + failedProvider + "rules-fallback", error: message };
  }
}

import { classifyFunding, findOpportunityStatus, fundingType } from "@/lib/opportunities/domain";
import type { CandidateEvidence, OpportunityExtractionProvider, ExtractedOpportunity } from "./types";
import { GeminiExtractionProvider } from "./gemini-extractor";

const countries = [
  "United States", "United Kingdom", "South Korea", "South Africa", "New Zealand", "Netherlands",
  "Switzerland", "Australia", "Canada", "Germany", "France", "Sweden", "Norway", "Denmark",
  "Finland", "Ireland", "Italy", "Spain", "Portugal", "Belgium", "Austria", "Japan", "China",
  "India", "Pakistan", "Singapore", "Brazil", "Mexico", "Taiwan", "Turkey",
];

function findDeadline(text: string): Date | null {
  const datePattern = "(January|February|March|April|May|June|July|August|September|October|November|December)\\s+\\d{1,2},?\\s+20\\d{2}|\\d{1,2}\\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\\s+20\\d{2}|20\\d{2}-\\d{2}-\\d{2}";
  const match = text.match(new RegExp("(?:deadline|apply by|applications? close|closing date|due date)[^\\n.]{0,50}?(" + datePattern + ")", "i"));
  if (!match?.[1]) return null;
  const parsed = new Date(match[1]);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

function findSupervisor(text: string): string | null {
  const match = text.match(/\b(?:Prof(?:essor)?|Dr)\.?\s+[A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+)?/u);
  return match?.[0] ?? null;
}

function findIntake(text: string): { term: string | null; year: number | null } {
  const match = text.match(/\b(Fall|Autumn|Spring|Summer|Winter)\s+(20\d{2})\b/i);
  return match ? { term: match[1], year: Number(match[2]) } : { term: null, year: null };
}

function findEvidenceCountry(text: string): string | null {
  return countries.find((country) =>
    new RegExp("\\b(?:in|at|based in|located in|position in|study in)\\s+" + country + "\\b", "i").test(text),
  ) ?? null;
}

function relevantEvidence(text: string): string[] {
  if (!text.trim()) return [];
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((sentence) => sentence.trim()).filter(Boolean);
  const relevant = sentences.filter((sentence) =>
    /fund|scholarship|stipend|tuition|deadline|apply by|eligib|requirement|supervisor|professor|email|intake|fall 20|spring 20/i.test(sentence),
  );
  return (relevant.length ? relevant : sentences).slice(0, 8).map((sentence) => sentence.slice(0, 500));
}

export class EvidenceOnlyExtractor implements OpportunityExtractionProvider {
  readonly name = "evidence-rules";

  async extract(candidate: CandidateEvidence): Promise<ExtractedOpportunity> {
    const content = candidate.content.slice(0, 8_000);
    const combined = candidate.title + "\n" + content;
    const fundingEvidence = content.split(/(?<=[.!?])\s+|\n+/).find((sentence) =>
      /fund|scholarship|stipend|tuition|assistantship/i.test(sentence),
    )?.trim().slice(0, 800) ?? null;
    const email = content.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0] ?? null;
    const deadline = findDeadline(content);
    const intake = findIntake(combined);
    const degree = /\b(ph\.?d\.?|doctorate|doctoral)\b/i.test(candidate.title)
      ? "PhD"
      : /\b(master'?s|master of|msc|m\.sc\.|m\.a\.|meng|mphil)\b/i.test(candidate.title)
        ? "Master's"
        : null;
    const field = /climate|environment|ecology|sustainab|agricultur/i.test(candidate.title)
      ? "Environmental Science"
      : /computer science|computational|artificial intelligence|\bAI\b|machine learning|data science/i.test(candidate.title)
        ? "Computer Science"
        : /biomedical|bioengineering/i.test(candidate.title)
          ? "Biomedical Engineering"
          : null;
    const eligibility = content.match(/(?:eligibility|eligible applicants|requirements?)[:\s]+([^.\n]{1,300})/i)?.[1]?.trim() ?? null;
    return {
      institution: null,
      country: findEvidenceCountry(combined),
      degreeLevel: degree,
      researchField: field,
      fundingType: fundingEvidence ? fundingType(fundingEvidence) : null,
      fundingEvidence,
      fundingClassification: classifyFunding(fundingEvidence ?? ""),
      deadline,
      intakeTerm: intake.term,
      intakeYear: intake.year,
      supervisorName: findSupervisor(combined),
      contactEmail: email,
      eligibilityRequirements: eligibility,
      status: findOpportunityStatus(combined, deadline),
      evidenceExcerpts: relevantEvidence(content).map((excerpt) => ({ field: "general", value: "source excerpt", excerpt, sourceUrl: candidate.sourceUrl ?? candidate.url })),
    };
  }
}

export function getExtractionProvider(): OpportunityExtractionProvider {
  if (process.env.EXTRACTION_PROVIDER === "gemini") {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("Gemini extraction is selected but GEMINI_API_KEY is not configured.");
    return new GeminiExtractionProvider(apiKey);
  }
  return new EvidenceOnlyExtractor();
}

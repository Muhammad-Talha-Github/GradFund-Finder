export type CandidateEvidence = {
  title: string;
  url: string;
  content: string;
  sourceUrl?: string;
};

export type EvidenceItem = { field: string; value: string; excerpt: string; sourceUrl: string };

export type ExtractedOpportunity = {
  institution: string | null;
  country: string | null;
  degreeLevel: string | null;
  researchField: string | null;
  fundingType: string | null;
  fundingEvidence: string | null;
  fundingClassification: "FULL" | "PARTIAL" | "UNCLEAR" | "NO_EVIDENCE";
  deadline: Date | null;
  intakeTerm: string | null;
  intakeYear: number | null;
  supervisorName: string | null;
  contactEmail: string | null;
  eligibilityRequirements: string | null;
  status: "OPEN" | "CLOSED" | "UNCERTAIN";
  evidenceExcerpts: EvidenceItem[];
};

export interface OpportunityExtractionProvider {
  readonly name: string;
  extract(candidate: CandidateEvidence): Promise<ExtractedOpportunity>;
}

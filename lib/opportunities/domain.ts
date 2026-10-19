export type FundingClassification = "FULL" | "PARTIAL" | "UNCLEAR" | "NO_EVIDENCE";

export function canonicalizeUrl(input: string): string {
  const url = new URL(input);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only http and https source URLs are supported.");
  if (url.username || url.password) throw new Error("Source URLs cannot contain login credentials.");
  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_.+|fbclid|gclid|mc_cid|mc_eid|ref)$/i.test(key)) url.searchParams.delete(key);
  }
  url.pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";
  url.searchParams.sort();
  return url.toString();
}

export function normalizeTitle(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function classifyFunding(evidence: string): FundingClassification {
  if (!evidence.trim()) return "NO_EVIDENCE";
  const text = evidence.toLowerCase();
  if (/fully funded|full funding|tuition (?:is )?fully covered|full tuition (?:and|plus|\+).{0,50}(?:stipend|living|fund)/i.test(text)) return "FULL";
  if (/partial(?:ly)? funded|partial scholarship|partial tuition|funds? (?:up to|cover(?:s)? only)|(?:25|50|75)%\s*(?:of )?(?:tuition|fees)/i.test(text)) return "PARTIAL";
  if (/fund(?:ing|ed)|scholarship|fellowship|stipend|assistantship|tuition waiver/i.test(text)) return "UNCLEAR";
  return "NO_EVIDENCE";
}

export function fundingType(evidence: string): string | null {
  if (/assistantship|research assistant|teaching assistant/i.test(evidence)) return "Assistantship";
  if (/scholarship|fellowship/i.test(evidence)) return "Scholarship";
  if (/research project|funded project/i.test(evidence)) return "Funded research project";
  if (/supervisor|principal investigator|lab group/i.test(evidence)) return "Supervisor funded";
  if (/stipend/i.test(evidence)) return "Stipend";
  if (/tuition waiver|tuition remission/i.test(evidence)) return "Tuition waiver";
  return null;
}

export function findOpportunityStatus(evidence: string, deadline: Date | null): "OPEN" | "CLOSED" | "UNCERTAIN" {
  if (/applications? (?:are )?closed|no longer accepting applications|position has been filled/i.test(evidence)) return "CLOSED";
  if (deadline && deadline < new Date()) return "CLOSED";
  if (/applications? (?:are )?open|apply now|accepting applications/i.test(evidence) && (!deadline || deadline >= new Date())) return "OPEN";
  return "UNCERTAIN";
}

export function paginate<T>(items: T[], page: number, pageSize: number): { items: T[]; page: number; pageSize: number; total: number; pages: number } {
  const safePageSize = Math.max(1, Math.min(50, Math.trunc(pageSize) || 10));
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / safePageSize));
  const safePage = Math.max(1, Math.min(pages, Math.trunc(page) || 1));
  const start = (safePage - 1) * safePageSize;
  return { items: items.slice(start, start + safePageSize), page: safePage, pageSize: safePageSize, total, pages };
}

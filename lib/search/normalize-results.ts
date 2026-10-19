import type { OpportunitySearchResult, RawSearchResult } from "./types";

const unknown = "Unknown";
const countries = [
  "United States", "United Kingdom", "South Korea", "South Africa", "New Zealand",
  "Saudi Arabia", "United Arab Emirates", "Czech Republic", "Netherlands",
  "Switzerland", "Australia", "Canada", "Germany", "France", "Sweden", "Norway",
  "Denmark", "Finland", "Ireland", "Italy", "Spain", "Portugal", "Belgium",
  "Austria", "Japan", "China", "India", "Pakistan", "Singapore", "Brazil",
  "Mexico", "Taiwan", "Turkey",
];

function findDegree(text: string): string {
  if (/\b(ph\.?d\.?|doctorate|doctoral|doctoral studentship)\b/i.test(text)) return "PhD";
  if (/\b(master'?s|master of|msc|m\.sc\.|ma\b|m\.a\.|meng|mphil)\b/i.test(text)) return "Master's";
  return unknown;
}

function findCountry(text: string): string {
  const match = countries.find((country) =>
    new RegExp("\\b(?:in|at|based in|located in|position in|country:?|study in)\\s+" + country + "\\b", "i").test(text),
  );
  return match ?? unknown;
}

function findField(text: string): string {
  if (/climate|environment|ecology|sustainab|agricultur/i.test(text)) return "Environmental Science";
  if (/computer science|computational|artificial intelligence|\bAI\b|machine learning|data science/i.test(text)) return "Computer Science";
  if (/biomedical|bioengineering/i.test(text)) return "Biomedical Engineering";
  return unknown;
}

function findFunding(text: string): string {
  const sentence = text.split(/(?<=[.!?])\s+|\n+/).find((part) =>
    /fully funded|full funding|tuition.{0,40}(waiv|cover|fund)|stipend|scholarship|studentship|funded position/i.test(part),
  );
  return sentence?.trim().slice(0, 240) || unknown;
}

function findDeadline(text: string): { label: string; date: string } {
  const date = "(?:January|February|March|April|May|June|July|August|September|October|November|December)\\s+\\d{1,2},?\\s+20\\d{2}|\\d{1,2}\\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\\s+20\\d{2}|\\d{4}-\\d{2}-\\d{2}";
  const match = text.match(new RegExp("(?:deadline|apply by|applications? close|closing date|due date)[^\\n.]{0,50}?(" + date + ")", "i"));
  if (!match?.[1]) return { label: unknown, date: "" };
  const parsed = new Date(match[1]);
  return {
    label: match[1],
    date: Number.isNaN(parsed.valueOf()) ? "" : parsed.toISOString().slice(0, 10),
  };
}

export function normalizeSearchResults(results: RawSearchResult[]): OpportunitySearchResult[] {
  const seen = new Set<string>();
  return results.flatMap((result, index) => {
    if (seen.has(result.url)) return [];
    seen.add(result.url);
    let sourceDomain = "";
    try {
      sourceDomain = new URL(result.url).hostname.replace(/^www\./, "");
    } catch {
      // Provider validates result URLs before normalization.
    }
    const evidence = result.title + "\n" + result.content;
    const deadline = findDeadline(evidence);
    return [{
      id: "web-" + index + "-" + encodeURIComponent(result.url).slice(0, 36),
      title: result.title || "Untitled search result",
      institution: unknown,
      country: findCountry(evidence),
      degree: findDegree(result.title),
      field: findField(result.title),
      funding: findFunding(evidence),
      deadline: deadline.label,
      deadlineDate: deadline.date,
      url: result.url,
      verified: false,
      isSearchResult: true,
      sourceDomain,
    }];
  });
}

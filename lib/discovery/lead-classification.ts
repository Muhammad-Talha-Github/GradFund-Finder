export type OpportunityCategory = "SCHOLARSHIP" | "FUNDED_POSITION" | "GRADUATE_PROGRAM" | "PROFESSOR" | "LAB" | "OTHER_RESEARCH_LEAD";
export type LeadStatus = "CONFIRMED_FUNDED" | "POTENTIAL_OPPORTUNITY" | "PROFESSOR_OR_LAB_LEAD";

const academicSignals = /\b(graduate|postgraduate|master'?s|\bph\.?d\b|doctoral|scholarship|fellowship|studentship|assistantship|research|professor|faculty|laboratory|\blab\b|research group|department|prospective students|join our group|recruiting students)\b/i;
const spamSignals = /\b(casino|sports betting|payday loan|essay writing service|crypto giveaway|adult content|buy followers)\b/i;
const computerScienceSignals = /\b(?:computer science|computing|computer engineering|\bCS\b|artificial intelligence|\bAI\b|machine learning|deep learning|computer vision|natural language processing|\bNLP\b|large language models?|\bLLMs?\b|generative AI|cybersecurity|computer security|software engineering|programming languages|distributed systems|data management|database systems|human[- ]computer interaction|\bHCI\b|robotics|computer graphics|information retrieval|theoretical computer science)\b/i;
const researcherSignals = /\b(?:professor|prof\.?|faculty|principal investigator|\bPI\b|lab(?:oratory)?|research group|research team|my group|our group)\b/i;
const phdSignals = /\b(?:ph\.?\s*d\.?|doctoral)\b/i;
const recruitmentSignals = /\b(?:recruit(?:ing|s|ed)?|seek(?:ing|s)?|look(?:ing)? for|accept(?:ing|s)?|hiring|open to|join|welcome|taking on|positions?|openings?)\b/i;

/** Broad, cheap gate for deciding which failed-page snippets merit Gemini review. */
export function isPlausibleProfessorPhdSnippet(title: string, content: string, sourceUrl?: string): boolean {
  const cleanTitle = title.trim();
  if (cleanTitle.length < 4 || isExcludedRecruitmentSource(cleanTitle, sourceUrl)) return false;
  if (/\b(?:guide|advice|tips|how to|roundup|what is a phd|phd explained|press release|news article|best ways|top \d+|scholarship list)\b/i.test(cleanTitle)) return false;
  const text = `${cleanTitle}\n${content.slice(0, 8_000)}`;
  if (/\b(?:not recruiting|not currently recruiting|not accepting|no phd openings|no open positions|archived page)\b/i.test(text)) return false;
  if (/\bpost[- ]?doctoral?\b/i.test(text) && !/\b(?:ph\.?\s*d\.?|doctoral) students?\b/i.test(text)) return false;
  const researchContext = researcherSignals.test(text) || computerScienceSignals.test(text);
  const graduateOrRecruitmentSignal = phdSignals.test(text) || recruitmentSignals.test(text);
  return researchContext && graduateOrRecruitmentSignal && !spamSignals.test(cleanTitle);
}

export function isPotentiallyRelevant(title: string, content: string): boolean {
  const cleanTitle = title.trim();
  if (cleanTitle.length < 4 || spamSignals.test(cleanTitle) && !academicSignals.test(cleanTitle)) return false;
  // Search providers sometimes return advice/forum pages because they mention
  // emailing professors or joining a lab. These are not opportunity sources.
  if (/\b(?:forums?|free templates?)\b/i.test(cleanTitle) ||
    /^how (?:to (?:email|contact)|can i inquire)\b/i.test(cleanTitle)) return false;
  // Postdoctoral vacancies are not graduate study opportunities or lab leads.
  if (/\bpost[- ]?doctoral?\b/i.test(cleanTitle) &&
    !/\b(?:graduate|ph\.?d|doctoral|master'?s) students?\b/i.test(cleanTitle)) return false;
  const combined = `${cleanTitle}\n${content.slice(0, 10_000)}`;
  return academicSignals.test(combined);
}

/** Match active professor/lab recruitment posts specifically seeking PhD students. */
export function isProfessorPhdRecruitmentPost(title: string, content: string, sourceUrl?: string): boolean {
  const cleanTitle = title.trim();
  if (cleanTitle.length < 4 || /^\s*\d+[\s.:)-]/.test(cleanTitle) || /\b(?:guide|advice|tips|how to|roundup|what is a phd|phd explained|press release|news article|best ways|top \d+|opportunities for|graduate school opportunities|funding for graduate students|scholarship opportunities|scholarship list|phd programs ranked|open positions for aspiring researchers)\b/i.test(cleanTitle)) return false;
  const text = `${cleanTitle}\n${content.slice(0, 12_000)}`;
  if (/\b(?:not recruiting|not currently recruiting|not accepting|no phd openings|no open positions|no longer updated|archival purposes|archived page)\b/i.test(text)) return false;
  const researcher = researcherSignals.test(`${cleanTitle}\n${content.slice(0, 2_500)}`);
  // Restrict this collector to computer-science faculty/lab posts. Search
  // snippets often mention PhD funding generally, so the page itself must
  // also identify a CS area or department.
  const computerScience = computerScienceSignals.test(text);
  const recruitmentAndPhd = /(?:\b(?:recruit(?:ing|s|ed)?|seek(?:ing|s)?|look(?:ing)? for|accept(?:ing|s)?|hiring|open to)\b[\s\S]{0,100}\b(?:ph\.?\s*d\.?|doctoral)\s+(?:students?|candidates?|positions?|openings?)\b|\b(?:ph\.?\s*d\.?|doctoral)\s+(?:students?|candidates?)\b[\s\S]{0,100}\b(?:recruit(?:ing|s|ed)?|seek(?:ing|s)?|look(?:ing)? for|accept(?:ing|s)?|hiring|join (?:my|our|the) (?:lab|group|team))\b)/i.test(text);
  const firstPartyRecruitmentVoice = /\b(?:(?:i am|i'm|we are|we're)\s+)?(?:recruiting|seeking|looking for|accepting)\s+(?:new\s+)?(?:ph\.?\s*d\.?|doctoral) students\b|\b(?:my|our) (?:lab|group|team)\b|\bjoin (?:my|our) (?:lab|group|team)\b|\bprospective (?:phd|doctoral) students\b/i.test(text);
  return researcher && computerScience && recruitmentAndPhd && firstPartyRecruitmentVoice && !isExcludedRecruitmentSource(cleanTitle, sourceUrl);
}

const excludedRecruitmentHosts = ["jobs.ac.uk", "findaphd.com", "jobrxiv.org", "applykite.com", "scholarshipfrontier.com", "coltie.com", "bold.org", "usnews.com", "nsf.gov", "linkedin.com", "facebook.com", "instagram.com", "sciencecareers.org", "indeed.com", "quora.com", "apexapply.com", "scholarshipsads.com", "myscholarhq.com"];

export function isExcludedRecruitmentSource(title: string, sourceUrl?: string): boolean {
  if (/^\s*\d+[\s.:)-]/.test(title) || /\b(?:best ways|top \d+|scholarship database|scholarship roundup|phd scholarships? guide|funding your phd and application tips|open positions for aspiring researchers)\b/i.test(title)) return true;
  if (!sourceUrl) return false;
  try {
    const hostname = new URL(sourceUrl).hostname.toLowerCase().replace(/^www\./, "");
    return excludedRecruitmentHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  } catch { return true; }
}

export function categorizeLead(title: string, content: string, sourceUrl?: string): OpportunityCategory {
  const text = `${title}\n${content.slice(0, 10_000)}`;
  if (/\b(?:guide|advice|tips|how to|top\s+\d+|best\s+\d+|roundup|scholarship database|list of scholarships)\b/i.test(title)) return "OTHER_RESEARCH_LEAD";
  if (sourceUrl) {
    try {
      const page = new URL(sourceUrl);
      if (page.pathname === "/" && /\b(?:university|college|institute|campus)\b/i.test(title) && !/\b(?:openings?|positions?|vacancies|recruiting|prospective students|graduate funding)\b/i.test(text)) return "OTHER_RESEARCH_LEAD";
    } catch { /* An invalid optional URL does not change ordinary classification. */ }
  }
  if (/scholarship|fellowship|studentship award/i.test(title)) return "SCHOLARSHIP";
  if (/research assistant|teaching assistant|assistantship|studentship|funded (?:ph\.?d|master|doctoral)?\s*(?:position|project|students)?|ph\.?d (?:position|opening|vacancy)|doctoral (?:position|opening|vacancy)/i.test(title)) return "FUNDED_POSITION";
  if (/\bfaculty\b.{0,40}\b(?:accepting|recruiting|seeking)\b.{0,40}\b(?:graduate|ph\.?d|doctoral|master'?s)\b/i.test(title)) return "PROFESSOR";
  if (/\b(lab|laboratory|research group|research centre|research center)\b/i.test(title) || /\b(lab|laboratory|research group|research centre|research center)\b/i.test(text) && !/professor|prof\./i.test(title)) return "LAB";
  if (/professor|faculty(?: member)?|principal investigator|supervisor/i.test(title)) return "PROFESSOR";
  if (/(?:graduate|postgraduate).{0,30}program|master'?s program|doctoral program|ph\.?d program|prospective students|graduate admissions/i.test(title)) return "GRADUATE_PROGRAM";
  return "OTHER_RESEARCH_LEAD";
}

/** Conservative predicate for saving search snippets as professor/lab leads when crawling is unavailable. */
export function isProfessorOrLabLead(title: string, content: string, sourceUrl?: string): boolean {
  return isProfessorPhdRecruitmentPost(title, content, sourceUrl);
}

export function getLeadStatus(category: string, fundingClassification: string, opportunityStatus: string = "UNCERTAIN"): LeadStatus {
  if (category !== "OTHER_RESEARCH_LEAD" && (fundingClassification === "FULL" || fundingClassification === "PARTIAL") && opportunityStatus === "OPEN") return "CONFIRMED_FUNDED";
  if (category === "PROFESSOR" || category === "LAB") return "PROFESSOR_OR_LAB_LEAD";
  return "POTENTIAL_OPPORTUNITY";
}

export function describeResearchLead(text: string): string | null {
  const clean = text.split(/\n+/).map((line) => line.replace(/\s+/g, " ").trim()).filter((line) => line.length > 45 && !/^https?:\/\//i.test(line));
  const description = clean.slice(0, 3).join(" ").slice(0, 1600).trim();
  return description || null;
}

export function identifyDepartment(text: string): string | null {
  return text.match(/\b(?:Department|School|Faculty|College|Institute)\s+of\s+[A-Z][\p{L}\w&'’ -]{2,70}/u)?.[0]?.trim().slice(0, 120) ?? null;
}

export function identifyLabGroup(text: string): string | null {
  return text.match(/\b[A-Z][\p{L}\w&'’ -]{2,70}\s+(?:Lab(?:oratory)?|Research Group|Research Centre|Research Center)\b/u)?.[0]?.trim().slice(0, 120) ??
    text.match(/\b(?:Lab(?:oratory)?|Research Group|Research Centre|Research Center)\s+(?:of|for)\s+[A-Z][\p{L}\w&'’ -]{2,70}/u)?.[0]?.trim().slice(0, 120) ?? null;
}

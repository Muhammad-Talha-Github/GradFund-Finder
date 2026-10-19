"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Opportunity = {
  id: string;
  title: string;
  institution: string;
  country: string;
  degree: string;
  field: string;
  funding: string;
  deadline: string;
  deadlineDate: string;
  url: string;
  verified: boolean;
  sourceDomain?: string;
  fundingClassification?: string;
  fundingEvidence?: string | null;
  status?: string;
  verificationStatus?: string;
  lastCheckedAt?: string | null;
  isSaved?: boolean;
  extractionMethod?: string | null;
  extractionError?: string | null;
  lastExtractionAt?: string | null;
  category?: string;
  leadStatus?: string;
  description?: string | null;
  department?: string | null;
  labGroup?: string | null;
  professor?: string | null;
  intake?: string;
  contactEmail?: string | null;
  eligibility?: string;
  extractionStatus?: string | null;
  evidenceExcerpts?: Array<{ field: string; value: string; excerpt: string; sourceUrl?: string }>;
  sourceUrls?: Array<{ url: string; canonicalUrl?: string }>;
};
type Draft = {
  id: string;
  professor: string;
  recipientEmail: string | null;
  institution: string;
  opportunity: string;
  preview: string;
  subject: string;
  gmailDraftId: string | null;
  status: "Ready to review" | "In progress" | "Saved to Gmail";
};

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  const paths: Record<string, React.ReactNode> = {
    spark: (
      <>
        <path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" />
        <path d="m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z" />
      </>
    ),
    grid: (
      <>
        <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
        <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
        <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
        <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
      </>
    ),
    search: (
      <>
        <circle cx="10.8" cy="10.8" r="6.5" />
        <path d="m16 16 4.2 4.2" />
      </>
    ),
    mail: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m4 7 8 6 8-6" />
      </>
    ),
    link: (
      <>
        <path d="M10 13.5a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.2 1.2" />
        <path d="M14 10.5a5 5 0 0 0-7.1 0l-2 2a5 5 0 0 0 7.1 7.1l1.2-1.2" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="m19.4 15 .1.1a1.8 1.8 0 1 1-2.5 2.5l-.1-.1a1.8 1.8 0 0 0-3 .9v.2a1.8 1.8 0 1 1-3.6 0v-.2a1.8 1.8 0 0 0-3-.9l-.1.1a1.8 1.8 0 1 1-2.5-2.5l.1-.1a1.8 1.8 0 0 0-.9-3h-.2a1.8 1.8 0 1 1 0-3.6h.2a1.8 1.8 0 0 0 .9-3l-.1-.1a1.8 1.8 0 1 1 2.5-2.5l.1.1a1.8 1.8 0 0 0 3-.9v-.2a1.8 1.8 0 1 1 3.6 0v.2a1.8 1.8 0 0 0 3 .9l.1-.1a1.8 1.8 0 1 1 2.5 2.5l-.1.1a1.8 1.8 0 0 0 .9 3h.2a1.8 1.8 0 1 1 0 3.6h-.2a1.8 1.8 0 0 0-.9 3Z" />
      </>
    ),
    arrow: (
      <>
        <path d="M7 17 17 7M7 7h10v10" />
      </>
    ),
    check: (
      <>
        <path d="m5 12 4 4L19 6" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M16 3v4M8 3v4M3 10h18" />
      </>
    ),
    globe: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
      </>
    ),
    book: (
      <>
        <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 1 4 17.5z" />
        <path d="M4 17.5A2.5 2.5 0 0 1 6.5 15H20M8 7h8" />
      </>
    ),
    plus: (
      <>
        <path d="M12 5v14M5 12h14" />
      </>
    ),
    trash: (
      <>
        <path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
  };
  return <svg {...common}>{paths[name] ?? paths.spark}</svg>;
}

function SectionHeading({
  title,
  caption,
  action,
}: {
  title: string;
  caption?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <h2 className="section-title">{title}</h2>
        {caption && <div className="section-caption">{caption}</div>}
      </div>
      {action}
    </div>
  );
}

function Sidebar({
  open,
  onToggle,
  opportunityCount,
  username,
  onLogout,
  loggingOut,
}: {
  open: boolean;
  onToggle: () => void;
  opportunityCount: number;
  username: string;
  onLogout: () => void;
  loggingOut: boolean;
}) {
  const initials = username.slice(0, 2).toLocaleUpperCase("en-US");
  return (
    <>
      <aside className={`sidebar ${open ? "sidebar-open" : "sidebar-closed"}`} aria-hidden={!open}>
        <a href="#overview" className="brand">
          <span className="brand-mark">
            <Icon name="spark" size={19} />
          </span>
          <span className="brand-name">GradFund Finder</span>
        </a>
        <div className="side-label">Workspace</div>
        <nav>
          <a href="#overview" className="nav-link active">
            <Icon name="grid" />
            <span className="nav-text">Overview</span>
          </a>
          <a href="#opportunities" className="nav-link">
            <Icon name="search" />
            <span className="nav-text">Opportunities</span>
            <span className="nav-count">{opportunityCount}</span>
          </a>
          <a href="#drafts" className="nav-link">
            <Icon name="mail" />
            <span className="nav-text">Email drafts</span>
          </a>
        </nav>
        <div className="sidebar-bottom">
          <div className="side-label">Preferences</div>
          <a href="#filters" className="nav-link">
            <Icon name="settings" />
            <span className="nav-text">Search preferences</span>
          </a>
          <div className="profile-card">
            <div className="avatar">{initials}</div>
            <div>
              <div className="profile-name">{username}</div>
              <div className="profile-sub">Your account</div>
            </div>
          </div>
          <button type="button" className="nav-link sidebar-logout" onClick={onLogout} disabled={loggingOut}>
            {loggingOut ? <span className="logout-mini-spinner" aria-hidden="true" /> : <Icon name="arrow" />}
            <span className="nav-text">{loggingOut ? "Signing out..." : "Log out"}</span>
          </button>
        </div>
      </aside>
      <button
        type="button"
        className={`sidebar-toggle ${open ? "sidebar-toggle-open" : ""}`}
        onClick={onToggle}
        aria-label={open ? "Close sidebar" : "Open sidebar"}
        aria-expanded={open}
        title={open ? "Close sidebar" : "Open sidebar"}
      >
        <span aria-hidden="true">{open ? "‹" : "›"}</span>
      </button>
    </>
  );
}

function StatCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string;
  hint: string;
  icon: string;
}) {
  return (
    <div className="stat-card">
      <div className="stat-top">
        <span>{label}</span>
        <span className="stat-icon">
          <Icon name={icon} size={15} />
        </span>
      </div>
      <div className="stat-value">
        {value}
        <span className="stat-hint">{hint}</span>
      </div>
    </div>
  );
}

function OpportunityCard({
  opportunity,
  selected,
  onSelect,
  onSave,
}: {
  opportunity: Opportunity;
  selected: boolean;
  onSelect: (id: string) => void;
  onSave: (opportunity: Opportunity) => void;
}) {
  const titleContext = [opportunity.labGroup, opportunity.professor]
    .filter((value): value is string => Boolean(value?.trim()))
    .filter((value) => !opportunity.title.toLocaleLowerCase().includes(value.toLocaleLowerCase()))
    .slice(0, 2);
  return (
    <article className="opportunity-card">
      <div className="opportunity-top">
        <label
          className="check-wrap"
          aria-label={`Select ${opportunity.title}`}
        >
          <input
            className="check"
            type="checkbox"
            checked={selected}
            onChange={() => onSelect(opportunity.id)}
          />
        </label>
        <div className="opp-main">
          <div className="opp-title-line">
            <div>
              <h3 className="opp-title">
                {titleContext.length > 0 && <span className="opp-title-context">{titleContext.join(" · ")} — </span>}
                {opportunity.title}
              </h3>
              <div className="university">
                {opportunity.institution} <span aria-hidden="true">·</span>{" "}
                {opportunity.country}
              </div>
            </div>
            <span className={`status ${opportunity.verified ? "" : "review"}`}>
              {opportunity.verified ? (
                <Icon name="check" size={11} />
              ) : (
                <Icon name="clock" size={11} />
              )}
              {opportunity.verified ? "Manually verified" : opportunity.verificationStatus === "SOURCE_CHECKED" ? "Source checked" : "Not verified"}
            </span>
          </div>
        </div>
      </div>
      <div className="opp-details">
        <span className={`status ${opportunity.leadStatus === "CONFIRMED_FUNDED" ? "" : "review"}`}>
          {opportunity.leadStatus === "CONFIRMED_FUNDED" ? "Funding evidence found" : opportunity.leadStatus === "PROFESSOR_OR_LAB_LEAD" ? "Professor / lab lead · funding unknown" : "Potential · needs review"}
        </span>
        <span className="pill">{(opportunity.category ?? "Opportunity").replaceAll("_", " ")}</span>
        <span className="pill">{opportunity.degree}</span>
        <span className="pill">{opportunity.field}</span>
        <span className="pill funded">{opportunity.funding}</span>
        {opportunity.fundingClassification && <span className="pill">{opportunity.fundingClassification.replaceAll("_", " ")}</span>}
      </div>
      {opportunity.description && <p className="lead-description">{opportunity.description}</p>}
      {(opportunity.professor || opportunity.department || opportunity.labGroup) && <div className="lead-context">
        {opportunity.professor && <span>Professor: {opportunity.professor}</span>}
        {opportunity.department && <span>{opportunity.department}</span>}
        {opportunity.labGroup && <span>{opportunity.labGroup}</span>}
      </div>}
      <div className="lead-context">
        <span>Intake: {opportunity.intake || "Unknown"}</span>
        <span>Eligibility: {opportunity.eligibility || "Unknown"}</span>
        <span>Contact: {opportunity.contactEmail ? <a href={`mailto:${opportunity.contactEmail}`}>{opportunity.contactEmail}</a> : "Unknown"}</span>
      </div>
      <div className="opp-footer">
        <div className="deadline">
          <strong>Deadline</strong> · {opportunity.deadline}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button className="inline-action" onClick={() => onSave(opportunity)}>{opportunity.isSaved ? "Saved" : "Save"}</button>
          <a className="source-link" href={opportunity.url} target="_blank" rel="noreferrer">View source <Icon name="arrow" size={11} /></a>
        </div>
      </div>
      {opportunity.fundingEvidence && <div className="opportunity-evidence">
        <div><strong>Funding evidence:</strong> {opportunity.fundingEvidence}</div>
      </div>}
    </article>
  );
}

function mapDatabaseOpportunity(record: Record<string, unknown>): Opportunity {
  const fundingClass = String(record.fundingClassification ?? "NO_EVIDENCE");
  const fundingEvidence = typeof record.fundingEvidence === "string" ? record.fundingEvidence : null;
  const sources = Array.isArray(record.sources) ? record.sources.flatMap((value) => value && typeof value === "object" && typeof (value as Record<string, unknown>).url === "string" ? [{ url: String((value as Record<string, unknown>).url), canonicalUrl: String((value as Record<string, unknown>).canonicalUrl ?? "") }] : []) : [];
  let rawEvidence = record.evidenceExcerpts;
  if (typeof rawEvidence === "string") { try { rawEvidence = JSON.parse(rawEvidence); } catch { rawEvidence = []; } }
  const evidenceItems = Array.isArray(rawEvidence) ? rawEvidence.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    if (typeof item.excerpt !== "string") return [];
    return [{ field: String(item.field ?? "evidence"), value: String(item.value ?? ""), excerpt: item.excerpt, sourceUrl: typeof item.sourceUrl === "string" ? item.sourceUrl : undefined }];
  }) : [];
  const evidenceExcerpts = [...new Map(evidenceItems.map((item) => [`${item.field}|${item.value}|${item.excerpt}`, item])).values()];
  return {
    id: String(record.id), title: String(record.title), institution: String(record.institution ?? "Unknown"),
    country: String(record.country ?? "Unknown"), degree: String(record.degreeLevel ?? "Unknown"),
    field: String(record.researchField ?? "Unknown"), funding: fundingEvidence ?? (typeof record.fundingType === "string" ? record.fundingType : "Funding not confirmed"),
    deadline: String(record.deadlineLabel ?? "Unknown"), deadlineDate: String(record.deadlineDate ?? ""), url: String(record.sourceUrl ?? ""),
    verified: record.verificationStatus === "MANUALLY_VERIFIED", fundingClassification: fundingClass, fundingEvidence,
    status: String(record.status ?? "UNCERTAIN"), verificationStatus: String(record.verificationStatus ?? "UNVERIFIED"),
    lastCheckedAt: typeof record.lastCheckedAt === "string" ? record.lastCheckedAt : null, isSaved: Boolean(record.isSaved),
    extractionMethod: typeof record.extractionMethod === "string" ? record.extractionMethod : null,
    extractionError: typeof record.extractionError === "string" ? record.extractionError : null,
    lastExtractionAt: typeof record.lastExtractionAt === "string" ? record.lastExtractionAt : null,
    category: String(record.category ?? "OTHER_RESEARCH_LEAD"), leadStatus: String(record.leadStatus ?? "POTENTIAL_OPPORTUNITY"),
    description: typeof record.description === "string" ? record.description : null,
    department: typeof record.department === "string" ? record.department : null,
    labGroup: typeof record.labGroup === "string" ? record.labGroup : null,
    professor: typeof record.supervisorName === "string" ? record.supervisorName : null, sourceUrls: sources,
    intake: [record.intakeTerm, record.intakeYear].filter((value) => value !== null && value !== undefined && value !== "").join(" ") || "Unknown",
    contactEmail: typeof record.contactEmail === "string" ? record.contactEmail : null,
    eligibility: typeof record.eligibilityRequirements === "string" ? record.eligibilityRequirements : "Unknown",
    extractionStatus: typeof record.extractionStatus === "string" ? record.extractionStatus : null,
    evidenceExcerpts,
  };
}

export default function DashboardClient({ username }: { username: string }) {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [todayLabel, setTodayLabel] = useState("");
  const [searchResults, setSearchResults] = useState<Opportunity[]>([]);
  const [totalResults, setTotalResults] = useState(0);
  const [savedCount, setSavedCount] = useState(0);
  const [savedOnly, setSavedOnly] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMoreResults, setHasMoreResults] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [maxDrafts, setMaxDrafts] = useState(5);
  const [degree, setDegree] = useState("Any degree");
  const [country, setCountry] = useState("Any country");
  const [field, setField] = useState("Any field");
  const [funding, setFunding] = useState("Any funding");
  const [deadline, setDeadline] = useState("Any deadline");
  const [category, setCategory] = useState("Any type");
  const [searchText, setSearchText] = useState("");
  const [eligibility, setEligibility] = useState("");
  const [sort, setSort] = useState("Recommended");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [notice, setNotice] = useState("");
  const [editingDraft, setEditingDraft] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [draftSubject, setDraftSubject] = useState("");
  const [draftRecipientEmail, setDraftRecipientEmail] = useState("");
  const [emailTemplate, setEmailTemplate] = useState("");
  const [emailAdjustmentRules, setEmailAdjustmentRules] = useState("");
  const [applicantContext, setApplicantContext] = useState("");
  const [isSavingEmailSettings, setIsSavingEmailSettings] = useState(false);
  const [isGeneratingDrafts, setIsGeneratingDrafts] = useState(false);
  const [savingGmailDraft, setSavingGmailDraft] = useState<string | null>(null);
  const [removingDraft, setRemovingDraft] = useState<string | null>(null);
  const [draftRemovalErrors, setDraftRemovalErrors] = useState<Record<string, string>>({});
  const [gmailDraftErrors, setGmailDraftErrors] = useState<Record<string, string>>({});
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailConfigured, setGmailConfigured] = useState(false);
  const [gmailAccountEmail, setGmailAccountEmail] = useState<string | null>(null);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", cache: "no-store" });
      if (!response.ok) throw new Error("Sign out could not be completed.");
      router.replace("/login?signedOut=1");
    } catch (error) {
      setLoggingOut(false);
      setNotice(error instanceof Error ? error.message : "Sign out could not be completed.");
    }
  }

  useEffect(() => {
    let active = true;
    void fetch("/api/auth/logout", { method: "HEAD", cache: "no-store" }).catch(() => undefined);
    setTodayLabel(new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "2-digit",
      year: "numeric",
    }).format(new Date()).toUpperCase());
    void Promise.all([
      fetch("/api/opportunities?page=1&pageSize=50").then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not load saved opportunities."); return data; }),
      fetch("/api/drafts").then((response) => response.ok ? response.json() : null).catch(() => null),
      fetch("/api/email-settings").then((response) => response.ok ? response.json() : null).catch(() => null),
      fetch("/api/gmail/connection").then((response) => response.ok ? response.json() : null).catch(() => null),
    ]).then(([opportunityData, draftData, settingsData, gmailData]) => {
      if (!active) return;
      if (Array.isArray(opportunityData?.opportunities)) {
        const records = opportunityData.opportunities as Record<string, unknown>[];
        setSearchResults(records.map(mapDatabaseOpportunity));
        setTotalResults(Number(opportunityData.total ?? records.length));
        setCurrentPage(Number(opportunityData.page ?? 1));
        setHasMoreResults(Number(opportunityData.page ?? 1) < Number(opportunityData.pages ?? 1));
        setSelected([]);
      }
      if (Array.isArray(draftData?.drafts)) setDrafts(draftData.drafts.map((draft: Record<string, unknown>) => ({
        id: String(draft.id), professor: String(draft.recipientName ?? "Recipient unknown"), institution: String((draft.opportunity as Record<string, unknown> | null)?.institution ?? ""),
        recipientEmail: typeof draft.recipientEmail === "string" ? draft.recipientEmail : null,
        opportunity: String((draft.opportunity as Record<string, unknown> | null)?.title ?? "Opportunity unavailable"), preview: String(draft.body),
        subject: String(draft.subject ?? "Prospective graduate research inquiry"), gmailDraftId: typeof draft.gmailDraftId === "string" ? draft.gmailDraftId : null,
        status: draft.gmailDraftId ? "Saved to Gmail" as const : "Ready to review" as const,
      })));
      if (settingsData?.settings) {
        setEmailTemplate(String(settingsData.settings.baseTemplate ?? ""));
        setEmailAdjustmentRules(String(settingsData.settings.adjustmentRules ?? ""));
        setApplicantContext(String(settingsData.settings.applicantContext ?? ""));
      }
      if (gmailData) {
        setGmailConnected(Boolean(gmailData.connected));
        setGmailConfigured(Boolean(gmailData.configured));
        setGmailAccountEmail(typeof gmailData.accountEmail === "string" ? gmailData.accountEmail : null);
      }
      const gmailResult = new URLSearchParams(window.location.search).get("gmail");
      if (gmailResult === "connected") setNotice("Gmail connected. Drafts will only be created after you choose Save to Gmail.");
      else if (gmailResult === "error") setNotice(`Gmail connection failed: ${new URLSearchParams(window.location.search).get("reason") || "check the connection settings."}`);
    }).catch((error: unknown) => { if (active) setSearchError(error instanceof Error ? error.message : "Could not load saved records."); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    void fetch("/api/opportunities?page=1&pageSize=1&savedOnly=true")
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json();
      })
      .then((data) => { if (active && data) setSavedCount(Number(data.total ?? 0)); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const filtered = useMemo(() => {
    const list = [...searchResults];
    if (sort === "Deadline") list.sort((a, b) => (a.deadlineDate || "9999").localeCompare(b.deadlineDate || "9999"));
    if (sort === "Country") list.sort((a, b) => a.country.localeCompare(b.country));
    return list;
  }, [searchResults, sort]);
  const countryOptions = useMemo(() => [...new Set([
    "United States",
    ...searchResults.map((item) => item.country).filter((value) => value !== "Unknown" && !/^(?:us|u\.?s\.?a?\.?)$/i.test(value.trim())),
  ])], [searchResults]);

  function toggleSelected(id: string) {
    setSelected((items) =>
      items.includes(id) ? items.filter((item) => item !== id) : [...items, id],
    );
  }
  async function createDrafts() {
    const amount = Math.min(selected.length, maxDrafts);
    if (!amount) {
      setNotice("Select at least one opportunity to prepare a draft.");
      return;
    }
    setIsGeneratingDrafts(true);
    setNotice("");
    try {
      const response = await fetch("/api/drafts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunityIds: selected.slice(0, amount), maxDrafts: amount }),
      });
      const payload = await response.json();
      if (!response.ok && !Array.isArray(payload.drafts)) throw new Error(payload.error || "Could not generate email drafts.");
      const generated: Draft[] = (Array.isArray(payload.drafts) ? payload.drafts : []).map((draft: Record<string, unknown>) => ({
        id: String(draft.id),
        professor: String(draft.recipientName ?? "Recipient unknown"),
        recipientEmail: typeof draft.recipientEmail === "string" ? draft.recipientEmail : null,
        institution: String((draft.opportunity as Record<string, unknown> | null)?.institution ?? ""),
        opportunity: String((draft.opportunity as Record<string, unknown> | null)?.title ?? "Opportunity unavailable"),
        preview: String(draft.body),
        subject: String(draft.subject ?? "Prospective graduate research inquiry"),
        gmailDraftId: null,
        status: "Ready to review" as const,
      }));
      setDrafts((items) => [...generated, ...items]);
      setSelected([]);
      const failed = Array.isArray(payload.errors) ? payload.errors.length : 0;
      const firstFailure = failed && typeof payload.errors[0]?.error === "string" ? payload.errors[0].error : "";
      setNotice(generated.length
        ? `${generated.length} AI draft${generated.length === 1 ? "" : "s"} generated and saved for review.${failed ? ` ${failed} could not be generated: ${firstFailure}` : ""}`
        : firstFailure || "No drafts were generated. Check the Gemini key and draft settings.");
      document.getElementById("drafts")?.scrollIntoView({ behavior: "smooth" });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not generate email drafts.");
    } finally { setIsGeneratingDrafts(false); }
  }
  function databaseSearchUrl(page = 1, onlySaved = savedOnly, ignoreFilters = false) {
    const params = new URLSearchParams({ page: String(page), pageSize: "50", sort });
    if (onlySaved) params.set("savedOnly", "true");
    if (!ignoreFilters) {
      params.set("degree", degree);
      params.set("country", country);
      params.set("field", field);
      params.set("deadline", deadline);
      if (funding === "Fully funded") params.set("funding", "FULL");
      if (funding === "Partial or full funding") params.set("funding", "Funded");
      if (funding === "Unconfirmed funding") params.set("funding", "Unconfirmed");
      if (funding === "Scholarship") params.set("funding", "Scholarship");
      if (category !== "Any type") params.set("category", category);
      if (searchText.trim()) params.set("q", searchText.trim());
      if (eligibility.trim()) params.set("eligibility", eligibility.trim());
    }
    return `/api/opportunities?${params.toString()}`;
  }
  async function fetchDatabaseResults(page = 1, append = false, onlySaved = savedOnly, ignoreFilters = false) {
    const response = await fetch(databaseSearchUrl(page, onlySaved, ignoreFilters));
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Database search failed.");
    const records = Array.isArray(payload.opportunities) ? payload.opportunities.map(mapDatabaseOpportunity) : [];
    if (append) {
      setSearchResults((current) => [...new Map([...current, ...records].map((item) => [item.id, item])).values()]);
    } else {
      setSearchResults(records);
      setSelected([]);
    }
    setTotalResults(Number(payload.total ?? records.length));
    setCurrentPage(Number(payload.page ?? page));
    setHasMoreResults(Number(payload.page ?? page) < Number(payload.pages ?? page));
  }
  async function searchDatabase() {
    setIsSearching(true); setSearchError(""); setNotice("");
    try { await fetchDatabaseResults(); }
    catch (error) { setSearchError(error instanceof Error ? error.message : "Database search failed."); setSearchResults([]); }
    finally { setIsSearching(false); document.getElementById("opportunities")?.scrollIntoView({ behavior: "smooth" }); }
  }
  async function toggleSavedView() {
    const next = !savedOnly;
    setSavedOnly(next);
    setDegree("Any degree");
    setCountry("Any country");
    setField("Any field");
    setFunding("Any funding");
    setDeadline("Any deadline");
    setCategory("Any type");
    setSearchText("");
    setEligibility("");
    setIsSearching(true);
    setSearchError("");
    setNotice("");
    try { await fetchDatabaseResults(1, false, next, true); }
    catch (error) { setSearchError(error instanceof Error ? error.message : "Could not load saved opportunities."); setSearchResults([]); }
    finally { setIsSearching(false); }
  }
  async function loadMoreResults() {
    setIsLoadingMore(true);
    setSearchError("");
    try { await fetchDatabaseResults(currentPage + 1, true); }
    catch (error) { setSearchError(error instanceof Error ? error.message : "Could not load more opportunities."); }
    finally { setIsLoadingMore(false); }
  }
  function handleDraftEdit(id: string) {
    const draft = drafts.find((item) => item.id === id);
    if (draft) {
      setEditingDraft(id);
      setDraftText(draft.preview);
      setDraftSubject(draft.subject);
      setDraftRecipientEmail(draft.recipientEmail ?? "");
    }
  }
  async function saveDraftEdit() {
    if (!editingDraft) return;
      try {
        const response = await fetch(`/api/drafts/${editingDraft}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: draftText, subject: draftSubject, recipientEmail: draftRecipientEmail }),
        });
        const payload = await response.json();
        if (!response.ok) { setNotice(payload.error || "Could not save draft changes."); return; }
        setDrafts((items) => items.map((item) => item.id === editingDraft ? {
          ...item, preview: draftText, subject: draftSubject, recipientEmail: draftRecipientEmail || null, status: "Ready to review",
        } : item));
        setEditingDraft(null);
        setNotice("Draft changes saved.");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not save draft changes.");
      }
  }
  async function handleDraftSave(draft: Draft) {
    setSavingGmailDraft(draft.id);
    setGmailDraftErrors((errors) => { const next = { ...errors }; delete next[draft.id]; return next; });
    setNotice("");
    try {
      const response = await fetch(`/api/drafts/${draft.id}/gmail`, { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Could not save the draft to Gmail.");
        if (typeof payload.gmailDraftId !== "string") throw new Error("Gmail did not confirm a draft ID. Check the connected account's Drafts folder before retrying.");
      setDrafts((items) => items.map((item) => item.id === draft.id ? { ...item, gmailDraftId: String(payload.gmailDraftId), status: "Saved to Gmail" } : item));
        const accountEmail = typeof payload.accountEmail === "string" ? payload.accountEmail : gmailAccountEmail;
        setNotice(`Draft saved to ${accountEmail || "the connected Gmail account"} Drafts. It has not been sent.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save the draft to Gmail.";
      setGmailDraftErrors((errors) => ({ ...errors, [draft.id]: message }));
      setNotice(message);
    }
    finally { setSavingGmailDraft(null); }
  }
  async function removeDraftFromApp(draft: Draft) {
    setRemovingDraft(draft.id);
    setDraftRemovalErrors((errors) => { const next = { ...errors }; delete next[draft.id]; return next; });
    try {
      const response = await fetch(`/api/drafts/${draft.id}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Could not remove the draft from GradFund Finder.");
      setDrafts((items) => items.filter((item) => item.id !== draft.id));
      setGmailDraftErrors((errors) => { const next = { ...errors }; delete next[draft.id]; return next; });
      setNotice(draft.gmailDraftId
        ? "Removed from GradFund Finder. The Gmail draft was left unchanged."
        : "Draft removed from GradFund Finder.");
    } catch (error) {
      setDraftRemovalErrors((errors) => ({ ...errors, [draft.id]: error instanceof Error ? error.message : "Could not remove the draft." }));
    } finally {
      setRemovingDraft(null);
    }
  }
  async function saveEmailSettings() {
    setIsSavingEmailSettings(true);
    setNotice("");
    try {
      const response = await fetch("/api/email-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseTemplate: emailTemplate, adjustmentRules: emailAdjustmentRules, applicantContext }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not save email settings.");
      setNotice("Email template and adjustment rules saved.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not save email settings."); }
    finally { setIsSavingEmailSettings(false); }
  }
  async function disconnectGmail() {
      try {
        const response = await fetch("/api/gmail/connection", { method: "DELETE" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) { setNotice(payload.error || "Could not disconnect Gmail."); return; }
        setGmailConnected(false);
        setGmailAccountEmail(null);
        setNotice("Gmail has been disconnected.");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not disconnect Gmail.");
      }
  }

  const upcomingDeadlines = searchResults.filter((item) => {
    if (!item.deadlineDate) return false;
    const daysUntilDeadline = (new Date(item.deadlineDate).getTime() - Date.now()) / 86400000;
    return daysUntilDeadline >= 0 && daysUntilDeadline <= 30;
  }).length;

  return (
    <div className="app-shell">
      <Sidebar open={sidebarOpen} onToggle={() => setSidebarOpen((open) => !open)} opportunityCount={filtered.length} username={username} onLogout={() => { void handleLogout(); }} loggingOut={loggingOut} />
      <main className={`main dashboard-enter ${sidebarOpen ? "has-sidebar" : ""}`}>
        <header className="topbar">
          <div className="topbar-message"><span className="topbar-indicator" aria-hidden="true" /><span className="top-note">Your next chapter, fully funded.</span></div>
          <div className="topbar-profile"><span className="topbar-user">{username}</span><div className="avatar top-avatar">{username.slice(0, 2).toLocaleUpperCase("en-US")}</div></div>
        </header>
        <div className="content" id="overview">
          <div className="welcome-row">
            <div>
              <div className="eyebrow">{todayLabel || "TODAY"}</div>
              <h1 className="page-heading">
                Good morning, {username} <span aria-hidden="true"><Icon name="spark" size={19} /></span>
              </h1>
              <p className="subheading">
                A few promising opportunities are waiting for you.
              </p>
            </div>
            <button
              className="button button-primary"
              onClick={() =>
                document
                  .getElementById("search-panel")
                  ?.scrollIntoView({ behavior: "smooth" })
              }
            >
              <Icon name="spark" size={15} /> Find opportunities
            </button>
          </div>
          <div className="stats-grid">
            <StatCard
              label="Opportunities found"
              value={String(totalResults)}
              hint="saved records"
              icon="search"
            />
            <StatCard
              label="Saved for later"
              value={String(savedCount)}
              hint="opportunities"
              icon="book"
            />
            <StatCard
              label="Drafts to review"
              value={String(drafts.length)}
              hint="ready when you are"
              icon="mail"
            />
            <StatCard
              label="Upcoming deadlines"
              value={String(upcomingDeadlines)}
              hint="in 30 days"
              icon="calendar"
            />
          </div>

          <section id="search-panel">
            <div className="section-heading">
              <div>
                <h2 className="section-title">Find your next opportunity</h2>
                <div className="section-caption">Search saved database records using your filters.</div>
              </div>
            </div>
            <div className="panel search-panel">
              <div className="search-intro">
                <span className="search-glyph">
                  <Icon name="globe" size={17} />
                </span>
                <div>
                  <div className="search-title">Search your opportunity database</div>
                  <div className="search-copy">Filter opportunities that have already been collected and saved to the database.</div>
                </div>
              </div>
              <div className="search-bottom" id="filters">
                <div className="filters">
                  <input className="control" aria-label="Search titles and descriptions" placeholder="Search titles, labs, professors" value={searchText} onChange={(event) => setSearchText(event.target.value)} />
                  <input className="control" aria-label="Filter by eligibility" placeholder="Eligibility keyword" value={eligibility} onChange={(event) => setEligibility(event.target.value)} />
                  <select
                    className="control"
                    aria-label="Filter by degree"
                    value={degree}
                    onChange={(event) => setDegree(event.target.value)}
                  >
                    <option>Any degree</option>
                    <option>Master&apos;s</option>
                    <option>PhD</option>
                  </select>
                  <select
                    className="control"
                    aria-label="Filter by country"
                    value={country}
                    onChange={(event) => setCountry(event.target.value)}
                  >
                    <option>Any country</option>
                    {countryOptions.map((place) => (
                      <option key={place}>{place}</option>
                    ))}
                  </select>
                  <select
                    className="control"
                    aria-label="Filter by research field"
                    value={field}
                    onChange={(event) => setField(event.target.value)}
                  >
                    <option>Any field</option>
                    {[...new Set(searchResults.map((item) => item.field).filter((value) => value !== "Unknown"))].map(
                      (subject) => (
                        <option key={subject}>{subject}</option>
                      ),
                    )}
                  </select>
                  <select
                    className="control"
                    aria-label="Filter by deadline"
                    value={deadline}
                    onChange={(event) => setDeadline(event.target.value)}
                  >
                    <option>Any deadline</option>
                    <option>Next 30 days</option>
                    <option>Next 90 days</option>
                  </select>
                  <select className="control" aria-label="Filter by opportunity type" value={category} onChange={(event) => setCategory(event.target.value)}>
                    <option>Any type</option><option value="SCHOLARSHIP">Scholarship</option><option value="FUNDED_POSITION">Funded position</option><option value="GRADUATE_PROGRAM">Graduate program</option><option value="PROFESSOR">Professor lead</option><option value="LAB">Lab / group lead</option><option value="OTHER_RESEARCH_LEAD">Other research lead</option>
                  </select>
                  <select className="control" aria-label="Filter by funding evidence" value={funding} onChange={(event) => setFunding(event.target.value)}>
                    <option>Any funding</option><option>Fully funded</option><option>Partial or full funding</option><option>Unconfirmed funding</option><option>Scholarship</option>
                  </select>
                </div>
                <div className="search-actions">
                  <button
                    className="button"
                    onClick={() => {
                      setDegree("Any degree");
                      setCountry("Any country");
                      setField("Any field");
                      setFunding("Any funding");
                      setDeadline("Any deadline");
                      setCategory("Any type");
                      setSearchText("");
                      setEligibility("");
                      setSavedOnly(false);
                      setSearchError("");
                      void fetch("/api/opportunities?page=1&pageSize=50")
                        .then(async (response) => {
                          const payload = await response.json();
                          if (!response.ok) throw new Error(payload.error || "Database search failed.");
                          setSearchResults(Array.isArray(payload.opportunities) ? payload.opportunities.map(mapDatabaseOpportunity) : []);
                          setTotalResults(Number(payload.total ?? payload.opportunities?.length ?? 0));
                          setCurrentPage(Number(payload.page ?? 1));
                          setHasMoreResults(Number(payload.page ?? 1) < Number(payload.pages ?? 1));
                          setSelected([]);
                        })
                        .catch((error: unknown) => setSearchError(error instanceof Error ? error.message : "Database search failed."));
                    }}
                  >
                    Clear
                  </button>
                  <button
                    className="button button-primary"
                    onClick={searchDatabase}
                    disabled={isSearching}
                  >
                    <Icon name="search" size={14} /> {isSearching ? "Searching..." : "Search database"}</button>

                </div>
              </div>
            </div>
          </section>

          <section id="opportunities">
            <SectionHeading
              title={savedOnly ? "Saved opportunities" : "Opportunities and research leads"}
              caption={savedOnly ? "Your saved opportunities, ready to revisit." : "Saved database records. Funding and verification labels reflect available evidence."}
              action={
                <button className="button" onClick={toggleSavedView} disabled={isSearching}>
                  {savedOnly ? "View all opportunities" : "Saved for later"} <span aria-hidden="true">→</span>
                </button>
              }
            />
            <div className="list-toolbar">
              <div className="result-count">
                <strong>{filtered.length} shown</strong>{" "}
                <span>of {totalResults} database records</span>
              </div>
              <div className="toolbar-right">
                <span className="result-count">Sort by</span>
                <select
                  className="control sort-select"
                  value={sort}
                  onChange={(event) => setSort(event.target.value)}
                >
                  <option>Recommended</option>
                  <option>Deadline</option>
                  <option>Country</option>
                </select>
              </div>
            </div>
            {selected.length > 0 && (
              <div className="selection-bar">
                <div className="selection-info">
                  {selected.length} opportunity
                  {selected.length === 1 ? "" : "ies"} selected
                </div>
                <div className="selection-controls">
                  <label htmlFor="max-drafts">Max email drafts</label>
                  <input
                    id="max-drafts"
                    className="control number-input"
                    type="number"
                    min={1}
                    max={Math.min(selected.length, 50)}
                    value={Math.min(maxDrafts, selected.length, 50)}
                    onChange={(event) =>
                      setMaxDrafts(
                        Math.max(
                          1,
                          Math.min(
                            selected.length,
                            50,
                            Number(event.target.value) || 1,
                          ),
                        ),
                      )
                    }
                  />
                  <button
                    className="button button-primary"
                    onClick={createDrafts}
                    disabled={isGeneratingDrafts}
                  >
                    {isGeneratingDrafts ? "Generating drafts..." : "Generate AI drafts"} <Icon name="arrow" size={13} />
                  </button>
                </div>
              </div>
            )}
            {isSearching && <div className="search-state" role="status">Searching stored records with selected filters...</div>}
            {searchError && <div className="search-state search-error" role="alert">{searchError}</div>}
            {notice && (
              <div
                role="status"
                style={{ fontSize: 11, color: "#58765f", margin: "0 0 10px" }}
              >
                {notice}
              </div>
            )}
          <div className="opportunity-list">
              {filtered.map((item) => (
                <OpportunityCard
                  key={item.id}
                  opportunity={item}
                  selected={selected.includes(item.id)}
                  onSelect={toggleSelected}
                  onSave={async (opportunity) => {
                    const response = await fetch(`/api/opportunities/${opportunity.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isSaved: !opportunity.isSaved }) });
                    if (response.ok) {
                      const nextSaved = !opportunity.isSaved;
                      setSavedCount((count) => Math.max(0, count + (nextSaved ? 1 : -1)));
                      if (savedOnly && !nextSaved) {
                        setSearchResults((items) => items.filter((current) => current.id !== opportunity.id));
                        setTotalResults((count) => Math.max(0, count - 1));
                        setSelected((items) => items.filter((id) => id !== opportunity.id));
                      } else {
                        setSearchResults((items) => items.map((current) => current.id === opportunity.id ? { ...current, isSaved: nextSaved } : current));
                      }
                    }
                    else setNotice("Saving opportunities requires the database to be configured.");
                  }}
                />
              ))}
              {!isSearching && !searchError && filtered.length === 0 && (
                <div className="empty-state">
                  "No saved records match these filters. Try broader criteria or search again after the separate collection process has saved more records."
                </div>
              )}
            </div>
            {hasMoreResults && !searchError && <div className="load-more-row">
              <button className="button" onClick={loadMoreResults} disabled={isLoadingMore || isSearching}>
                {isLoadingMore ? "Loading more..." : `Load more opportunities (${Math.max(0, totalResults - searchResults.length)} remaining)`}
              </button>
            </div>}
          </section>

          <section id="drafts" style={{ marginTop: 32 }}>
            <SectionHeading
              title="Email drafts"
              caption="Generated with Gemini, reviewed here, then saved to Gmail only when you choose."
              action={
                <span className="status review">
                  {drafts.length} drafts
                </span>
              }
            />
            <div className="panel email-settings">
              <div className="section-heading">
                <div>
                  <h3 className="section-title">Email drafting settings</h3>
                  <div className="section-caption">Your template and adjustment rules are stored in MySQL.</div>
                </div>
                <div className="gmail-connection">
                  <span className={`status ${gmailConnected ? "" : "review"}`}>
                    {gmailConnected ? `Gmail connected${gmailAccountEmail ? ` · ${gmailAccountEmail}` : ""}` : "Gmail not connected"}
                  </span>
                  {gmailConnected ? (
                    <>
                      {gmailAccountEmail && <a className="inline-action" href={`https://mail.google.com/mail/?authuser=${encodeURIComponent(gmailAccountEmail)}#drafts`} target="_blank" rel="noreferrer">Open Gmail drafts</a>}
                      <button className="inline-action" onClick={() => void disconnectGmail()}>Disconnect</button>
                    </>
                  ) : gmailConfigured ? (
                    <button className="button" onClick={() => { window.location.href = "/api/gmail/connect"; }}>Connect Gmail</button>
                  ) : (
                    <span className="field-hint">Configure Google OAuth and token encryption in .env.local.</span>
                  )}
                </div>
              </div>
              <label className="label" htmlFor="email-template">Base email template</label>
              <textarea id="email-template" className="url-area settings-area" value={emailTemplate} onChange={(event) => setEmailTemplate(event.target.value)} placeholder="Paste your base professor email template here." />
              <div className="field-hint">Placeholders can be adapted from supported opportunity evidence. Unsupported research-fit placeholders will remain for you to complete.</div>
              <label className="label" htmlFor="email-adjustment-rules">AI adjustment rules</label>
              <textarea id="email-adjustment-rules" className="url-area settings-area compact-area" value={emailAdjustmentRules} onChange={(event) => setEmailAdjustmentRules(event.target.value)} />
              <label className="label" htmlFor="applicant-context">Applicant context (optional)</label>
              <textarea id="applicant-context" className="url-area settings-area compact-area" value={applicantContext} onChange={(event) => setApplicantContext(event.target.value)} placeholder="Add your research interests or the contribution you want the email to describe." />
              <button className="button button-primary settings-save" onClick={() => void saveEmailSettings()} disabled={isSavingEmailSettings}>
                {isSavingEmailSettings ? "Saving settings..." : "Save email settings"}
              </button>
            </div>
            <div className="panel">
              <div className="draft-grid">
                {drafts.map((draft) => (
                  <article className="draft-card" key={draft.id}>
                    <div className="draft-top">
                      <div>
                        <div className="draft-name">{draft.professor}</div>
                        <div className="draft-meta">
                          {draft.institution}
                          <br />
                          For: {draft.opportunity}
                          <br />
                          {draft.recipientEmail || "No recipient email; add one before saving if desired."}
                        </div>
                      </div>
                      <span
                        className={`status ${draft.status === "In progress" ? "review" : ""}`}
                      >
                        {draft.status === "Ready to review" ? (
                          <Icon name="check" size={11} />
                        ) : (
                          <Icon name="clock" size={11} />
                        )}
                        {draft.status}
                      </span>
                    </div>
                    {editingDraft === draft.id ? (
                      <>
                        <textarea
                          className="url-area draft-editor"
                          aria-label={`Edit draft for ${draft.professor}`}
                          value={draftText}
                          onChange={(event) => setDraftText(event.target.value)}
                        />
                        <div className="draft-buttons">
                          <button
                            className="button button-primary"
                            onClick={saveDraftEdit}
                          >
                            Save changes
                          </button>
                          <button
                            className="button"
                            onClick={() => setEditingDraft(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="draft-meta draft-subject">Subject: {draft.subject}</div>
                        <div className="draft-preview">{draft.preview}</div>
                        <div className="draft-buttons">
                          <button
                            className="button"
                            onClick={() => handleDraftEdit(draft.id)}
                          >
                            Review & edit
                          </button>
                          <button className="button button-primary" onClick={() => void handleDraftSave(draft)} disabled={savingGmailDraft === draft.id}>
                            {savingGmailDraft === draft.id ? "Saving..." : draft.gmailDraftId ? "Update Gmail draft" : "Save to Gmail"}
                          </button>
                        </div>
                      </>
                    )}
                    {gmailDraftErrors[draft.id] && <div className="search-state search-error" role="alert" style={{ marginTop: 12 }}>{gmailDraftErrors[draft.id]}</div>}
                    <div className="draft-remove-row">
                      <button className="source-remove draft-remove" onClick={() => void removeDraftFromApp(draft)} disabled={removingDraft === draft.id} title="Only removes this app's copy; it does not delete anything from Gmail.">
                        {removingDraft === draft.id ? "Removing..." : "Remove from app"}
                      </button>
                      <span>This does not change Gmail drafts.</span>
                    </div>
                    {draftRemovalErrors[draft.id] && <div className="search-state search-error" role="alert" style={{ marginTop: 8 }}>{draftRemovalErrors[draft.id]}</div>}
                    {editingDraft === draft.id && (
                      <>
                        <label className="label" htmlFor={`draft-subject-${draft.id}`}>Subject</label>
                        <input id={`draft-subject-${draft.id}`} className="control draft-field" value={draftSubject} onChange={(event) => setDraftSubject(event.target.value)} />
                        <label className="label" htmlFor={`draft-recipient-${draft.id}`}>Recipient email (optional)</label>
                        <input id={`draft-recipient-${draft.id}`} className="control draft-field" type="email" value={draftRecipientEmail} onChange={(event) => setDraftRecipientEmail(event.target.value)} />
                      </>
                    )}
                  </article>
                ))}
                {drafts.length === 0 && <div className="empty-state">Select database opportunities and choose Generate AI drafts to create drafts for review.</div>}
              </div>
              <div className="field-hint" style={{ marginTop: 12 }}>
                Generated drafts are saved in the app. Save to Gmail creates or updates a Gmail draft; it never sends the email. Removing a draft here only removes the app's copy and never deletes the Gmail draft.
              </div>
            </div>
          </section>
          <footer
            style={{
              borderTop: "1px solid var(--line)",
              paddingTop: 15,
              marginTop: 35,
              color: "#9aa39d",
              fontSize: 10,
            }}
          >
            GradFund Finder <span style={{ margin: "0 6px" }}>·</span> Database search
          </footer>
        </div>
      </main>
    </div>
  );
}


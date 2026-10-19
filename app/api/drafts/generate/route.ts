import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { query } from "@/lib/db";
import { DEFAULT_ADJUSTMENT_RULES, DEFAULT_EMAIL_TEMPLATE } from "@/lib/email/default-settings";
import { generateOpportunityEmail } from "@/lib/email/draft-agent";
import { getRequestUser } from "@/lib/auth/session";
import { unauthorized } from "@/lib/auth/request";

type OpportunityRow = {
  id: string;
  title: string;
  institution: string | null;
  country: string | null;
  degreeLevel: string | null;
  researchField: string | null;
  supervisorName: string | null;
  contactEmail: string | null;
  description: string | null;
  department: string | null;
  labGroup: string | null;
  evidenceExcerpts: unknown;
};

function parseEvidence(value: unknown) {
  if (typeof value === "string") {
    try { value = JSON.parse(value) as unknown; } catch { return []; }
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => item && typeof item === "object"
    && typeof item.field === "string" && typeof item.value === "string" && typeof item.excerpt === "string"
    ? [{ field: item.field.slice(0, 80), value: item.value.slice(0, 500), excerpt: item.excerpt.slice(0, 1200) }]
    : []).slice(0, 12);
}

export async function POST(request: Request) {
  try {
    const user = await getRequestUser(request);
    if (!user) return unauthorized();
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
    const input = await request.json() as Record<string, unknown>;
    const opportunityIds = Array.isArray(input.opportunityIds)
      ? [...new Set(input.opportunityIds.filter((id): id is string => typeof id === "string" && id.length <= 36))].slice(0, 50)
      : [];
    if (!opportunityIds.length) return NextResponse.json({ error: "Select at least one saved opportunity." }, { status: 400 });
    const maxDrafts = Math.min(opportunityIds.length, 50, Math.max(1, Math.trunc(Number(input.maxDrafts) || 5)));

    await query(
      `INSERT IGNORE INTO "EmailSettings" ("id","userId","baseTemplate","adjustmentRules") VALUES ($1,$2,$3,$4)`,
      [randomUUID().replaceAll("-", ""), user.id, DEFAULT_EMAIL_TEMPLATE, DEFAULT_ADJUSTMENT_RULES],
    );
    const settings = await query<{ baseTemplate: string; adjustmentRules: string; applicantContext: string | null }>(
      'SELECT "baseTemplate","adjustmentRules","applicantContext" FROM "EmailSettings" WHERE "userId"=$1',
      [user.id],
    );
    const config = settings.rows[0];
    if (!config?.baseTemplate.trim()) return NextResponse.json({ error: "Add and save your base email template in Email draft settings first." }, { status: 400 });

    const placeholders = opportunityIds.map((_, index) => `$${index + 1}`).join(",");
    const opportunities = await query<OpportunityRow>(
      `SELECT "id","title","institution","country","degreeLevel","researchField","supervisorName","contactEmail","description","department","labGroup","evidenceExcerpts"
       FROM "Opportunity" WHERE "id" IN (${placeholders})`,
      opportunityIds,
    );
    const byId = new Map(opportunities.rows.map((row) => [row.id, row]));
    const created: Array<Record<string, unknown>> = [];
    const errors: Array<{ opportunityId: string; error: string }> = [];
    for (const opportunityId of opportunityIds.slice(0, maxDrafts)) {
      const row = byId.get(opportunityId);
      if (!row) { errors.push({ opportunityId, error: "Opportunity was not found in the database." }); continue; }
      try {
        const draft = await generateOpportunityEmail({
          template: config.baseTemplate,
          adjustmentRules: config.adjustmentRules,
          applicantContext: config.applicantContext,
          opportunity: {
            title: row.title,
            institution: row.institution,
            country: row.country,
            degreeLevel: row.degreeLevel,
            researchField: row.researchField,
            supervisorName: row.supervisorName,
            description: row.description,
            department: row.department,
            labGroup: row.labGroup,
            evidence: parseEvidence(row.evidenceExcerpts),
          },
        });
        const id = randomUUID();
        await query(
          `INSERT INTO "EmailDraft" ("id","userId","opportunityId","recipientName","recipientEmail","subject","body","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())`,
          [id, user.id, row.id, row.supervisorName, row.contactEmail, draft.subject, draft.body],
        );
        created.push({ id, recipientName: row.supervisorName, recipientEmail: row.contactEmail, subject: draft.subject, body: draft.body, opportunity: { title: row.title, institution: row.institution } });
      } catch (error) {
        errors.push({ opportunityId, error: error instanceof Error ? error.message.slice(0, 300) : "Email draft generation failed." });
      }
    }
    return NextResponse.json({ drafts: created, generated: created.length, errors }, { status: created.length ? 201 : 502 });
  } catch (error) { return apiError(error); }
}

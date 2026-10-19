import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { apiError } from "@/lib/api-error";
import { getRequestUser } from "@/lib/auth/session";
import { sameOrigin, unauthorized } from "@/lib/auth/request";

export async function GET(request: Request) {
  try {
    const user = await getRequestUser(request);
    if (!user) return unauthorized();
    const drafts = await query('SELECT d.*, o."title" AS "opportunityTitle", o."institution" AS "opportunityInstitution" FROM "EmailDraft" d LEFT JOIN "Opportunity" o ON o."id"=d."opportunityId" WHERE d."userId"=$1 ORDER BY d."updatedAt" DESC', [user.id]);
    return NextResponse.json({ drafts: drafts.rows.map(({ opportunityTitle, opportunityInstitution, ...draft }) => ({ ...draft, opportunity: opportunityTitle ? { title: opportunityTitle, institution: opportunityInstitution } : null })) });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 });
    const user = await getRequestUser(request);
    if (!user) return unauthorized();
    const input = await request.json() as Record<string, unknown>;
    if (typeof input.opportunityId !== "string" || typeof input.body !== "string" || !input.body.trim() || input.body.length > 20_000) return NextResponse.json({ error: "Choose an opportunity and provide draft text (up to 20,000 characters)." }, { status: 400 });
    if (input.recipientEmail !== undefined && input.recipientEmail !== null && (typeof input.recipientEmail !== "string" || input.recipientEmail.length > 320)) return NextResponse.json({ error: "Recipient email must be under 320 characters." }, { status: 400 });
    const id = randomUUID();
    await query('INSERT INTO "EmailDraft" ("id", "userId", "opportunityId", "recipientName", "recipientEmail", "subject", "body", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())', [id,user.id,input.opportunityId,typeof input.recipientName === "string" ? input.recipientName.slice(0,200) : null,typeof input.recipientEmail === "string" ? input.recipientEmail.slice(0,320) : null,typeof input.subject === "string" ? input.subject.slice(0,300) : null,input.body]);
    const result = await query('SELECT * FROM "EmailDraft" WHERE "id"=$1 AND "userId"=$2', [id,user.id]);
    return NextResponse.json({ draft: result.rows[0] }, { status: 201 });
  } catch (error) { return apiError(error); }
}

import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { query } from "@/lib/db";
import { DEFAULT_ADJUSTMENT_RULES, DEFAULT_EMAIL_TEMPLATE } from "@/lib/email/default-settings";
import { randomUUID } from "node:crypto";
import { getRequestUser } from "@/lib/auth/session";
import { sameOrigin, unauthorized } from "@/lib/auth/request";

export async function GET(request: Request) {
  try {
    const user = await getRequestUser(request);
    if (!user) return unauthorized();
    await query(
      `INSERT IGNORE INTO "EmailSettings" ("id","userId","baseTemplate","adjustmentRules") VALUES ($1,$2,$3,$4)`,
      [randomUUID().replaceAll("-", ""), user.id, DEFAULT_EMAIL_TEMPLATE, DEFAULT_ADJUSTMENT_RULES],
    );
    const result = await query('SELECT "baseTemplate","adjustmentRules","applicantContext","updatedAt" FROM "EmailSettings" WHERE "userId"=$1', [user.id]);
    return NextResponse.json({ settings: result.rows[0] });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request) {
  try {
    if (!sameOrigin(request)) return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 });
    const user = await getRequestUser(request);
    if (!user) return unauthorized();
    const input = await request.json() as Record<string, unknown>;
    if (typeof input.baseTemplate !== "string" || !input.baseTemplate.trim() || input.baseTemplate.length > 20_000) return NextResponse.json({ error: "A base template of up to 20,000 characters is required." }, { status: 400 });
    if (typeof input.adjustmentRules !== "string" || !input.adjustmentRules.trim() || input.adjustmentRules.length > 8_000) return NextResponse.json({ error: "Adjustment instructions are required and must be under 8,000 characters." }, { status: 400 });
    if (input.applicantContext !== undefined && (typeof input.applicantContext !== "string" || input.applicantContext.length > 8_000)) return NextResponse.json({ error: "Applicant context must be text under 8,000 characters." }, { status: 400 });
    await query(
      `INSERT INTO "EmailSettings" ("id","userId","baseTemplate","adjustmentRules","applicantContext") VALUES ($1,$2,$3,$4,$5)
       ON DUPLICATE KEY UPDATE "baseTemplate"=VALUES("baseTemplate"),"adjustmentRules"=VALUES("adjustmentRules"),"applicantContext"=VALUES("applicantContext"),"updatedAt"=NOW()`,
      [randomUUID().replaceAll("-", ""), user.id, input.baseTemplate.trim(), input.adjustmentRules.trim(), String(input.applicantContext ?? "").trim() || null],
    );
    const saved = await query('SELECT "baseTemplate","adjustmentRules","applicantContext","updatedAt" FROM "EmailSettings" WHERE "userId"=$1', [user.id]);
    return NextResponse.json({ settings: saved.rows[0] });
  } catch (error) { return apiError(error); }
}

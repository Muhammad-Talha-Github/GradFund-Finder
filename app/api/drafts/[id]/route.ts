import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { apiError } from "@/lib/api-error";
import { getRequestUser } from "@/lib/auth/session";
import { sameOrigin, unauthorized } from "@/lib/auth/request";

export async function PATCH(request: Request, context: { params: { id: string } }) {
  try {
    if (!sameOrigin(request)) return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 });
    const user = await getRequestUser(request);
    if (!user) return unauthorized();
    const input = await request.json() as Record<string, unknown>;
    if (typeof input.body !== "string" || input.body.length > 20_000) return NextResponse.json({ error: "Draft text is required and must be under 20,000 characters." }, { status: 400 });
    if (input.subject !== undefined && (typeof input.subject !== "string" || input.subject.length > 300)) return NextResponse.json({ error: "Subject must be text under 300 characters." }, { status: 400 });
    if (input.recipientEmail !== undefined && input.recipientEmail !== null && (typeof input.recipientEmail !== "string" || input.recipientEmail.length > 320)) return NextResponse.json({ error: "Recipient email must be under 320 characters." }, { status: 400 });
    const result = await query('UPDATE "EmailDraft" SET "body"=$1, "recipientName"=COALESCE($2,"recipientName"), "subject"=IF($3,$4,"subject"), "recipientEmail"=IF($5,$6,"recipientEmail"), "updatedAt"=NOW() WHERE "id"=$7 AND "userId"=$8', [input.body,typeof input.recipientName === "string" ? input.recipientName.slice(0,200) : null,input.subject !== undefined,input.subject ?? null,input.recipientEmail !== undefined,input.recipientEmail ?? null,context.params.id,user.id]);
    if (!result.rowCount) return NextResponse.json({ error: "Draft not found." }, { status: 404 });
    const saved = await query('SELECT * FROM "EmailDraft" WHERE "id"=$1 AND "userId"=$2', [context.params.id,user.id]);
    return NextResponse.json({ draft: saved.rows[0] });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, context: { params: { id: string } }) {
  try {
    if (!sameOrigin(request)) return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 });
    const user = await getRequestUser(request);
    if (!user) return unauthorized();
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
    // This removes only the app's saved copy. Gmail is not called here.
    const result = await query('DELETE FROM "EmailDraft" WHERE "id"=$1 AND "userId"=$2', [context.params.id,user.id]);
    if (!result.rowCount) return NextResponse.json({ error: "Draft not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}

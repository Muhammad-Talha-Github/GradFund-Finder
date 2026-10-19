import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { query } from "@/lib/db";
import { GmailOperationError, saveDraftToGmail } from "@/lib/gmail/client";
import { getRequestUser } from "@/lib/auth/session";
import { unauthorized } from "@/lib/auth/request";

type DraftRow = { id: string; gmailDraftId: string | null; recipientEmail: string | null; subject: string | null; body: string };

export async function POST(request: Request, context: { params: { id: string } }) {
  try {
    const user = await getRequestUser(request);
    if (!user) return unauthorized();
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
    const result = await query<DraftRow>('SELECT "id","gmailDraftId","recipientEmail","subject","body" FROM "EmailDraft" WHERE "id"=$1 AND "userId"=$2', [context.params.id,user.id]);
    const draft = result.rows[0];
    if (!draft) return NextResponse.json({ error: "Draft not found." }, { status: 404 });
    const saved = await saveDraftToGmail({
      userId: user.id,
      localDraftId: draft.id,
      gmailDraftId: draft.gmailDraftId,
      recipientEmail: draft.recipientEmail,
      subject: draft.subject || "Prospective graduate research inquiry",
      body: draft.body,
    });
    return NextResponse.json({ ok: true, ...saved });
  } catch (error) {
    if (error instanceof GmailOperationError) {
      console.error(`[gmail draft save] stage=${error.stage} status=${error.statusCode}: ${error.message}`);
      return NextResponse.json({ error: error.message, stage: error.stage }, { status: error.statusCode });
    }
    if (error instanceof Error && /recipient address/.test(error.message)) {
      return NextResponse.json({ error: error.message, stage: "validate_draft" }, { status: 400 });
    }
    return apiError(error);
  }
}

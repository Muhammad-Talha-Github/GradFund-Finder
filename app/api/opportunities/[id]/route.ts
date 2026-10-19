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
    const input: unknown = await request.json();
    if (!input || typeof input !== "object" || typeof (input as { isSaved?: unknown }).isSaved !== "boolean") return NextResponse.json({ error: "Provide a boolean isSaved value." }, { status: 400 });
    const exists = await query('SELECT "id" FROM "Opportunity" WHERE "id"=$1', [context.params.id]);
    if (!exists.rowCount) return NextResponse.json({ error: "Opportunity not found." }, { status: 404 });
    if ((input as { isSaved: boolean }).isSaved) {
      await query('INSERT IGNORE INTO "UserSavedOpportunity" ("userId","opportunityId") VALUES ($1,$2)', [user.id, context.params.id]);
    } else {
      await query('DELETE FROM "UserSavedOpportunity" WHERE "userId"=$1 AND "opportunityId"=$2', [user.id, context.params.id]);
    }
    return NextResponse.json({ id: context.params.id, isSaved: (input as { isSaved: boolean }).isSaved });
  } catch (error) { return apiError(error); }
}

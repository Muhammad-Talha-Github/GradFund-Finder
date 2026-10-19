import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { query } from "@/lib/db";
import { gmailConnectionStatus } from "@/lib/gmail/client";
import { decryptGmailToken } from "@/lib/gmail/token-crypto";
import { getRequestUser } from "@/lib/auth/session";
import { sameOrigin, unauthorized } from "@/lib/auth/request";

export async function GET(request: Request) {
  try {
    const user = await getRequestUser(request);
    if (!user) return unauthorized();
    return NextResponse.json(await gmailConnectionStatus(user.id));
  }
  catch (error) { return apiError(error); }
}

export async function DELETE(request: Request) {
  try {
    if (!sameOrigin(request)) return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 });
    const user = await getRequestUser(request);
    if (!user) return unauthorized();
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
    const existing = await query<{ refreshTokenCiphertext: string }>('SELECT "refreshTokenCiphertext" FROM "GmailConnection" WHERE "userId"=$1', [user.id]);
    if (existing.rows[0]) {
      try {
        const token = decryptGmailToken(existing.rows[0].refreshTokenCiphertext);
        await fetch("https://oauth2.googleapis.com/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch { /* Local credentials are removed even if Google's revocation endpoint is unavailable. */ }
    }
    await query('DELETE FROM "GmailConnection" WHERE "userId"=$1', [user.id]);
    return NextResponse.json({ connected: false });
  } catch (error) { return apiError(error); }
}

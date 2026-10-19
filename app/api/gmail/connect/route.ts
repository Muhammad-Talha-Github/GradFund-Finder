import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth/session";
import { unauthorized } from "@/lib/auth/request";

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return unauthorized();
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GMAIL_REDIRECT_URI;
  if (!clientId || !redirectUri) return NextResponse.json({ error: "Set GOOGLE_CLIENT_ID and GMAIL_REDIRECT_URI in .env.local first." }, { status: 503 });
  let callback: URL;
  try { callback = new URL(redirectUri); } catch { return NextResponse.json({ error: "GMAIL_REDIRECT_URI must be an absolute callback URL." }, { status: 503 }); }
  if (callback.origin !== new URL(request.url).origin || callback.pathname !== "/api/gmail/callback") {
    return NextResponse.json({ error: "GMAIL_REDIRECT_URI must match this app origin and /api/gmail/callback." }, { status: 503 });
  }

  const state = randomBytes(32).toString("base64url");
  const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorization.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: "openid email https://www.googleapis.com/auth/gmail.compose",
    state,
  }).toString();
  const response = NextResponse.redirect(authorization);
  response.cookies.set("gmail_oauth_state", state, {
    httpOnly: true,
    secure: new URL(request.url).protocol === "https:",
    sameSite: "lax",
    path: "/api/gmail/callback",
    maxAge: 600,
    // Bind OAuth completion to the account that initiated it.
  });
  response.cookies.set("gmail_oauth_user", user.id, {
    httpOnly: true,
    secure: new URL(request.url).protocol === "https:",
    sameSite: "lax",
    path: "/api/gmail/callback",
    maxAge: 600,
  });
  return response;
}

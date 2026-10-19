import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { encryptGmailToken } from "@/lib/gmail/token-crypto";
import { randomUUID } from "node:crypto";
import { getRequestUser } from "@/lib/auth/session";

type GoogleTokenResponse = { access_token?: unknown; refresh_token?: unknown; error_description?: unknown };

function returnToDashboard(request: Request, status: "connected" | "error", reason?: string) {
  const url = new URL("/", request.url);
  url.searchParams.set("gmail", status);
  if (reason) url.searchParams.set("reason", reason.slice(0, 120));
  url.hash = "drafts";
  const response = NextResponse.redirect(url);
  response.cookies.set("gmail_oauth_state", "", {
    httpOnly: true,
    secure: new URL(request.url).protocol === "https:",
    sameSite: "lax",
    path: "/api/gmail/callback",
    maxAge: 0,
  });
  response.cookies.set("gmail_oauth_user", "", {
    httpOnly: true,
    secure: new URL(request.url).protocol === "https:",
    sameSite: "lax",
    path: "/api/gmail/callback",
    maxAge: 0,
  });
  return response;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const cookieState = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith("gmail_oauth_state="))?.split("=").slice(1).join("=");
  const cookieUserId = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith("gmail_oauth_user="))?.slice("gmail_oauth_user=".length);
  const user = await getRequestUser(request).catch(() => null);
  if (!state || !cookieState || state !== cookieState || !user || !cookieUserId || user.id !== cookieUserId) return returnToDashboard(request, "error", "OAuth state check failed. Sign in and connect Gmail again.");
  if (url.searchParams.has("error")) return returnToDashboard(request, "error", "Gmail access was canceled or denied.");

  const code = url.searchParams.get("code");
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GMAIL_REDIRECT_URI;
  if (!code || !clientId || !clientSecret || !redirectUri) return returnToDashboard(request, "error", "Gmail OAuth configuration is incomplete.");

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    const token = await tokenResponse.json().catch(() => ({})) as GoogleTokenResponse;
    if (!tokenResponse.ok || typeof token.access_token !== "string") {
      const safeMessage = typeof token.error_description === "string" ? token.error_description.slice(0, 100) : "Google token exchange failed.";
      return returnToDashboard(request, "error", safeMessage);
    }

    let refreshToken = typeof token.refresh_token === "string" ? token.refresh_token : null;
    if (!refreshToken) {
      const existing = await query<{ refreshTokenCiphertext: string }>('SELECT "refreshTokenCiphertext" FROM "GmailConnection" WHERE "userId"=$1', [user.id]);
      if (!existing.rows[0]) return returnToDashboard(request, "error", "Google did not provide a refresh token. Reconnect and grant offline access.");
      const { decryptGmailToken } = await import("@/lib/gmail/token-crypto");
      refreshToken = decryptGmailToken(existing.rows[0].refreshTokenCiphertext);
    }

    let accountEmail: string | null = null;
    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    }).catch(() => null);
    if (profileResponse?.ok) {
      const profile = await profileResponse.json().catch(() => ({})) as { email?: unknown };
      if (typeof profile.email === "string") accountEmail = profile.email.slice(0, 320);
    }

    await query(
      `INSERT INTO "GmailConnection" ("id","userId","refreshTokenCiphertext","accountEmail","connectedAt","updatedAt") VALUES ($1,$2,$3,$4,NOW(),NOW())
       ON DUPLICATE KEY UPDATE "refreshTokenCiphertext"=VALUES("refreshTokenCiphertext"),"accountEmail"=VALUES("accountEmail"),"connectedAt"=NOW(),"updatedAt"=NOW()`,
      [randomUUID().replaceAll("-", ""), user.id, encryptGmailToken(refreshToken), accountEmail],
    );
    return returnToDashboard(request, "connected");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gmail connection failed.";
    return returnToDashboard(request, "error", message.includes("GMAIL_TOKEN_ENCRYPTION_KEY") ? message : "Gmail connection could not be saved. Check the server configuration and database.");
  }
}

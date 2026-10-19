import { createHash, randomBytes } from "node:crypto";
import type { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const AUTH_COOKIE = "gradfund_session";
export const SESSION_DAYS = 30;

export type AuthUser = { id: string; username: string; email: string };

function digest(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function sessionToken(cookieHeader: string | null) {
  const entry = cookieHeader?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${AUTH_COOKIE}=`));
  return entry?.slice(AUTH_COOKIE.length + 1) || null;
}

export async function getUserForSessionToken(token: string | null | undefined): Promise<AuthUser | null> {
  if (!token || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const result = await query<AuthUser>(
    `SELECT u."id",u."username",u."email" FROM "AppSession" s
     JOIN "AppUser" u ON u."id"=s."userId"
     WHERE s."tokenHash"=$1 AND s."expiresAt">NOW() LIMIT 1`,
    [digest(token)],
  );
  return result.rows[0] ?? null;
}

export async function getRequestUser(request: Request): Promise<AuthUser | null> {
  return getUserForSessionToken(sessionToken(request.headers.get("cookie")));
}

export async function createSession(userId: string, response: NextResponse, request: Request) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await query('INSERT INTO "AppSession" ("tokenHash","userId","expiresAt","createdAt") VALUES ($1,$2,$3,NOW())', [digest(token), userId, expiresAt]);
  response.cookies.set(AUTH_COOKIE, token, {
    httpOnly: true,
    secure: new URL(request.url).protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function clearSession(request: Request, response: NextResponse) {
  let databaseMs = 0;
  const token = sessionToken(request.headers.get("cookie"));
  if (token && /^[A-Za-z0-9_-]{40,60}$/.test(token)) {
    const startedAt = performance.now();
    await query('DELETE FROM "AppSession" WHERE "tokenHash"=$1', [digest(token)]);
    databaseMs = performance.now() - startedAt;
  }
  response.cookies.set(AUTH_COOKIE, "", {
    httpOnly: true,
    secure: new URL(request.url).protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return { databaseMs };
}

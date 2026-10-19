import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { authRateLimit } from "@/lib/auth/rate-limit";
import { sameOrigin } from "@/lib/auth/request";
import { createSession } from "@/lib/auth/session";
import { DUMMY_PASSWORD_HASH, verifyPassword } from "@/lib/auth/password";
import { query } from "@/lib/db";

type UserRow = { id: string; username: string; email: string; passwordHash: string };

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 });
  if (!authRateLimit(request, "login")) return NextResponse.json({ error: "Too many login attempts. Try again in 15 minutes." }, { status: 429 });

  try {
    const input = await request.json() as Record<string, unknown>;
    const identifier = typeof input.identifier === "string" ? input.identifier.trim().toLocaleLowerCase("en-US") : "";
    const password = typeof input.password === "string" ? input.password : "";
    if (!identifier || identifier.length > 320 || !password || password.length > 128) return NextResponse.json({ error: "Enter your username or email and password." }, { status: 400 });
    const result = await query<UserRow>('SELECT "id","username","email","passwordHash" FROM "AppUser" WHERE "usernameLower"=$1 OR "email"=$1 LIMIT 1', [identifier]);
    const user = result.rows[0];
    const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!user || !valid) return NextResponse.json({ error: "Incorrect username/email or password." }, { status: 401 });

    const response = NextResponse.json({ user: { id: user.id, username: user.username, email: user.email } });
    await createSession(user.id, response, request);
    return response;
  } catch (error) { return apiError(error); }
}

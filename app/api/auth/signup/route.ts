import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { authRateLimit } from "@/lib/auth/rate-limit";
import { sameOrigin } from "@/lib/auth/request";
import { createSession } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { inTransaction } from "@/lib/db";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 });
  if (!authRateLimit(request, "signup")) return NextResponse.json({ error: "Too many sign-up attempts. Try again in 15 minutes." }, { status: 429 });

  try {
    const input = await request.json() as Record<string, unknown>;
    const username = typeof input.username === "string" ? input.username.trim() : "";
    const usernameLower = username.toLocaleLowerCase("en-US");
    const email = typeof input.email === "string" ? input.email.trim().toLocaleLowerCase("en-US") : "";
    const password = typeof input.password === "string" ? input.password : "";
    const confirmPassword = typeof input.confirmPassword === "string" ? input.confirmPassword : "";
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{2,29}$/.test(username)) return NextResponse.json({ error: "Username must be 3–30 characters and use letters, numbers, dots, underscores, or hyphens." }, { status: 400 });
    if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    if (password.length < 10 || password.length > 128) return NextResponse.json({ error: "Password must be between 10 and 128 characters." }, { status: 400 });
    if (password !== confirmPassword) return NextResponse.json({ error: "Your passwords do not match." }, { status: 400 });

    const id = randomUUID();
    const passwordHash = await hashPassword(password);
    await inTransaction(async (db) => {
      await db.query('INSERT INTO "AppUser" ("id","username","usernameLower","email","passwordHash","createdAt") VALUES ($1,$2,$3,$4,$5,NOW())', [id, username, usernameLower, email, passwordHash]);
      const count = await db.query<{ total: number }>('SELECT COUNT(*) AS "total" FROM "AppUser"');
      if (Number(count.rows[0]?.total) === 1) {
        // Attach the pre-authentication personal data to the first account; no existing records are deleted.
        await db.query('UPDATE "EmailDraft" SET "userId"=$1 WHERE "userId" IS NULL', [id]);
        await db.query('UPDATE "EmailSettings" SET "userId"=$1 WHERE "userId" IS NULL', [id]);
        await db.query('UPDATE "GmailConnection" SET "userId"=$1 WHERE "userId" IS NULL', [id]);
        await db.query('INSERT IGNORE INTO "UserSavedOpportunity" ("userId","opportunityId") SELECT $1,"id" FROM "Opportunity" WHERE "isSaved"=1', [id]);
      }
    });

    const response = NextResponse.json({ user: { id, username, email } }, { status: 201 });
    await createSession(id, response, request);
    return response;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ER_DUP_ENTRY") {
      return NextResponse.json({ error: "That username or email is already registered." }, { status: 409 });
    }
    return apiError(error);
  }
}

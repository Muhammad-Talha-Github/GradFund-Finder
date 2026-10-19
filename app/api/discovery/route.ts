import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/db";
import { apiError } from "@/lib/api-error";
import { getRequestUser } from "@/lib/auth/session";
import { unauthorized } from "@/lib/auth/request";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  try {
    if (!await getRequestUser(request)) return unauthorized();
    const runs = await getDatabase().query('SELECT * FROM "DiscoveryRun" ORDER BY "startedAt" DESC LIMIT 10');
    return NextResponse.json({ runs: runs.rows });
  } catch (error) { return apiError(error); }
}

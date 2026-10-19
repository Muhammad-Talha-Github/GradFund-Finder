import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { sameOrigin } from "@/lib/auth/request";
import { clearSession } from "@/lib/auth/session";

// Let the dashboard warm this tiny route so its first dev-mode logout does not
// wait for Next.js to compile the route after the user clicks the button.
export async function HEAD() {
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 });
  const startedAt = performance.now();
  try {
    const response = NextResponse.json({ ok: true });
    const { databaseMs } = await clearSession(request, response);
    const totalMs = performance.now() - startedAt;
    response.headers.set("Server-Timing", `db;dur=${databaseMs.toFixed(1)}, total;dur=${totalMs.toFixed(1)}`);
    console.info(`[auth:logout] db_ms=${databaseMs.toFixed(1)} total_ms=${totalMs.toFixed(1)}`);
    return response;
  } catch (error) { return apiError(error); }
}

import { NextResponse } from "next/server";
import { DatabaseNotConfiguredError } from "@/lib/db";

export function apiError(error: unknown) {
  if (error instanceof DatabaseNotConfiguredError) {
    return NextResponse.json({ error: error.message, code: "DATABASE_NOT_CONFIGURED" }, { status: 503 });
  }
  // Do not send database URLs, provider responses, or credential-bearing errors to browsers.
  return NextResponse.json({ error: "The request could not be completed. Check the server configuration and try again." }, { status: 503 });
}

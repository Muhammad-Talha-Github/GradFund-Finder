import { NextResponse } from "next/server";

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return Boolean(origin && origin === new URL(request.url).origin);
}

export function unauthorized() {
  return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
}

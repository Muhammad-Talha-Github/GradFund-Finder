import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { getRequestUser } from "@/lib/auth/session";

export async function GET(request: Request) {
  try { return NextResponse.json({ user: await getRequestUser(request) }); }
  catch (error) { return apiError(error); }
}

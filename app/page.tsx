import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import DashboardClient from "./dashboard-client";
import { AUTH_COOKIE, getUserForSessionToken } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getUserForSessionToken(cookies().get(AUTH_COOKIE)?.value);
  if (!user) redirect("/login");
  return <DashboardClient username={user.username} />;
}

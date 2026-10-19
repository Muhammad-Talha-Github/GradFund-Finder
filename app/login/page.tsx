import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import AuthScreen from "../auth-screen";
import { AUTH_COOKIE, getUserForSessionToken } from "@/lib/auth/session";

export default async function LoginPage({ searchParams }: { searchParams?: { signedOut?: string } }) {
  if (searchParams?.signedOut !== "1" && await getUserForSessionToken(cookies().get(AUTH_COOKIE)?.value)) redirect("/");
  return <AuthScreen mode="login" />;
}

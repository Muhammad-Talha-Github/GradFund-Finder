import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GradFund Finder — Your next chapter, fully funded",
  description: "Discover funded graduate opportunities and organize your next steps.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}

import type { Metadata, Viewport } from "next";
import { Geist_Mono } from "next/font/google";
import Link from "next/link";
import NavLinks from "@/components/NavLinks";
import MobileBottomNav from "@/components/MobileBottomNav";
import UserMenu from "@/components/UserMenu";
import { getCurrentUser } from "@/lib/dal";
import "./globals.css";

const mono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "finmon",
  description: "Personal finance monitor",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getCurrentUser();
  const authed = !!user;

  return (
    <html lang="en" className={`${mono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-white text-zinc-900">
        <nav className="border-b border-zinc-200 px-4 py-3 flex gap-6 text-sm items-center">
          <Link
            href={authed ? "/transactions" : "/login"}
            className="font-semibold tracking-tight"
          >
            finmon
          </Link>
          {authed && <NavLinks />}
          {authed && <UserMenu />}
        </nav>
        <main
          className={
            authed
              ? "flex-1 pb-[calc(env(safe-area-inset-bottom,0px)+5rem)] md:pb-0"
              : "flex-1"
          }
        >
          {children}
        </main>
        {authed && <MobileBottomNav />}
      </body>
    </html>
  );
}

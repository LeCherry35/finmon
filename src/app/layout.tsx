import type { Metadata, Viewport } from "next";
import { Geist_Mono } from "next/font/google";
import Link from "next/link";
import NavLinks from "@/components/NavLinks";
import MobileBottomNav from "@/components/MobileBottomNav";
import UserMenu from "@/components/UserMenu";
import BugReportButton from "@/components/BugReportButton";
import AssistantFab from "@/components/agent/AssistantFab";
import { SuggestionCountProvider } from "@/components/agent/SuggestionCount";
import { countPendingProposals } from "@/lib/agent-proposals";
import { isAgentConfigured } from "@/lib/opencode";
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
  const agentOn = authed && isAgentConfigured();
  const pendingSuggestions = user && agentOn ? await countPendingProposals(user.id).catch(() => 0) : 0;

  return (
    <html lang="en" className={`${mono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-white text-zinc-900">
        <SuggestionCountProvider enabled={agentOn} initial={pendingSuggestions}>
          <nav className="border-b border-zinc-200 px-4 py-3 flex gap-6 text-sm items-center">
            <Link
              href={authed ? "/transactions" : "/login"}
              className="font-semibold tracking-tight"
            >
              finmon
            </Link>
            {authed && <NavLinks showAssistant={agentOn} />}
            {authed && <UserMenu />}
            {authed && <BugReportButton />}
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
          {agentOn && <AssistantFab />}
        </SuggestionCountProvider>
      </body>
    </html>
  );
}

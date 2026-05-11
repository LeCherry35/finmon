import type { Metadata, Viewport } from "next";
import { Geist_Mono } from "next/font/google";
import Link from "next/link";
import NavLinks from "@/components/NavLinks";
import MobileBottomNav from "@/components/MobileBottomNav";
import "./globals.css";

const mono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "finmon",
  description: "Personal finance monitor",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${mono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-white text-zinc-900">
        <nav className="border-b border-zinc-200 px-4 py-3 flex gap-6 text-sm">
          <Link href="/" className="font-semibold tracking-tight">
            finmon
          </Link>
          <NavLinks />
        </nav>
        <main className="flex-1 pb-[calc(env(safe-area-inset-bottom,0px)+5rem)] md:pb-0">
          {children}
        </main>
        <MobileBottomNav />
      </body>
    </html>
  );
}

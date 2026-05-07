import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import Link from "next/link";
import NavLinks from "@/components/NavLinks";
import "./globals.css";

const mono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "finmon",
  description: "Personal finance monitor",
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
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}

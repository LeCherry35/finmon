"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_LINKS } from "@/lib/nav";

export default function NavLinks() {
  const pathname = usePathname();

  return (
    <span className="hidden md:contents">
      {NAV_LINKS.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className={
            pathname === href
              ? "text-zinc-900 font-medium"
              : "text-zinc-500 hover:text-zinc-900"
          }
        >
          {label}
        </Link>
      ))}
    </span>
  );
}

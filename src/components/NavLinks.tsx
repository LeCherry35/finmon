"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import FilterMemoryRecorder from "@/components/FilterMemoryRecorder";
import { useFilterQuery } from "@/lib/filter-memory";
import { FILTER_PAGES, NAV_LINKS } from "@/lib/nav";

export default function NavLinks() {
  const pathname = usePathname();
  const filterQuery = useFilterQuery();

  return (
    <span className="hidden md:contents">
      {/* Mounted at every size (display:none doesn't unmount), so it records
          filters for the mobile bottom nav too. */}
      <Suspense fallback={null}>
        <FilterMemoryRecorder />
      </Suspense>
      {NAV_LINKS.map(({ href, label }) => (
        <Link
          key={href}
          href={FILTER_PAGES.has(href) ? href + filterQuery : href}
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

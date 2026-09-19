"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import FilterMemoryRecorder from "@/components/FilterMemoryRecorder";
import { useSuggestionCount } from "@/components/agent/SuggestionCount";
import { useFilterQuery } from "@/lib/filter-memory";
import { ASSISTANT_LINK, FILTER_PAGES, NAV_LINKS } from "@/lib/nav";

export default function NavLinks({ showAssistant = false }: { showAssistant?: boolean }) {
  const pathname = usePathname();
  const filterQuery = useFilterQuery();
  // Pending assistant suggestions, shown on the Assistant link: "Assistant (3)".
  const { count: pendingSuggestions } = useSuggestionCount();

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
          className={linkClass(pathname === href)}
        >
          {label}
        </Link>
      ))}
      {showAssistant && (
        <Link href={ASSISTANT_LINK.href} className={linkClass(pathname === ASSISTANT_LINK.href)}>
          {ASSISTANT_LINK.label}
          {pendingSuggestions > 0 && ` (${pendingSuggestions})`}
        </Link>
      )}
    </span>
  );
}

function linkClass(active: boolean) {
  return active ? "text-zinc-900 font-medium" : "text-zinc-500 hover:text-zinc-900";
}

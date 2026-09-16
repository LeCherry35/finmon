"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { buildFilterQuery, parseFilters } from "@/lib/filters";
import { saveFilterQuery } from "@/lib/filter-memory";
import { FILTER_PAGES } from "@/lib/nav";

/** Records the current page's filter params whenever a filter page's URL
 *  changes. Renders nothing; mount it once (inside a Suspense boundary, since it
 *  reads search params). Only months/categories are kept — `sort` is
 *  transactions-only. */
export default function FilterMemoryRecorder() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!FILTER_PAGES.has(pathname)) return;
    const { months, categoryIds } = parseFilters(Object.fromEntries(searchParams));
    saveFilterQuery(buildFilterQuery(months, categoryIds));
  }, [pathname, searchParams]);

  return null;
}

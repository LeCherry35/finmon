"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { countPendingSuggestions } from "@/actions/suggestions";

export const SUGGESTIONS_HREF = "/suggestions";

type SuggestionCount = { count: number; refresh: () => void };

const Ctx = createContext<SuggestionCount>({ count: 0, refresh: () => {} });

/**
 * The number of the assistant's proposals waiting for the user. Seeded by the
 * layout, refetched on every page change and window focus (the agent makes
 * proposals in the background), and on demand via `refresh` after a decision.
 */
export function SuggestionCountProvider({
  enabled,
  initial,
  children,
}: {
  /** Off when signed out or the assistant isn't configured: nothing is fetched. */
  enabled: boolean;
  initial: number;
  children: React.ReactNode;
}) {
  const [count, setCount] = useState(initial);
  const pathname = usePathname();

  const refresh = useCallback(() => {
    if (!enabled) return;
    countPendingSuggestions().then(setCount, (err) =>
      console.error("Couldn't count suggestions:", err),
    );
  }, [enabled]);

  useEffect(() => {
    refresh();
  }, [pathname, refresh]);

  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  return <Ctx.Provider value={{ count, refresh }}>{children}</Ctx.Provider>;
}

export function useSuggestionCount(): SuggestionCount {
  return useContext(Ctx);
}

function useVisibleCount(): number {
  const { count } = useSuggestionCount();
  return usePathname() === SUGGESTIONS_HREF ? 0 : count;
}

const label = (n: number) => `${n} pending suggestion${n === 1 ? "" : "s"}`;

/** Round mobile button (bottom-right FAB stack) with the pending count on it;
 *  only while something is pending. Unpositioned — callers stack it. Desktop
 *  shows the count on the Assistant nav link instead (NavLinks). */
export function SuggestionsButton() {
  const count = useVisibleCount();
  if (count === 0) return null;
  return (
    <Link
      href={SUGGESTIONS_HREF}
      aria-label={label(count)}
      title={label(count)}
      className="w-14 h-14 rounded-full bg-amber-500 text-white text-lg font-semibold shadow-lg flex items-center justify-center md:hidden active:scale-95 transition-transform"
    >
      {count}
    </Link>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChatIcon } from "@/components/agent/icons";
import { SuggestionsButton } from "@/components/agent/SuggestionCount";

/** Round gray link to /assistant (mobile only). Unpositioned — callers place it. */
export function AssistantButton() {
  return (
    <Link
      href="/assistant"
      aria-label="Assistant"
      title="Assistant"
      className="w-14 h-14 rounded-full bg-zinc-500 text-white shadow-lg flex items-center justify-center md:hidden active:scale-95 transition-transform"
    >
      <ChatIcon size={22} />
    </Link>
  );
}

/**
 * Mobile entry to /assistant, in the bottom-right FAB slot, with the pending
 * suggestions button above it while any are pending. On /transactions the "+"
 * owns that slot, so TransactionCreateSheet stacks both buttons in the same
 * container instead (two separately fixed buttons can overlap on iOS). Hidden
 * on /assistant, where it would cover the composer. Desktop uses the header.
 */
export default function AssistantFab() {
  const pathname = usePathname();
  if (pathname === "/assistant" || pathname === "/transactions") return null;
  return (
    <div className="fixed right-4 bottom-[calc(env(safe-area-inset-bottom,0px)+5rem)] z-30 flex flex-col gap-3 md:hidden">
      <SuggestionsButton />
      <AssistantButton />
    </div>
  );
}

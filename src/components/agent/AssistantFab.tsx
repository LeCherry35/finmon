"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChatIcon } from "@/components/agent/icons";

/**
 * Mobile entry to /assistant. On /transactions it stacks above the "+" create
 * FAB; elsewhere there's no "+", so it takes that bottom-right slot itself.
 * Desktop uses the header nav link instead.
 */
export default function AssistantFab() {
  const pathname = usePathname();
  if (pathname === "/assistant") return null;
  const bottom =
    pathname === "/transactions"
      ? "bottom-[calc(env(safe-area-inset-bottom,0px)+9.5rem)]"
      : "bottom-[calc(env(safe-area-inset-bottom,0px)+5rem)]";

  return (
    <Link
      href="/assistant"
      aria-label="Assistant"
      title="Assistant"
      className={`fixed right-4 ${bottom} z-30 w-14 h-14 rounded-full bg-zinc-900 text-white shadow-lg flex items-center justify-center md:hidden active:scale-95 transition-transform`}
    >
      <ChatIcon size={22} />
    </Link>
  );
}

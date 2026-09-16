"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

const DEBOUNCE_MS = 300;

export default function TransactionSearch({ query }: { query: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(query !== "");
  const [text, setText] = useState(query);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function push(value: string) {
    const params = new URLSearchParams(searchParams);
    const q = value.trim();
    if (q) params.set("q", q);
    else params.delete("q");
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  function onChange(value: string) {
    setText(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => push(value), DEBOUNCE_MS);
  }

  function clear() {
    if (timer.current) clearTimeout(timer.current);
    setText("");
    setOpen(false);
    if (query) push("");
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center rounded-full border border-zinc-200 p-1.5 text-zinc-500 transition-colors hover:border-zinc-300 hover:text-zinc-800"
        title="Search transactions"
        aria-label="Search transactions"
      >
        <SearchIcon />
      </button>
    );
  }

  return (
    <div
      className={[
        "relative flex w-full items-center md:w-56",
        isPending ? "opacity-70" : "",
      ].join(" ")}
    >
      <span className="pointer-events-none absolute left-2.5 text-zinc-400">
        <SearchIcon />
      </span>
      <input
        type="search"
        autoFocus
        value={text}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") clear();
        }}
        placeholder="Store, note, product…"
        aria-label="Search transactions"
        maxLength={100}
        className="w-full rounded-full border border-zinc-400 py-1 pl-7 pr-7 text-xs text-zinc-900 outline-none focus:border-zinc-600 [&::-webkit-search-cancel-button]:hidden"
      />
      <button
        type="button"
        onClick={clear}
        className="absolute right-1.5 rounded-full px-1 text-zinc-400 hover:text-zinc-800"
        title="Clear search"
        aria-label="Clear search"
      >
        ×
      </button>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

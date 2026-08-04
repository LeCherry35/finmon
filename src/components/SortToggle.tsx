"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import type { TransactionSort } from "@/db/queries";

const LABELS: Record<TransactionSort, string> = {
  date: "Transaction date",
  added: "Date added",
};

export default function SortToggle({ sort }: { sort: TransactionSort }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function toggle() {
    const next: TransactionSort = sort === "date" ? "added" : "date";
    const params = new URLSearchParams(searchParams);
    // "date" is the default — keep the URL clean by dropping the param for it.
    if (next === "date") params.delete("sort");
    else params.set("sort", next);
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  const cls = [
    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
    sort === "added"
      ? "border-zinc-400 text-zinc-900 hover:border-zinc-600"
      : "border-zinc-200 text-zinc-500 hover:border-zinc-300 hover:text-zinc-800",
    isPending ? "opacity-70" : "",
  ].join(" ");

  return (
    <button
      type="button"
      onClick={toggle}
      className={cls}
      title={`Sorted by ${LABELS[sort].toLowerCase()} — click to switch`}
    >
      <SortIcon />
      <span className="truncate max-w-[10rem] md:max-w-[14rem]">
        {LABELS[sort]}
      </span>
    </button>
  );
}

function SortIcon() {
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
      <path d="M3 6h12M3 12h9M3 18h6" />
      <path d="M18 9l3 3-3 3" />
    </svg>
  );
}

"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { CHARTS, DEFAULT_CHART, type ChartId } from "./registry";

export default function ChartTabs({ current }: { current: ChartId }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function selectChart(id: ChartId) {
    if (id === current) return;
    const params = new URLSearchParams(sp);
    if (id === DEFAULT_CHART) params.delete("chart");
    else params.set("chart", id);
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  return (
    <div
      role="tablist"
      className={`flex gap-1 border-b border-zinc-200 ${
        isPending ? "opacity-70" : ""
      }`}
    >
      {CHARTS.map(({ id, label }) => {
        const active = id === current;
        return (
          <button
            key={id}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => selectChart(id)}
            className={[
              "-mb-px px-3 py-2 text-sm border-b-2 transition-colors",
              active
                ? "border-zinc-900 text-zinc-900 font-medium"
                : "border-transparent text-zinc-500 hover:text-zinc-800 hover:border-zinc-300",
            ].join(" ")}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

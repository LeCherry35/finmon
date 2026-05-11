"use client";

import { useEffect, useRef, useSyncExternalStore, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Category } from "@/actions/categories";
import {
  type Filters,
  currentMonth,
  formatMonthLabel,
  summarizeFilters,
} from "@/lib/filters";

const STORAGE_KEY = "finmon.filterPanel.expanded";
const PANEL_EVENT = "finmon:filterPanel:change";

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(PANEL_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(PANEL_EVENT, callback);
  };
}

function getSnapshot() {
  return localStorage.getItem(STORAGE_KEY) === "1";
}

function getServerSnapshot() {
  return false;
}

export default function FilterPanel({
  availableMonths,
  categories,
  selected,
  showCategoryFilter = true,
}: {
  availableMonths: string[];
  categories: Category[];
  selected: Filters;
  showCategoryFilter?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const expanded = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  function setExpandedPersist(next: boolean) {
    localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    window.dispatchEvent(new Event(PANEL_EVENT));
  }

  useEffect(() => {
    if (!expanded) return;
    function onPointerDown(e: PointerEvent) {
      const el = wrapperRef.current;
      if (el && !el.contains(e.target as Node)) {
        setExpandedPersist(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setExpandedPersist(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [expanded]);

  const monthsList: string[] = (() => {
    const cm = currentMonth();
    const set = new Set<string>([cm, ...availableMonths]);
    if (selected.months !== "default") {
      for (const m of selected.months) set.add(m);
    }
    return Array.from(set).sort().reverse();
  })();

  const selectedMonths: string[] =
    selected.months === "default" ? [currentMonth()] : selected.months;
  const selectedMonthSet = new Set(selectedMonths);

  const allCategoryIds = categories.map((c) => c.id);
  const selectedCategoryIds: number[] =
    selected.categoryIds === "all" ? allCategoryIds : selected.categoryIds;
  const selectedCategorySet = new Set(selectedCategoryIds);

  function navigate(
    nextMonths: string[] | "default",
    nextCategoryIds: number[] | "all",
  ) {
    const params = new URLSearchParams(searchParams);
    if (nextMonths === "default") params.delete("months");
    else params.set("months", nextMonths.join(","));
    if (nextCategoryIds === "all") params.delete("categories");
    else params.set("categories", nextCategoryIds.join(","));
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  function toggleMonth(month: string) {
    const next = selectedMonthSet.has(month)
      ? selectedMonths.filter((m) => m !== month)
      : [...selectedMonths, month];
    navigate(next, selected.categoryIds);
  }

  function toggleCategory(id: number) {
    const next = selectedCategorySet.has(id)
      ? selectedCategoryIds.filter((c) => c !== id)
      : [...selectedCategoryIds, id];
    if (next.length === allCategoryIds.length) {
      navigate(selected.months, "all");
    } else {
      navigate(selected.months, next);
    }
  }

  function selectAllMonths() {
    navigate(monthsList, selected.categoryIds);
  }
  function clearMonths() {
    navigate([], selected.categoryIds);
  }
  function selectAllCategories() {
    navigate(selected.months, "all");
  }
  function clearCategories() {
    navigate(selected.months, []);
  }
  function resetAll() {
    const params = new URLSearchParams(searchParams);
    params.delete("months");
    params.delete("categories");
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  const summary = summarizeFilters(selected, allCategoryIds.length);
  const isDefault =
    selected.months === "default" && selected.categoryIds === "all";

  const triggerCls = [
    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
    isDefault
      ? "border-zinc-200 text-zinc-500 hover:border-zinc-300 hover:text-zinc-800"
      : "border-zinc-400 text-zinc-900 hover:border-zinc-600",
    isPending ? "opacity-70" : "",
  ].join(" ");

  return (
    <div ref={wrapperRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setExpandedPersist(!expanded)}
        className={triggerCls}
        title={`Filters: ${summary}`}
        aria-expanded={expanded}
      >
        <FunnelIcon />
        <span className="truncate max-w-[10rem] md:max-w-[14rem]">{summary}</span>
        <Chevron open={expanded} />
      </button>

      {expanded && (
        <div className="absolute left-0 top-full mt-1 z-30 w-[min(15rem,calc(100vw-2rem))] md:w-60 rounded-md border border-zinc-200 bg-white text-sm shadow-lg">
          <section className="px-3 py-3">
            <SectionHeader
              label="Months"
              onAll={selectAllMonths}
              onClear={clearMonths}
            />
            <ul className="space-y-1 max-h-64 overflow-auto pr-1">
              {monthsList.map((m) => (
                <li key={m}>
                  <label className="flex items-center gap-2 cursor-pointer text-zinc-700 hover:text-zinc-900">
                    <input
                      type="checkbox"
                      checked={selectedMonthSet.has(m)}
                      onChange={() => toggleMonth(m)}
                      className="accent-zinc-700"
                    />
                    <span>{formatMonthLabel(m)}</span>
                  </label>
                </li>
              ))}
              {monthsList.length === 0 && (
                <li className="text-xs text-zinc-400">No months yet</li>
              )}
            </ul>
          </section>

          {showCategoryFilter && (
            <section className="px-3 pb-3 pt-1 border-t border-zinc-100">
              <SectionHeader
                label="Categories"
                onAll={selectAllCategories}
                onClear={clearCategories}
              />
              <ul className="space-y-1 max-h-64 overflow-auto pr-1">
                {categories.map((c) => (
                  <li key={c.id}>
                    <label className="flex items-center gap-2 cursor-pointer text-zinc-700 hover:text-zinc-900">
                      <input
                        type="checkbox"
                        checked={selectedCategorySet.has(c.id)}
                        onChange={() => toggleCategory(c.id)}
                        className="accent-zinc-700"
                      />
                      <span className="truncate">{c.name}</span>
                    </label>
                  </li>
                ))}
                {categories.length === 0 && (
                  <li className="text-xs text-zinc-400">No categories yet</li>
                )}
              </ul>
            </section>
          )}

          <footer className="px-3 py-2 border-t border-zinc-100 flex justify-end">
            <button
              type="button"
              onClick={resetAll}
              disabled={isDefault}
              className="text-xs text-zinc-500 hover:text-zinc-900 disabled:text-zinc-300 disabled:cursor-not-allowed"
            >
              Clear all
            </button>
          </footer>
        </div>
      )}
    </div>
  );
}

function SectionHeader({
  label,
  onAll,
  onClear,
}: {
  label: string;
  onAll: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center justify-between mb-2">
      <span className="text-xs font-semibold text-zinc-700">{label}</span>
      <div className="flex gap-2 text-[11px] text-zinc-400">
        <button onClick={onAll} className="hover:text-zinc-700" type="button">
          All
        </button>
        <span>·</span>
        <button onClick={onClear} className="hover:text-zinc-700" type="button">
          None
        </button>
      </div>
    </div>
  );
}

function FunnelIcon() {
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
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform ${open ? "rotate-180" : ""}`}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

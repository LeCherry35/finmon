"use client";

import { useSyncExternalStore } from "react";

/** Remembers the last filter selection (`?months=…&categories=…`) so the nav can
 *  carry it between pages. Backed by sessionStorage — scoped to the tab, so a
 *  fresh visit starts on the defaults again. Every storage access is guarded:
 *  private windows / blocked site data can make it throw. */
const KEY = "finmon:filter-query";
const listeners = new Set<() => void>();

function read(): string {
  try {
    return sessionStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveFilterQuery(query: string): void {
  if (query === read()) return;
  try {
    if (query === "") sessionStorage.removeItem(KEY);
    else sessionStorage.setItem(KEY, query);
  } catch {
    return;
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The remembered filter query ("" when none). The server snapshot is always "",
 *  so hydration never mismatches; the stored value applies right after. */
export function useFilterQuery(): string {
  return useSyncExternalStore(subscribe, read, () => "");
}

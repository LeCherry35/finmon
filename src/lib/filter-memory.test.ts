// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { saveFilterQuery, useFilterQuery } from "@/lib/filter-memory";

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe("filter memory", () => {
  it("is empty until something is saved, then updates subscribers", () => {
    const { result } = renderHook(() => useFilterQuery());
    expect(result.current).toBe("");

    act(() => saveFilterQuery("?months=2026-08&categories=3"));
    expect(result.current).toBe("?months=2026-08&categories=3");

    act(() => saveFilterQuery(""));
    expect(result.current).toBe("");
    expect(sessionStorage.getItem("finmon:filter-query")).toBeNull();
  });

  it("degrades to empty when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { result } = renderHook(() => useFilterQuery());
    expect(() => saveFilterQuery("?categories=3")).not.toThrow();
    expect(result.current).toBe("");
  });
});

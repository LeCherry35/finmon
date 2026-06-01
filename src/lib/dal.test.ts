import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getSession, headers, redirect } = vi.hoisted(() => ({
  getSession: vi.fn(),
  headers: vi.fn(async () => new Headers()),
  redirect: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }));
vi.mock("next/headers", () => ({ headers }));
vi.mock("next/navigation", () => ({ redirect }));

import { getCurrentUser, requireUser } from "@/lib/dal";

beforeEach(() => {
  getSession.mockReset();
  redirect.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("getCurrentUser", () => {
  it("returns the session user", async () => {
    getSession.mockResolvedValue({ user: { id: "u1" } });
    expect(await getCurrentUser()).toEqual({ id: "u1" });
  });

  it("returns null when there is no session", async () => {
    getSession.mockResolvedValue(null);
    expect(await getCurrentUser()).toBeNull();
  });
});

describe("requireUser", () => {
  it("returns the user when authenticated", async () => {
    getSession.mockResolvedValue({ user: { id: "u2" } });
    expect(await requireUser()).toEqual({ id: "u2" });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("redirects to /login?stale=1 when unauthenticated", async () => {
    getSession.mockResolvedValue(null);
    await requireUser();
    expect(redirect).toHaveBeenCalledWith("/login?stale=1");
  });
});

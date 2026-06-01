import { afterEach, describe, expect, it, vi } from "vitest";

const { signOut, redirect } = vi.hoisted(() => ({
  signOut: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: { api: { signOut } } }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/navigation", () => ({ redirect }));

import { signOutAction } from "@/actions/auth";

afterEach(() => vi.clearAllMocks());

describe("signOutAction", () => {
  it("signs out then redirects to /login", async () => {
    await signOutAction();
    expect(signOut).toHaveBeenCalledOnce();
    expect(redirect).toHaveBeenCalledWith("/login");
  });
});

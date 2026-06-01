import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getSessionCookie } = vi.hoisted(() => ({ getSessionCookie: vi.fn() }));
vi.mock("better-auth/cookies", () => ({ getSessionCookie }));

import { proxy } from "@/proxy";

function req(path: string): NextRequest {
  return new NextRequest(new URL(`http://localhost${path}`));
}

/** Pathname of a redirect Response's Location header. */
function location(res: Response): URL {
  return new URL(res.headers.get("location")!);
}

beforeEach(() => getSessionCookie.mockReset());
afterEach(() => vi.clearAllMocks());

describe("proxy", () => {
  it("redirects an unauthenticated user away from a protected page", () => {
    getSessionCookie.mockReturnValue(null);
    const res = proxy(req("/transactions"));
    expect(res.status).toBe(307);
    expect(location(res).pathname).toBe("/login");
  });

  it("redirects an authenticated user away from an auth page", () => {
    getSessionCookie.mockReturnValue("token");
    const res = proxy(req("/login"));
    expect(location(res).pathname).toBe("/transactions");
  });

  it("lets an authenticated user reach a protected page", () => {
    getSessionCookie.mockReturnValue("token");
    const res = proxy(req("/charts"));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("lets an unauthenticated user reach an auth page", () => {
    getSessionCookie.mockReturnValue(null);
    const res = proxy(req("/register"));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("treats nested auth paths as auth pages", () => {
    getSessionCookie.mockReturnValue(null);
    const res = proxy(req("/reset-password/anything"));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("lets a signed-in user reach /reset-password when a token is present", () => {
    getSessionCookie.mockReturnValue("token");
    const res = proxy(req("/reset-password?token=abc"));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("bounces a signed-in user off /reset-password with no token", () => {
    getSessionCookie.mockReturnValue("token");
    const res = proxy(req("/reset-password"));
    expect(res.status).toBe(307);
    expect(location(res).pathname).toBe("/transactions");
  });

  it("clears session cookies and strips ?stale on an auth page", () => {
    getSessionCookie.mockReturnValue("token");
    const res = proxy(req("/login?stale=1"));
    expect(res.status).toBe(307);
    expect(location(res).searchParams.has("stale")).toBe(false);
    const setCookie = res.headers.getSetCookie().join("\n");
    expect(setCookie).toContain("better-auth.session_token=");
    // an expired/deleted cookie
    expect(setCookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
  });
});

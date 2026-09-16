import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AGENT_TOKEN_TTL_SECONDS, signAgentToken, verifyAgentToken } from "@/lib/agent-token";

const NOW = 1_800_000_000;

beforeEach(() => {
  vi.stubEnv("AGENT_TOKEN_SECRET", "test-secret");
});
afterEach(() => vi.unstubAllEnvs());

describe("agent token", () => {
  it("round-trips the user id before expiry", () => {
    const { token, exp } = signAgentToken("user-1", NOW);
    expect(exp).toBe(NOW + AGENT_TOKEN_TTL_SECONDS);
    expect(verifyAgentToken(token, NOW + 60)).toBe("user-1");
  });

  it("rejects an expired token", () => {
    const { token } = signAgentToken("user-1", NOW);
    expect(verifyAgentToken(token, NOW + AGENT_TOKEN_TTL_SECONDS)).toBeNull();
  });

  it("rejects a token whose payload was swapped to another user", () => {
    const { token } = signAgentToken("user-1", NOW);
    const [, mac] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "user-2", exp: NOW + 999 })).toString("base64url");
    expect(verifyAgentToken(`${forged}.${mac}`, NOW)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const { token } = signAgentToken("user-1", NOW);
    vi.stubEnv("AGENT_TOKEN_SECRET", "other-secret");
    expect(verifyAgentToken(token, NOW)).toBeNull();
  });

  it.each(["", "abc", "a.b.c", "..", "x.y"])("rejects malformed token %j", (t) => {
    expect(verifyAgentToken(t, NOW)).toBeNull();
  });

  it("falls back to BETTER_AUTH_SECRET", () => {
    vi.stubEnv("AGENT_TOKEN_SECRET", "");
    vi.stubEnv("BETTER_AUTH_SECRET", "auth-secret");
    const { token } = signAgentToken("user-1", NOW);
    expect(verifyAgentToken(token, NOW)).toBe("user-1");
  });
});

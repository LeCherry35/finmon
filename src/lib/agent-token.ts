import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// Bearer token that identifies a user to the agent's MCP endpoint
// (/api/agent/mcp). finmon writes it into that user's opencode config; the
// agent never sees or chooses a user id — the MCP route derives it from here.
//
// Format: base64url(JSON {sub, exp}) + "." + base64url(HMAC-SHA256).

/** Tokens live a day; src/lib/opencode.ts rotates them well before expiry. */
export const AGENT_TOKEN_TTL_SECONDS = 24 * 60 * 60;

function secret(): string {
  const s = process.env.AGENT_TOKEN_SECRET || process.env.BETTER_AUTH_SECRET;
  if (!s) throw new Error("AGENT_TOKEN_SECRET (or BETTER_AUTH_SECRET) must be set");
  return s;
}

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString("base64url");

function sign(payload: string): string {
  // Domain-separated so a token can never double as any other HMAC we derive
  // from the same secret.
  return b64url(createHmac("sha256", secret()).update(`finmon-agent:${payload}`).digest());
}

export function signAgentToken(
  userId: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): { token: string; exp: number } {
  const exp = nowSeconds + AGENT_TOKEN_TTL_SECONDS;
  const payload = b64url(JSON.stringify({ sub: userId, exp }));
  return { token: `${payload}.${sign(payload)}`, exp };
}

/** The user id a token was issued for, or null when it is malformed, forged
 *  or expired. */
export function verifyAgentToken(
  token: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): string | null {
  const [payload, mac, extra] = token.split(".");
  if (!payload || !mac || extra !== undefined) return null;

  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  try {
    const { sub, exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof sub !== "string" || !sub || typeof exp !== "number") return null;
    if (exp <= nowSeconds) return null;
    return sub;
  } catch {
    return null;
  }
}

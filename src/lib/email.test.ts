import { afterEach, describe, expect, it, vi } from "vitest";

// Hoisted so the vi.mock factory below can reference it.
const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock("resend", () => ({
  Resend: vi.fn(() => ({ emails: { send: sendMock } })),
}));

afterEach(() => {
  vi.resetModules(); // re-evaluate email.ts so the env stub is read fresh
  vi.unstubAllEnvs();
  sendMock.mockReset();
  vi.restoreAllMocks();
});

describe("with RESEND_API_KEY set", () => {
  async function load() {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("RESEND_FROM_EMAIL", "from@finmon.app");
    return import("@/lib/email");
  }

  it("sends a verification email and escapes the user name in HTML", async () => {
    sendMock.mockResolvedValue({ error: null });
    const { sendVerificationEmail } = await load();

    await sendVerificationEmail({
      user: { email: "user@example.com", name: "<script>" },
      url: "https://finmon.app/verify?token=abc",
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
    const arg = sendMock.mock.calls[0][0];
    expect(arg).toMatchObject({
      from: "from@finmon.app",
      to: "user@example.com",
    });
    expect(arg.subject).toContain("Verify");
    expect(arg.html).toContain("&lt;script&gt;");
    expect(arg.html).not.toContain("<script>");
    expect(arg.text).toContain("https://finmon.app/verify?token=abc");
  });

  it("sends a password-reset email", async () => {
    sendMock.mockResolvedValue({ error: null });
    const { sendPasswordResetEmail } = await load();

    await sendPasswordResetEmail({
      user: { email: "user@example.com" },
      url: "https://finmon.app/reset?token=xyz",
    });

    const arg = sendMock.mock.calls[0][0];
    expect(arg.subject).toContain("Reset");
    expect(arg.text).toContain("https://finmon.app/reset?token=xyz");
  });

  it("throws when Resend returns an error", async () => {
    sendMock.mockResolvedValue({ error: { message: "boom" } });
    const { sendVerificationEmail } = await load();

    await expect(
      sendVerificationEmail({
        user: { email: "user@example.com" },
        url: "https://finmon.app/verify",
      }),
    ).rejects.toThrow("Resend send failed: boom");
  });
});

describe("without RESEND_API_KEY", () => {
  it("logs instead of sending and does not throw", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { sendVerificationEmail } = await import("@/lib/email");

    await sendVerificationEmail({
      user: { email: "user@example.com" },
      url: "https://finmon.app/verify",
    });

    expect(sendMock).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledOnce();
  });
});

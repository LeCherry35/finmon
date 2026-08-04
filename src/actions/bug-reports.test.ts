import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formData, TEST_USER_ID } from "../../test/helpers";

const { query } = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("@/db", () => ({ pool: { query } }));
vi.mock("@/lib/dal", () => ({
  requireUser: vi.fn(async () => ({ id: "user-1", email: "user@example.com" })),
}));

import { submitBugReport } from "@/actions/bug-reports";

beforeEach(() => {
  query.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("submitBugReport", () => {
  const prev = { successCount: 1 };

  it("rejects an empty message", async () => {
    const result = await submitBugReport(prev, formData({ message: "  " }));
    expect(result).toEqual({ error: "Describe the bug first", successCount: 1 });
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects a message over 5000 characters", async () => {
    const result = await submitBugReport(
      prev,
      formData({ message: "x".repeat(5001) }),
    );
    expect(result).toEqual({
      error: "Keep it under 5000 characters",
      successCount: 1,
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("inserts the trimmed message with the reporter's id and email", async () => {
    query.mockResolvedValueOnce({});
    const result = await submitBugReport(
      prev,
      formData({ message: "  The chart is empty  " }),
    );
    expect(result).toEqual({ successCount: 2 });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO bug_reports \(user_id, email, message\)/);
    expect(params).toEqual([TEST_USER_ID, "user@example.com", "The chart is empty"]);
  });
});

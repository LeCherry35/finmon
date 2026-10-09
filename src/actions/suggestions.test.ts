import { beforeEach, describe, expect, it, vi } from "vitest";

const { decideWithNote, decideAllPending, countPendingProposals, revalidatePath } = vi.hoisted(() => ({
  decideWithNote: vi.fn(),
  decideAllPending: vi.fn(),
  countPendingProposals: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/dal", () => ({ requireUser: vi.fn(async () => ({ id: "user-1" })) }));
vi.mock("@/lib/agent-proposals", () => ({ countPendingProposals }));
vi.mock("@/lib/agent-chats", async () => ({
  ...(await vi.importActual<typeof import("@/lib/agent-chats")>("@/lib/agent-chats")),
  decideWithNote,
  decideAllPending,
}));

import {
  acceptAllSuggestions,
  acceptSuggestion,
  countPendingSuggestions,
  rejectAllSuggestions,
  rejectSuggestion,
} from "@/actions/suggestions";

beforeEach(() => {
  decideWithNote.mockReset();
  decideAllPending.mockReset();
  countPendingProposals.mockReset();
  revalidatePath.mockReset();
});

describe("suggestions actions", () => {
  it("counts the signed-in user's pending proposals", async () => {
    countPendingProposals.mockResolvedValue(4);
    expect(await countPendingSuggestions()).toBe(4);
    expect(countPendingProposals).toHaveBeenCalledWith("user-1");
  });

  it.each([0, -1, 1.5, NaN])("refuses an invalid id (%s)", async (id) => {
    expect(await acceptSuggestion(id)).toEqual({ ok: false, error: "Invalid proposal" });
    expect(decideWithNote).not.toHaveBeenCalled();
  });

  it.each([
    [acceptSuggestion, "accept"],
    [rejectSuggestion, "reject"],
  ] as const)("decides as the signed-in user and revalidates (%#)", async (action, decision) => {
    decideWithNote.mockResolvedValue({ ok: true, data: { id: 12, status: "accepted" } });
    expect(await action(12)).toEqual({ ok: true, data: { id: 12, status: "accepted" } });
    expect(decideWithNote).toHaveBeenCalledWith("user-1", 12, decision);
    expect(revalidatePath).toHaveBeenCalledWith("/suggestions");
  });

  it("passes a refusal through without revalidating", async () => {
    decideWithNote.mockResolvedValue({ ok: false, error: "Already accepted" });
    expect(await acceptSuggestion(12)).toEqual({ ok: false, error: "Already accepted" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("turns an unexpected failure into a friendly error", async () => {
    decideWithNote.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await acceptSuggestion(12)).toEqual({ ok: false, error: "Something went wrong with the assistant." });
  });
});

describe("accept / reject all", () => {
  it.each([
    [acceptAllSuggestions, "accept"],
    [rejectAllSuggestions, "reject"],
  ] as const)("decides every pending suggestion as the signed-in user (%#)", async (action, decision) => {
    decideAllPending.mockResolvedValue({ ok: true, data: [{ id: 4 }] });
    expect(await action()).toEqual({ ok: true, data: [{ id: 4 }] });
    expect(decideAllPending).toHaveBeenCalledWith("user-1", decision);
    expect(revalidatePath).toHaveBeenCalledWith("/suggestions");
  });

  it("passes a refusal through without revalidating", async () => {
    decideAllPending.mockResolvedValue({ ok: false, error: "busy" });
    expect(await rejectAllSuggestions()).toEqual({ ok: false, error: "busy" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

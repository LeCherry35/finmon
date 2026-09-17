// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const actions = vi.hoisted(() => ({
  acceptProposal: vi.fn(),
  deleteAgentChat: vi.fn(),
  listAgentChats: vi.fn(),
  loadAgentChat: vi.fn(),
  rejectProposal: vi.fn(),
  sendAgentMessage: vi.fn(),
}));
vi.mock("@/actions/agent", () => actions);

import AssistantView from "@/components/agent/AssistantView";

const proposal = { id: 12, status: "pending", summary: "Delete transaction 3", error: null };

function chatState(opts: { chatId?: number; withProposal?: boolean; status?: string } = {}) {
  const { chatId = 7, withProposal = false, status = "pending" } = opts;
  return {
    chatId,
    messages: [
      { id: "u1", role: "user", text: "hello", tools: [], error: null, createdAt: 1 },
      {
        id: "a1",
        role: "assistant",
        text: "Here you go",
        error: null,
        createdAt: 2,
        tools: withProposal
          ? [{ name: "delete_transaction", status: "completed", proposalId: 12, error: null }]
          : [],
      },
    ],
    proposals: withProposal ? { 12: { ...proposal, status } } : {},
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const input = () => screen.getByRole("textbox", { name: "Message" });
const sendBtn = () => screen.getByRole("button", { name: "Send" });

beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockReset();
  actions.listAgentChats.mockResolvedValue([{ id: 7, title: "hello", created_at: "2026-09-17T10:00:00Z" }]);
});

describe("AssistantView", () => {
  it("keeps Send usable after the first message and continues the new chat", async () => {
    const user = userEvent.setup();
    actions.sendAgentMessage.mockResolvedValue({ ok: true, data: chatState() });
    const replaceState = vi.spyOn(window.history, "replaceState");
    render(<AssistantView initialChats={[]} />);

    await user.type(input(), "hello{Enter}");
    await screen.findByText("Here you go");
    expect(actions.sendAgentMessage).toHaveBeenCalledWith(null, "hello");

    await user.type(input(), "again");
    await waitFor(() => expect(sendBtn()).toBeEnabled());
    await user.click(sendBtn());
    await waitFor(() => expect(actions.sendAgentMessage).toHaveBeenLastCalledWith(7, "again"));
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("makes a proposal actionable as soon as the reply lands", async () => {
    const user = userEvent.setup();
    actions.sendAgentMessage.mockResolvedValue({ ok: true, data: chatState({ withProposal: true }) });
    actions.acceptProposal.mockResolvedValue({ ok: true, data: chatState({ withProposal: true, status: "accepted" }) });
    render(<AssistantView initialChats={[]} />);

    await user.type(input(), "delete it{Enter}");
    const accept = await screen.findByRole("button", { name: "Accept" });
    await waitFor(() => expect(accept).toBeEnabled());
    await user.click(accept);

    expect(actions.acceptProposal).toHaveBeenCalledWith(7, 12);
    await screen.findByText("Applied");
  });

  it("is single-flight while a turn is running", async () => {
    const user = userEvent.setup();
    const pending = deferred<unknown>();
    actions.sendAgentMessage.mockReturnValue(pending.promise);
    render(<AssistantView initialChats={[{ id: 3, title: "old", created_at: "2026-09-01T10:00:00Z" }]} />);

    await user.type(input(), "one{Enter}");
    await user.type(input(), "two{Enter}");
    expect(actions.sendAgentMessage).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Thinking")).toBeInTheDocument();
    expect(sendBtn()).toBeDisabled();
    expect(screen.getByRole("button", { name: /New chat/ })).toBeDisabled();

    await act(async () => pending.resolve({ ok: true, data: chatState() }));
    await waitFor(() => expect(sendBtn()).toBeEnabled());
    expect(screen.getByRole("button", { name: /hello/ })).toBeEnabled();
  });

  it("restores the draft and re-enables Send on an error result", async () => {
    const user = userEvent.setup();
    actions.sendAgentMessage.mockResolvedValue({ ok: false, error: "Too many messages — wait a minute." });
    render(<AssistantView initialChats={[]} />);

    await user.type(input(), "hi{Enter}");
    await screen.findByText("Too many messages — wait a minute.");
    expect(input()).toHaveValue("hi");
    expect(sendBtn()).toBeEnabled();
  });

  it("recovers when the request throws", async () => {
    const user = userEvent.setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    actions.sendAgentMessage.mockRejectedValue(new Error("network"));
    render(<AssistantView initialChats={[]} />);

    await user.type(input(), "hi{Enter}");
    await screen.findByText("The assistant took too long to answer. Try again in a moment.");
    expect(screen.queryByLabelText("Thinking")).toBeNull();
    expect(input()).toHaveValue("hi");
    expect(sendBtn()).toBeEnabled();
  });

  it("reloads an existing chat when the request throws, since the turn may have finished", async () => {
    const user = userEvent.setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    actions.sendAgentMessage
      .mockResolvedValueOnce({ ok: true, data: chatState() })
      .mockRejectedValueOnce(new Error("524"));
    actions.loadAgentChat.mockResolvedValue({ ok: true, data: chatState({ withProposal: true }) });
    render(<AssistantView initialChats={[]} />);

    await user.type(input(), "hello{Enter}");
    await screen.findByText("Here you go");
    await user.type(input(), "delete it{Enter}");

    expect(await screen.findByRole("button", { name: "Accept" })).toBeEnabled();
    expect(actions.loadAgentChat).toHaveBeenCalledWith(7);
    await screen.findByText("The assistant took too long to answer. Try again in a moment.");
    expect(input()).toHaveValue("delete it");
    expect(sendBtn()).toBeEnabled();
  });

  it("does not touch the typed draft when a suggestion is used", async () => {
    const user = userEvent.setup();
    actions.sendAgentMessage.mockResolvedValue({ ok: false, error: "nope" });
    render(<AssistantView initialChats={[]} />);

    await user.type(input(), "my draft");
    await user.click(screen.getByRole("button", { name: "Am I over plan anywhere?" }));
    await screen.findByText("nope");
    expect(actions.sendAgentMessage).toHaveBeenCalledWith(null, "Am I over plan anywhere?");
    expect(input()).toHaveValue("my draft");
  });

  it("re-syncs the cards when a decision fails", async () => {
    const user = userEvent.setup();
    actions.sendAgentMessage.mockResolvedValue({ ok: true, data: chatState({ withProposal: true }) });
    actions.rejectProposal.mockResolvedValue({ ok: false, error: "Already accepted" });
    actions.loadAgentChat.mockResolvedValue({ ok: true, data: chatState({ withProposal: true, status: "accepted" }) });
    render(<AssistantView initialChats={[]} />);

    await user.type(input(), "delete it{Enter}");
    await user.click(await screen.findByRole("button", { name: "Reject" }));

    await screen.findByText("Already accepted");
    await screen.findByText("Applied");
    expect(actions.loadAgentChat).toHaveBeenCalledWith(7);
  });
});

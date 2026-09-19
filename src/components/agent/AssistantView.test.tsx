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
  stopAgentMessage: vi.fn(),
}));
vi.mock("@/actions/agent", () => actions);

import AssistantView from "@/components/agent/AssistantView";

const proposal = { id: 12, status: "pending", summary: "Delete transaction 3", error: null };

function chatState(opts: { chatId?: number; withProposal?: boolean; status?: string; running?: boolean } = {}) {
  const { chatId = 7, withProposal = false, status = "pending", running = false } = opts;
  return {
    chatId,
    running,
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
    expect(actions.sendAgentMessage).toHaveBeenCalledWith(null, "hello", null);

    await user.type(input(), "again");
    await waitFor(() => expect(sendBtn()).toBeEnabled());
    await user.click(sendBtn());
    await waitFor(() => expect(actions.sendAgentMessage).toHaveBeenLastCalledWith(7, "again", null));
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
    await screen.findByText("Couldn't reach the assistant. Try again.");
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
    await screen.findByText("Couldn't reach the assistant. Try again.");
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
    expect(actions.sendAgentMessage).toHaveBeenCalledWith(null, "Am I over plan anywhere?", null);
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

  it("sends a staged receipt photo without text and shows it as a chip", async () => {
    const user = userEvent.setup();
    const reply = deferred<unknown>();
    actions.sendAgentMessage.mockReturnValue(reply.promise);
    render(<AssistantView initialChats={[]} />);

    expect(sendBtn()).toBeDisabled();
    const file = new File(["img"], "receipt.jpg", { type: "image/jpeg" });
    await user.upload(screen.getByLabelText("Receipt photo"), file);
    await screen.findByRole("img", { name: "Receipt photo" });
    expect(sendBtn()).toBeEnabled();

    await user.click(sendBtn());
    expect(actions.sendAgentMessage).toHaveBeenCalledWith(
      null,
      "",
      expect.stringMatching(/^data:image\/jpeg;base64,/),
    );
    // The composer is cleared; the pending bubble carries the photo chip.
    expect(screen.queryByRole("img", { name: "Receipt photo" })).not.toBeInTheDocument();
    expect(screen.getByText("Receipt photo")).toBeInTheDocument();

    await act(async () => reply.resolve({ ok: false, error: "nope" }));
    // A failed send puts the photo back.
    await screen.findByRole("img", { name: "Receipt photo" });
  });

  it("follows a running turn: dots and Stop, polling until the reply is in", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const running = chatState({ running: true });
    running.messages = running.messages.slice(0, 1); // only the user's message so far
    actions.sendAgentMessage.mockResolvedValue({ ok: true, data: running });
    actions.loadAgentChat
      .mockResolvedValueOnce({ ok: true, data: running })
      .mockResolvedValue({ ok: true, data: chatState({ withProposal: true }) });
    render(<AssistantView initialChats={[]} />);

    await user.type(input(), "hello{Enter}");
    expect(await screen.findByLabelText("Thinking")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument();

    await act(async () => vi.advanceTimersByTimeAsync(2000)); // still running
    expect(screen.getByLabelText("Thinking")).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(2000)); // done
    await screen.findByText("Here you go");
    expect(screen.queryByLabelText("Thinking")).not.toBeInTheDocument();
    expect(actions.loadAgentChat).toHaveBeenCalledTimes(2);
    expect(actions.loadAgentChat).toHaveBeenCalledWith(7);

    // Finished: no more polling.
    await act(async () => vi.advanceTimersByTimeAsync(6000));
    expect(actions.loadAgentChat).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("stops polling when the page is left", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    actions.sendAgentMessage.mockResolvedValue({ ok: true, data: chatState({ running: true }) });
    actions.loadAgentChat.mockResolvedValue({ ok: true, data: chatState({ running: true }) });
    const { unmount } = render(<AssistantView initialChats={[]} />);

    await user.type(input(), "hello{Enter}");
    await screen.findByRole("button", { name: "Stop" });
    unmount();
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(actions.loadAgentChat).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("shows the dots when reopening a chat whose turn is still running, and blocks Accept", async () => {
    const user = userEvent.setup();
    actions.loadAgentChat.mockResolvedValue({ ok: true, data: chatState({ withProposal: true, running: true }) });
    render(<AssistantView initialChats={[{ id: 7, title: "hello", created_at: "2026-09-17T10:00:00Z" }]} />);

    await user.click(screen.getByRole("button", { name: /New chat/ }));
    await user.click(await screen.findByRole("button", { name: /hello/ }));

    expect(await screen.findByLabelText("Thinking")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Accept" })).toBeDisabled();
  });

  it("Stop undoes the turn and puts the message and photo back in the composer", async () => {
    const user = userEvent.setup();
    actions.sendAgentMessage.mockResolvedValue({ ok: true, data: chatState({ running: true }) });
    actions.stopAgentMessage.mockResolvedValue({
      ok: true,
      data: { state: null, text: "delete everything", attachmentId: 42 },
    });
    render(<AssistantView initialChats={[]} />);

    await user.upload(screen.getByLabelText("Receipt photo"), new File(["img"], "r.jpg", { type: "image/jpeg" }));
    await screen.findByRole("img", { name: "Receipt photo" });
    await user.type(input(), "delete everything{Enter}");
    await user.click(await screen.findByRole("button", { name: "Stop" }));

    expect(actions.stopAgentMessage).toHaveBeenCalledWith(7);
    await waitFor(() => expect(input()).toHaveValue("delete everything"));
    expect(screen.getByRole("img", { name: "Receipt photo" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Thinking")).not.toBeInTheDocument();
    expect(screen.queryByText("Here you go")).not.toBeInTheDocument(); // back to a new chat
    expect(actions.listAgentChats).toHaveBeenCalled();
    expect(sendBtn()).toBeEnabled();
  });

  it("shows the finished reply when Stop comes too late", async () => {
    const user = userEvent.setup();
    actions.sendAgentMessage.mockResolvedValue({ ok: true, data: chatState({ running: true }) });
    actions.stopAgentMessage.mockResolvedValue({ ok: false, error: "Already finished" });
    actions.loadAgentChat.mockResolvedValue({ ok: true, data: chatState() });
    render(<AssistantView initialChats={[]} />);

    await user.type(input(), "hello{Enter}");
    await user.click(await screen.findByRole("button", { name: "Stop" }));

    await waitFor(() => expect(screen.queryByLabelText("Thinking")).not.toBeInTheDocument());
    expect(screen.getByText("Here you go")).toBeInTheDocument();
    expect(screen.queryByText("Already finished")).not.toBeInTheDocument();
    expect(input()).toHaveValue("");
  });

  it("shows one agent row per turn: tool-only steps add no extra icons", async () => {
    const user = userEvent.setup();
    const toolStep = (id: string) => ({
      id, role: "assistant", text: "", error: null, createdAt: 2, attachmentId: null,
      tools: [{ name: "search_transactions", status: "completed", proposalId: null, error: null }],
    });
    const state = chatState();
    state.messages = [state.messages[0], toolStep("s1"), toolStep("s2"), state.messages[1]];
    actions.sendAgentMessage.mockResolvedValue({ ok: true, data: { ...state, running: true } });
    render(<AssistantView initialChats={[]} />);

    await user.type(input(), "hello{Enter}");
    const dots = await screen.findByLabelText("Thinking");
    const reply = screen.getByText("Here you go");
    // One row (one icon) holds the whole turn: the reply and the running dots.
    const rows = screen.getAllByRole("group", { name: "Assistant" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContainElement(reply);
    expect(rows[0]).toContainElement(dots);
  });

  it("can remove a staged photo", async () => {
    const user = userEvent.setup();
    render(<AssistantView initialChats={[]} />);
    await user.upload(
      screen.getByLabelText("Receipt photo"),
      new File(["img"], "r.jpg", { type: "image/jpeg" }),
    );
    await user.click(await screen.findByRole("button", { name: "Remove photo" }));
    expect(screen.queryByRole("img", { name: "Receipt photo" })).not.toBeInTheDocument();
    expect(sendBtn()).toBeDisabled();
  });
});

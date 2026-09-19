// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SuggestionItem } from "@/lib/agent-proposals";

const { acceptSuggestion, rejectSuggestion, refresh } = vi.hoisted(() => ({
  acceptSuggestion: vi.fn(),
  rejectSuggestion: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/actions/suggestions", () => ({ acceptSuggestion, rejectSuggestion }));
vi.mock("@/components/agent/SuggestionCount", () => ({
  useSuggestionCount: () => ({ count: 1, refresh }),
}));

import SuggestionsView from "@/components/agent/SuggestionsView";

const item = (id: number, over: Partial<SuggestionItem> = {}): SuggestionItem => ({
  id,
  chat_id: 5,
  chat_title: "Lunch",
  tool: "create_transaction",
  args: {},
  summary: `Create spend #${id}\namount: 12.50`,
  status: "pending",
  error: null,
  created_at: "2026-09-19T10:00:00Z",
  decided_at: null,
  ...over,
});

const section = (name: RegExp) => screen.getByRole("heading", { name }).parentElement!;

beforeEach(() => {
  acceptSuggestion.mockReset();
  rejectSuggestion.mockReset();
  refresh.mockReset();
});

describe("SuggestionsView", () => {
  it("lists pending suggestions with Accept/Reject and decided ones as history", () => {
    render(
      <SuggestionsView
        initialPending={[item(2)]}
        initialHistory={[item(1, { status: "accepted", decided_at: "2026-09-18T10:00:00Z" })]}
      />,
    );
    const pending = section(/Pending \(1\)/);
    expect(within(pending).getByText("Create spend #2")).toBeTruthy();
    expect(within(pending).getByText(/Lunch/)).toBeTruthy();
    expect(within(pending).getByRole("button", { name: "Accept" })).toBeTruthy();

    const history = section(/History/);
    expect(within(history).getByText("Applied")).toBeTruthy();
    expect(within(history).queryByRole("button")).toBeNull();
  });

  it("moves an accepted suggestion into history and refreshes the count", async () => {
    acceptSuggestion.mockResolvedValue({ ok: true, data: item(2, { status: "accepted", decided_at: "2026-09-19T11:00:00Z" }) });
    render(<SuggestionsView initialPending={[item(2)]} initialHistory={[]} />);

    await userEvent.click(screen.getByRole("button", { name: "Accept" }));

    expect(acceptSuggestion).toHaveBeenCalledWith(2);
    expect(section(/Pending \(0\)/).textContent).toContain("Nothing waiting");
    expect(within(section(/History/)).getByText("Applied")).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
  });

  it("shows the error and keeps the suggestion pending when it can't be decided yet", async () => {
    rejectSuggestion.mockResolvedValue({ ok: false, error: "The assistant is still answering. Wait, or stop it first." });
    render(<SuggestionsView initialPending={[item(2)]} initialHistory={[]} />);

    await userEvent.click(screen.getByRole("button", { name: "Reject" }));

    expect(screen.getByText(/still answering/)).toBeTruthy();
    expect(within(section(/Pending \(1\)/)).getByRole("button", { name: "Reject" })).toBeTruthy();
  });

  it("drops a suggestion already decided elsewhere from Pending", async () => {
    acceptSuggestion.mockResolvedValue({ ok: false, error: "Already accepted" });
    render(<SuggestionsView initialPending={[item(2)]} initialHistory={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(screen.getByRole("heading", { name: /Pending \(0\)/ })).toBeTruthy();
    expect(screen.getByText("Already accepted")).toBeTruthy();
  });
});

// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChatsPanel, { formatChatDate } from "@/components/agent/ChatsPanel";

const chats = [
  { id: 2, title: "Groceries question", created_at: "2026-09-17T10:00:00Z" },
  { id: 1, title: null, created_at: "2026-09-01T10:00:00Z" },
];

function setup(activeId: number | null = 2) {
  const onSelect = vi.fn();
  const onDelete = vi.fn();
  render(<ChatsPanel chats={chats} activeId={activeId} busy={false} onSelect={onSelect} onDelete={onDelete} />);
  return { onSelect, onDelete, user: userEvent.setup() };
}

describe("ChatsPanel", () => {
  it("shows the active chat on the trigger and lists chats when opened", async () => {
    const { user } = setup();
    const trigger = screen.getByRole("button", { name: /Groceries question/ });
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Chat 1")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByText("Chat 1")).toBeNull();
  });

  it("selects a chat or a new chat and closes", async () => {
    const { user, onSelect } = setup(null);
    await user.click(screen.getByRole("button", { name: /New chat/ }));
    await user.click(screen.getByText("Chat 1"));
    expect(onSelect).toHaveBeenCalledWith(1);
    expect(screen.queryByText("Chat 1")).toBeNull();

    await user.click(screen.getByRole("button", { name: /New chat/ }));
    await user.click(screen.getAllByRole("button", { name: /New chat/ })[1]);
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("deletes only after a second click", async () => {
    const { user, onDelete } = setup();
    await user.click(screen.getByRole("button", { name: /Groceries question/ }));
    await user.click(screen.getAllByRole("button", { name: "Delete chat" })[1]);
    expect(onDelete).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(onDelete).toHaveBeenCalledWith(1);
  });
});

describe("formatChatDate", () => {
  const now = new Date(2026, 8, 17, 12);
  it.each([
    [new Date(2026, 8, 17, 1), "Today"],
    [new Date(2026, 8, 16, 23), "Yesterday"],
    [new Date(2026, 8, 1), /^1 Sept?$/],
    [new Date(2025, 11, 3), /^3 Dec 2025$/],
  ])("%s → %s", (d, expected) => {
    expect(formatChatDate(d, now)).toMatch(expected);
  });
});

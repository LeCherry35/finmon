"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentChatSummary } from "@/actions/agent";
import { ChatIcon, Chevron, PlusIcon, TrashIcon } from "@/components/agent/icons";

/**
 * The assistant page's header pill — takes FilterPanel's place (same trigger
 * styling and dropdown behaviour). Lists the user's chats with a New chat row
 * and a confirm-twice delete per chat.
 */
export default function ChatsPanel({
  chats,
  activeId,
  busy,
  onSelect,
  onDelete,
}: {
  chats: AgentChatSummary[];
  activeId: number | null;
  busy: boolean;
  onSelect: (id: number | null) => void;
  onDelete: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const el = wrapperRef.current;
      if (el && !el.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => () => {
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
  }, []);

  const active = chats.find((c) => c.id === activeId);
  const label = active ? (active.title ?? `Chat ${active.id}`) : "New chat";

  function select(id: number | null) {
    setOpen(false);
    setConfirmId(null);
    onSelect(id);
  }

  function requestDelete(id: number) {
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    if (confirmId !== id) {
      setConfirmId(id);
      confirmTimer.current = setTimeout(() => setConfirmId(null), 3000);
      return;
    }
    setConfirmId(null);
    onDelete(id);
  }

  const triggerCls = [
    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
    active
      ? "border-zinc-400 text-zinc-900 hover:border-zinc-600"
      : "border-zinc-200 text-zinc-500 hover:border-zinc-300 hover:text-zinc-800",
    "disabled:opacity-50 disabled:cursor-not-allowed",
  ].join(" ");

  return (
    <div ref={wrapperRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={busy}
        className={triggerCls}
        title={`Chat: ${label}`}
        aria-expanded={open}
      >
        <ChatIcon size={12} />
        <span className="truncate max-w-[10rem] md:max-w-[14rem]">{label}</span>
        <Chevron open={open} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-30 w-[min(18rem,calc(100vw-2rem))] md:w-72 rounded-md border border-zinc-200 bg-white text-sm shadow-lg">
          <button
            type="button"
            onClick={() => select(null)}
            disabled={busy}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
          >
            <PlusIcon />
            New chat
          </button>
          <div className="border-t border-zinc-100 px-3 pt-2 pb-1 text-xs font-semibold text-zinc-700">
            Chats
          </div>
          <ul className="max-h-80 overflow-auto pb-1">
            {chats.map((c) => {
              const confirming = confirmId === c.id;
              return (
                <li
                  key={c.id}
                  className={`group flex items-center ${c.id === activeId ? "bg-zinc-100" : "hover:bg-zinc-50"}`}
                >
                  <button
                    type="button"
                    onClick={() => select(c.id)}
                    disabled={busy}
                    className="min-w-0 flex-1 px-3 py-2 text-left disabled:opacity-50"
                  >
                    <span className="block truncate text-zinc-800">{c.title ?? `Chat ${c.id}`}</span>
                    <span className="block text-[11px] text-zinc-400">{formatChatDate(c.created_at)}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => requestDelete(c.id)}
                    disabled={busy}
                    aria-label={confirming ? "Confirm delete" : "Delete chat"}
                    title={confirming ? "Click again to delete" : "Delete chat"}
                    className={`mr-1 inline-flex min-h-10 min-w-10 items-center justify-center gap-1 rounded text-xs disabled:opacity-50 ${
                      confirming
                        ? "px-2 text-red-600"
                        : "text-zinc-400 hover:text-red-600 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
                    }`}
                  >
                    <TrashIcon />
                    {confirming && "Delete?"}
                  </button>
                </li>
              );
            })}
            {chats.length === 0 && <li className="px-3 py-2 text-xs text-zinc-400">No chats yet</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

/** "Today" / "Yesterday" / "12 Sep" (plus the year when it isn't this year). */
export function formatChatDate(value: string | Date, now: Date = new Date()): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  acceptProposal,
  listAgentChats,
  loadAgentChat,
  rejectProposal,
  sendAgentMessage,
  type AgentChatState,
  type AgentChatSummary,
  type AgentResult,
} from "@/actions/agent";
import ProposalCard from "@/components/agent/ProposalCard";

/**
 * Header button + chat panel for the finmon assistant. Full-screen sheet on
 * mobile, right-hand side panel from md: up. No streaming: each send waits for
 * the whole agent turn, showing a "Thinking…" row meanwhile.
 */
export default function AgentChatButton() {
  const [open, setOpen] = useState(false);
  const [chat, setChat] = useState<AgentChatState | null>(null);
  const [chats, setChats] = useState<AgentChatSummary[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [chat, pendingText, open]);

  function apply(result: AgentResult<AgentChatState>) {
    if (result.ok) {
      setChat(result.data);
      setError(null);
    } else {
      setError(result.error);
    }
  }

  function openPanel() {
    setOpen(true);
    startTransition(async () => {
      setChats(await listAgentChats());
    });
  }

  function send() {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    setPendingText(text);
    startTransition(async () => {
      const result = await sendAgentMessage(chat?.chatId ?? null, text);
      setPendingText(null);
      if (!result.ok) setDraft(text);
      apply(result);
      if (result.ok && !chat) setChats(await listAgentChats());
    });
  }

  function openChat(id: number) {
    setError(null);
    startTransition(async () => apply(await loadAgentChat(id)));
  }

  function decide(proposalId: number, accept: boolean) {
    if (!chat) return;
    startTransition(async () => {
      apply(await (accept ? acceptProposal : rejectProposal)(chat.chatId, proposalId));
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={openPanel}
        aria-label="Assistant"
        title="Assistant"
        className="inline-flex min-w-10 min-h-10 items-center justify-center text-zinc-400 hover:text-zinc-700"
      >
        <ChatIcon />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40 hidden md:block"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Assistant"
            className="fixed inset-0 z-50 flex flex-col bg-white md:inset-y-0 md:left-auto md:right-0 md:w-[28rem] md:border-l md:border-zinc-200 md:shadow-lg pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)]"
          >
            <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-2">
              <h2 className="text-base font-semibold">Assistant</h2>
              <select
                aria-label="Previous chats"
                value={chat?.chatId ?? ""}
                disabled={busy}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  if (id) openChat(id);
                  else setChat(null);
                }}
                className="ml-auto max-w-[11rem] truncate rounded border border-zinc-300 bg-white px-2 py-1 text-sm"
              >
                <option value="">New chat</option>
                {chats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title ?? `Chat ${c.id}`}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="w-10 h-10 -mr-2 flex items-center justify-center text-zinc-400 hover:text-zinc-700"
              >
                <XIcon />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {!chat && !pendingText && (
                <p className="text-sm text-zinc-500">
                  Ask about your spending, plans or transactions — e.g. “How much did I spend on
                  groceries last month?” or “Add 12.50 for lunch today”. Any change is shown to you
                  for approval first.
                </p>
              )}

              {chat?.messages.map((m) => (
                <div key={m.id} className={m.role === "user" ? "flex justify-end" : "space-y-2"}>
                  {m.text && (
                    <div
                      className={
                        m.role === "user"
                          ? "max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-zinc-900 px-3 py-2 text-sm text-white"
                          : "whitespace-pre-wrap text-sm text-zinc-800"
                      }
                    >
                      {m.text}
                    </div>
                  )}
                  {m.tools.map((t, i) => {
                    const proposal = t.proposalId !== null ? chat.proposals[t.proposalId] : undefined;
                    if (proposal) {
                      return (
                        <ProposalCard
                          key={i}
                          proposal={proposal}
                          busy={busy}
                          onAccept={() => decide(proposal.id, true)}
                          onReject={() => decide(proposal.id, false)}
                        />
                      );
                    }
                    if (t.status === "error") {
                      return (
                        <p key={i} className="text-xs text-zinc-400">
                          {t.name}: {t.error}
                        </p>
                      );
                    }
                    return null;
                  })}
                  {m.error && <p className="text-sm text-red-600">{m.error}</p>}
                </div>
              ))}

              {pendingText && (
                <>
                  <div className="flex justify-end">
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-zinc-900 px-3 py-2 text-sm text-white">
                      {pendingText}
                    </div>
                  </div>
                  <p className="text-sm text-zinc-400 animate-pulse">Thinking…</p>
                </>
              )}
              {error && <p className="text-sm text-red-600">{error}</p>}
              <div ref={bottomRef} />
            </div>

            <form
              className="flex items-end gap-2 border-t border-zinc-200 px-4 py-3"
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={2}
                maxLength={2000}
                autoFocus
                placeholder="Ask the assistant…"
                className="flex-1 resize-none rounded border border-zinc-300 px-3 py-2 text-base md:text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
              />
              <button
                type="submit"
                disabled={busy || !draft.trim()}
                className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
              >
                Send
              </button>
            </form>
          </div>
        </>
      )}
    </>
  );
}

function ChatIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

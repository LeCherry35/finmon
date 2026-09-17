"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  acceptProposal,
  deleteAgentChat,
  listAgentChats,
  loadAgentChat,
  rejectProposal,
  sendAgentMessage,
  type AgentChatState,
  type AgentChatSummary,
  type AgentResult,
} from "@/actions/agent";
import ChatsPanel from "@/components/agent/ChatsPanel";
import ProposalCard from "@/components/agent/ProposalCard";
import { SendIcon, SparkIcon, WarnIcon } from "@/components/agent/icons";

const SUGGESTIONS = [
  "How much did I spend this month?",
  "Add 12.50 for lunch today",
  "Am I over plan anywhere?",
];

/**
 * The /assistant page body: standard page header (title + ChatsPanel in
 * FilterPanel's spot) over a conversation card. No streaming — each send
 * waits for the whole agent turn, showing a typing bubble meanwhile. The open
 * chat is mirrored to `?chat=` with history.replaceState (no server refetch).
 */
export default function AssistantView({
  initialChats,
  initialChat,
}: {
  initialChats: AgentChatSummary[];
  initialChat: AgentChatState | null;
}) {
  const [chats, setChats] = useState(initialChats);
  const [chat, setChat] = useState<AgentChatState | null>(initialChat);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat, pendingText, error]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  function syncUrl(chatId: number | null) {
    window.history.replaceState(null, "", chatId ? `/assistant?chat=${chatId}` : "/assistant");
  }

  function apply(result: AgentResult<AgentChatState>) {
    if (result.ok) {
      setChat(result.data);
      setError(null);
    } else {
      setError(result.error);
    }
  }

  function send(raw: string) {
    const text = raw.trim();
    if (!text || busy) return;
    setDraft("");
    setError(null);
    setPendingText(text);
    const isNew = !chat;
    startTransition(async () => {
      const result = await sendAgentMessage(chat?.chatId ?? null, text);
      setPendingText(null);
      if (!result.ok) setDraft(text);
      apply(result);
      if (result.ok && isNew) {
        syncUrl(result.data.chatId);
        setChats(await listAgentChats());
      }
    });
  }

  function selectChat(id: number | null) {
    setError(null);
    if (id === null) {
      setChat(null);
      syncUrl(null);
      inputRef.current?.focus();
      return;
    }
    if (id === chat?.chatId) return;
    startTransition(async () => {
      const result = await loadAgentChat(id);
      apply(result);
      if (result.ok) syncUrl(id);
    });
  }

  function removeChat(id: number) {
    startTransition(async () => {
      const result = await deleteAgentChat(id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setChats((cs) => cs.filter((c) => c.id !== id));
      if (chat?.chatId === id) {
        setChat(null);
        syncUrl(null);
      }
    });
  }

  function decide(proposalId: number, accept: boolean) {
    if (!chat) return;
    startTransition(async () => {
      apply(await (accept ? acceptProposal : rejectProposal)(chat.chatId, proposalId));
    });
  }

  const empty = !chat?.messages.length && !pendingText;

  return (
    <div className="max-w-5xl mx-auto py-6 px-4 space-y-6 md:py-10">
      <div className="flex flex-col items-start gap-2 md:flex-row md:items-center md:gap-3">
        <h1 className="text-xl font-semibold">Assistant</h1>
        <ChatsPanel
          chats={chats}
          activeId={chat?.chatId ?? null}
          busy={busy}
          onSelect={selectChat}
          onDelete={removeChat}
        />
      </div>

      <div className="flex flex-col overflow-hidden rounded-lg border border-zinc-200 h-[calc(100dvh-env(safe-area-inset-bottom,0px)-17.5rem)] md:h-[calc(100dvh-12.5rem)] min-h-80">
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4 md:px-6 space-y-4">
          {empty ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 text-zinc-600">
                <SparkIcon size={22} />
              </span>
              <p className="max-w-sm text-sm text-zinc-500">
                Ask about your spending, plans or transactions. Any change is shown to you for
                approval first.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    disabled={busy}
                    className="rounded-full border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 hover:border-zinc-400 hover:text-zinc-900 disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {chat?.messages.map((m) =>
                m.role === "user" ? (
                  <UserBubble key={m.id} text={m.text} />
                ) : (
                  <AssistantRow key={m.id}>
                    {m.text && <div className={ASSISTANT_BUBBLE}>{m.text}</div>}
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
                          <p key={i} className="flex items-center gap-1 text-xs text-zinc-400">
                            <WarnIcon />
                            {t.name}: {t.error}
                          </p>
                        );
                      }
                      return null;
                    })}
                    {m.error && <p className="text-sm text-red-600">{m.error}</p>}
                  </AssistantRow>
                ),
              )}
              {pendingText && (
                <>
                  <UserBubble text={pendingText} />
                  <AssistantRow>
                    <div className={`${ASSISTANT_BUBBLE} flex gap-1 py-3`} aria-label="Thinking">
                      {[0, 150, 300].map((delay) => (
                        <span
                          key={delay}
                          className="h-1.5 w-1.5 rounded-full bg-zinc-400 animate-bounce"
                          style={{ animationDelay: `${delay}ms` }}
                        />
                      ))}
                    </div>
                  </AssistantRow>
                </>
              )}
            </>
          )}
          {error && <p className="text-center text-sm text-red-600">{error}</p>}
        </div>

        <form
          className="border-t border-zinc-200 bg-zinc-50/60 px-3 py-3 md:px-6"
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
        >
          <div className="flex items-end gap-2 rounded-2xl border border-zinc-300 bg-white py-1.5 pl-3 pr-1.5 focus-within:border-zinc-500">
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(draft);
                }
              }}
              rows={1}
              maxLength={2000}
              placeholder="Ask the assistant…"
              aria-label="Message"
              className="max-h-40 flex-1 resize-none bg-transparent py-1.5 text-sm focus:outline-none"
            />
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              aria-label="Send"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white hover:bg-zinc-700 disabled:opacity-40"
            >
              <SendIcon />
            </button>
          </div>
          <p className="mt-1.5 hidden text-[11px] text-zinc-400 md:block">
            Enter to send · Shift+Enter for a new line
          </p>
        </form>
      </div>
    </div>
  );
}

const ASSISTANT_BUBBLE =
  "whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-zinc-100 px-3.5 py-2 text-sm text-zinc-800";

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] md:max-w-[75%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-zinc-900 px-3.5 py-2 text-sm text-white">
        {text}
      </div>
    </div>
  );
}

function AssistantRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white">
        <SparkIcon size={14} />
      </span>
      <div className="min-w-0 max-w-[85%] md:max-w-[75%] space-y-2">{children}</div>
    </div>
  );
}

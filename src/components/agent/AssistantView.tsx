"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import {
  acceptProposal,
  deleteAgentChat,
  listAgentChats,
  loadAgentChat,
  rejectProposal,
  sendAgentMessage,
  stopAgentMessage,
  type AgentChatState,
  type AgentChatSummary,
  type AgentResult,
} from "@/actions/agent";
import AssistantMarkdown from "@/components/agent/AssistantMarkdown";
import ChatsPanel from "@/components/agent/ChatsPanel";
import ProposalCard from "@/components/agent/ProposalCard";
import { CameraIcon, SendIcon, SparkIcon, StopIcon, WarnIcon, XIcon } from "@/components/agent/icons";
import { fileToDataUrl } from "@/components/ReceiptUpload";

const SUGGESTIONS = [
  "How much did I spend this month?",
  "Add 12.50 for lunch today",
  "Am I over plan anywhere?",
];

/** How often an open chat whose turn is still running is re-checked. */
const POLL_MS = 2000;

/**
 * The /assistant page body: standard page header (title + ChatsPanel in
 * FilterPanel's spot) over a conversation card. No streaming. A send only
 * starts the agent's turn (it runs on in opencode even if this page is left),
 * and while the open chat is `running` the page polls it every POLL_MS,
 * showing a typing bubble and a Stop button, until the reply is in. Coming
 * back to a chat mid-turn looks the same.
 *
 * `busy` is plain component state driven by the single-flight `run` helper,
 * deliberately not `useTransition`: server actions and Next's patched
 * `history.replaceState` dispatch router transitions that can entangle with
 * ours and pin `isPending` (which left Send/Accept disabled). For the same
 * reason the open chat isn't mirrored to the URL.
 */
export default function AssistantView({ initialChats }: { initialChats: AgentChatSummary[] }) {
  const [chats, setChats] = useState(initialChats);
  const [chat, setChat] = useState<AgentChatState | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** The message being sent, shown until the send returns (about a second). */
  const [pending, setPending] = useState<{ text: string; photo: boolean } | null>(null);
  /** A staged receipt photo (downscaled data URL) for the next message. */
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  /** Bumped whenever the open chat is set by the user's own actions, so a
   *  poll that started before can't overwrite the newer state. */
  const epoch = useRef(0);
  /** The last message this tab sent, so Stop can give its photo back too. */
  const lastSent = useRef<{ text: string; image: string | null } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const running = !!chat?.running;
  const runningChatId = running ? chat!.chatId : null;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat, pending, error]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  // Follow a running turn until it ends. Leaving the page (or the chat) just
  // stops the polling; the turn itself runs on in opencode.
  useEffect(() => {
    if (runningChatId === null) return;
    let active = true;
    let polling = false;
    const timer = setInterval(async () => {
      if (polling || inFlight.current) return;
      polling = true;
      const startedAt = epoch.current;
      try {
        const result = await loadAgentChat(runningChatId);
        if (active && result.ok && epoch.current === startedAt) {
          setChat((c) => (c?.chatId === runningChatId ? result.data : c));
        }
      } catch (err) {
        console.error("Polling the assistant failed:", err);
      } finally {
        polling = false;
      }
    }, POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [runningChatId]);

  /** Runs one server operation at a time; `busy` always clears, even on throw. */
  async function run(op: () => Promise<void>, onFail?: () => void) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await op();
    } catch (err) {
      console.error("Assistant request failed:", err);
      setError("Couldn't reach the assistant. Try again.");
      onFail?.();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function showChat(state: AgentChatState | null) {
    epoch.current++;
    setChat(state);
  }

  function apply(result: AgentResult<AgentChatState>) {
    if (result.ok) {
      showChat(result.data);
      setError(null);
    } else {
      setError(result.error);
    }
  }

  async function stagePhoto(file: File | undefined) {
    if (!file) return;
    try {
      setPhoto(await fileToDataUrl(file));
      setError(null);
    } catch {
      setError("Couldn't read that photo.");
    }
  }

  /** `fromInput`: the text (and staged photo) is the composer's (clear it,
   *  restore on failure); suggestion chips leave the composer alone. A staged
   *  photo makes the text optional — the agent scans it as a receipt. */
  function send(raw: string, fromInput: boolean) {
    const text = raw.trim();
    const image = fromInput ? photo : null;
    if ((!text && !image) || inFlight.current || running) return;
    const chatId = chat?.chatId ?? null;
    // Put the text/photo back unless something new was entered meanwhile.
    const restoreDraft = () => {
      if (!fromInput) return;
      setDraft((d) => d || text);
      if (image) setPhoto((p) => p ?? image);
    };
    if (fromInput) {
      setDraft("");
      setPhoto(null);
    }
    setError(null);
    setPending({ text, photo: !!image });
    lastSent.current = { text, image };
    void run(
      async () => {
        let result: AgentResult<AgentChatState>;
        try {
          result = await sendAgentMessage(chatId, text, image);
        } catch (err) {
          // The request itself died (dropped connection). The turn may have
          // started anyway, so pick up whatever landed.
          console.error("sendAgentMessage failed:", err);
          result = { ok: false, error: "Couldn't reach the assistant. Try again." };
          const refreshed = chatId === null ? null : await loadAgentChat(chatId).catch(() => null);
          if (refreshed?.ok) showChat(refreshed.data);
        }
        setPending(null);
        apply(result);
        if (!result.ok) {
          restoreDraft();
          // A new chat's row may exist even though the send failed — show it.
          if (chatId === null) setChats(await listAgentChats().catch(() => chats));
          return;
        }
        if (chatId === null) {
          const id = result.data.chatId;
          const title = !text ? "Receipt scan" : text.length > 60 ? `${text.slice(0, 57)}…` : text;
          setChats((cs) =>
            cs.some((c) => c.id === id) ? cs : [{ id, title, created_at: new Date().toISOString() }, ...cs],
          );
          setChats(await listAgentChats().catch(() => chats));
        }
      },
      // Only reached if something unexpected throws after the request.
      () => {
        setPending(null);
        restoreDraft();
      },
    );
  }

  /** Stop the running turn and undo it: the server aborts it and deletes the
   *  message and any reply; the text (and, if this tab sent it, the photo)
   *  goes back into the composer. */
  function stop() {
    if (!chat?.running) return;
    const chatId = chat.chatId;
    void run(async () => {
      const result = await stopAgentMessage(chatId);
      if (!result.ok) {
        // e.g. the turn finished meanwhile — show where the chat really is.
        if (result.error !== "Already finished") setError(result.error);
        const fresh = await loadAgentChat(chatId);
        if (fresh.ok) showChat(fresh.data);
        return;
      }
      const { state, text, attachmentId } = result.data;
      showChat(state);
      setError(null);
      setDraft((d) => d || text);
      const sent = lastSent.current;
      if (attachmentId !== null && sent?.image && sent.text === text) {
        const image = sent.image;
        setPhoto((p) => p ?? image);
      }
      // A stopped first message leaves no chat behind.
      if (state === null) setChats(await listAgentChats().catch(() => chats));
      inputRef.current?.focus();
    });
  }

  function selectChat(id: number | null) {
    if (inFlight.current) return;
    setError(null);
    if (id === null) {
      showChat(null);
      inputRef.current?.focus();
      return;
    }
    if (id === chat?.chatId) return;
    void run(async () => apply(await loadAgentChat(id)));
  }

  function removeChat(id: number) {
    void run(async () => {
      const result = await deleteAgentChat(id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setChats((cs) => cs.filter((c) => c.id !== id));
      if (chat?.chatId === id) showChat(null);
    });
  }

  function decide(proposalId: number, accept: boolean) {
    if (!chat) return;
    const chatId = chat.chatId;
    void run(async () => {
      const result = await (accept ? acceptProposal : rejectProposal)(chatId, proposalId);
      apply(result);
      if (!result.ok) {
        // e.g. already decided elsewhere — re-sync the cards, keep the error visible.
        const fresh = await loadAgentChat(chatId);
        if (fresh.ok) showChat(fresh.data);
      }
    });
  }

  const empty = !chat?.messages.length && !pending;
  const groups = groupMessages(chat?.messages ?? []);
  // While a turn runs, the dots join the agent's last row rather than adding
  // another icon under it.
  const dotsInLastGroup = running && !pending && groups.at(-1)?.role === "assistant";

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
                    onClick={() => send(s, false)}
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
              {groups.map((g, gi) => {
                if (g.role === "user") {
                  const m = g.messages[0];
                  return <UserBubble key={m.id} text={m.text} photo={m.attachmentId != null} />;
                }
                const withDots = dotsInLastGroup && gi === groups.length - 1;
                const shown = g.messages.filter((m) => hasVisibleContent(m, chat!.proposals));
                if (shown.length === 0 && !withDots) return null;
                return (
                  <AssistantRow key={g.messages[0].id}>
                    {shown.map((m) => (
                      <Fragment key={m.id}>
                        {m.text && (
                          <div className={`${ASSISTANT_BUBBLE} break-words`}>
                            <AssistantMarkdown text={m.text} />
                          </div>
                        )}
                        {m.tools.map((t, i) => {
                          const proposal = t.proposalId !== null ? chat!.proposals[t.proposalId] : undefined;
                          if (proposal) {
                            return (
                              <ProposalCard
                                key={i}
                                proposal={proposal}
                                busy={busy || running}
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
                      </Fragment>
                    ))}
                    {withDots && <ThinkingBubble />}
                  </AssistantRow>
                );
              })}
              {pending && <UserBubble text={pending.text} photo={pending.photo} />}
              {(pending || running) && !dotsInLastGroup && (
                <AssistantRow>
                  <ThinkingBubble />
                </AssistantRow>
              )}
            </>
          )}
          {error && <p className="text-center text-sm text-red-600">{error}</p>}
        </div>

        <form
          className="border-t border-zinc-200 bg-zinc-50/60 px-3 py-3 md:px-6"
          onSubmit={(e) => {
            e.preventDefault();
            send(draft, true);
          }}
        >
          {photo && (
            <div className="mb-2 flex items-center gap-2">
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- a local data URL */}
                <img src={photo} alt="Receipt photo" className="h-14 w-14 rounded-lg border border-zinc-200 object-cover" />
                <button
                  type="button"
                  onClick={() => setPhoto(null)}
                  aria-label="Remove photo"
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900 text-white hover:bg-zinc-700"
                >
                  <XIcon size={10} />
                </button>
              </div>
              <span className="text-xs text-zinc-500">Receipt — the assistant will scan it</span>
            </div>
          )}
          <div className="flex items-end gap-1 rounded-2xl border border-zinc-300 bg-white py-1.5 px-1.5 focus-within:border-zinc-500">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              aria-label="Receipt photo"
              onChange={(e) => {
                void stagePhoto(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              aria-label="Attach receipt photo"
              title="Attach receipt photo"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-40"
            >
              <CameraIcon />
            </button>
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(draft, true);
                }
              }}
              rows={1}
              maxLength={2000}
              placeholder={photo ? "Add a note (optional)…" : "Ask the assistant…"}
              aria-label="Message"
              className="max-h-40 flex-1 resize-none bg-transparent py-1.5 text-sm focus:outline-none"
            />
            {running ? (
              <button
                type="button"
                onClick={stop}
                disabled={busy}
                aria-label="Stop"
                title="Stop and edit your message"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white hover:bg-zinc-700 disabled:opacity-40"
              >
                <StopIcon />
              </button>
            ) : (
              <button
                type="submit"
                disabled={busy || (!draft.trim() && !photo)}
                aria-label="Send"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white hover:bg-zinc-700 disabled:opacity-40"
              >
                <SendIcon />
              </button>
            )}
          </div>
          <p className="mt-1.5 hidden text-[11px] text-zinc-400 md:block">
            Enter to send · Shift+Enter for a new line
          </p>
        </form>
      </div>
    </div>
  );
}

/** A user message, or a run of consecutive assistant messages — opencode stores
 *  one agent turn as a message per step (often just a tool call), and the
 *  whole turn is shown as one row with one icon. */
type AgentMessage = AgentChatState["messages"][number];
type MessageGroup = { role: "user" | "assistant"; messages: AgentMessage[] };

function groupMessages(messages: AgentMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  for (const m of messages) {
    const last = groups.at(-1);
    if (m.role === "assistant" && last?.role === "assistant") last.messages.push(m);
    else groups.push({ role: m.role, messages: [m] });
  }
  return groups;
}

/** Whether an assistant message shows anything: text, an error, a proposal
 *  card or a failed tool. A step that only ran a tool successfully doesn't. */
function hasVisibleContent(m: AgentMessage, proposals: AgentChatState["proposals"]): boolean {
  return (
    !!m.text ||
    !!m.error ||
    m.tools.some((t) => t.status === "error" || (t.proposalId !== null && !!proposals[t.proposalId]))
  );
}

function ThinkingBubble() {
  return (
    <div className={`${ASSISTANT_BUBBLE} flex w-fit gap-1 py-3`} aria-label="Thinking">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="h-1.5 w-1.5 rounded-full bg-zinc-400 animate-bounce"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </div>
  );
}

const ASSISTANT_BUBBLE =
  "rounded-2xl rounded-bl-sm bg-zinc-100 px-3.5 py-2 text-sm text-zinc-800";

function UserBubble({ text, photo = false }: { text: string; photo?: boolean }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] md:max-w-[75%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-zinc-900 px-3.5 py-2 text-sm text-white">
        {photo && (
          <span className="flex items-center gap-1.5 text-xs text-zinc-300">
            <CameraIcon size={14} />
            Receipt photo
          </span>
        )}
        {text && <span className={photo ? "mt-1 block" : undefined}>{text}</span>}
      </div>
    </div>
  );
}

function AssistantRow({ children }: { children: React.ReactNode }) {
  return (
    <div role="group" aria-label="Assistant" className="flex items-start gap-2">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white">
        <SparkIcon size={14} />
      </span>
      <div className="min-w-0 max-w-[85%] md:max-w-[75%] space-y-2">{children}</div>
    </div>
  );
}

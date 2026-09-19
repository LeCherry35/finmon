"use client";

import { useRef, useState } from "react";
import { acceptSuggestion, rejectSuggestion } from "@/actions/suggestions";
import { formatChatDate } from "@/components/agent/ChatsPanel";
import ProposalCard from "@/components/agent/ProposalCard";
import { useSuggestionCount } from "@/components/agent/SuggestionCount";
import type { SuggestionItem } from "@/lib/agent-proposals";

/**
 * The /suggestions page: every change the assistant proposed that's waiting
 * for the user, then the decided ones (history). Deciding here is the same as
 * in the chat — the agent gets the outcome noted in the chat it came from.
 */
export default function SuggestionsView({
  initialPending,
  initialHistory,
}: {
  initialPending: SuggestionItem[];
  initialHistory: SuggestionItem[];
}) {
  const [pending, setPending] = useState(initialPending);
  const [history, setHistory] = useState(initialHistory);
  const [error, setError] = useState<{ id: number; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const { refresh } = useSuggestionCount();

  /** One decision at a time (same single-flight pattern as AssistantView). */
  async function decide(item: SuggestionItem, accept: boolean) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await (accept ? acceptSuggestion : rejectSuggestion)(item.id);
      if (!result.ok) {
        setError({ id: item.id, text: result.error });
        // e.g. already decided in the chat — take it out of Pending.
        if (result.error.startsWith("Already")) setPending((ps) => ps.filter((p) => p.id !== item.id));
        return;
      }
      setPending((ps) => ps.filter((p) => p.id !== item.id));
      setHistory((hs) => [{ ...result.data, chat_title: item.chat_title }, ...hs]);
    } catch (err) {
      console.error("Deciding a suggestion failed:", err);
      setError({ id: item.id, text: "Couldn't reach the server. Try again." });
    } finally {
      inFlight.current = false;
      setBusy(false);
      refresh();
    }
  }

  return (
    <div className="max-w-3xl mx-auto py-6 px-4 space-y-6 md:py-10 md:space-y-8">
      <h1 className="text-xl font-semibold">Suggestions</h1>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-zinc-500">Pending ({pending.length})</h2>
        {error && !pending.some((p) => p.id === error.id) && (
          <p className="text-sm text-red-600">{error.text}</p>
        )}
        {pending.length === 0 && (
          <p className="text-sm text-zinc-400">Nothing waiting for your approval.</p>
        )}
        {pending.map((p) => (
          <Item key={p.id} item={p}>
            <ProposalCard
              proposal={p}
              busy={busy}
              onAccept={() => decide(p, true)}
              onReject={() => decide(p, false)}
            />
            {error?.id === p.id && <p className="text-xs text-red-600">{error.text}</p>}
          </Item>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-zinc-500">History</h2>
        {history.length === 0 && <p className="text-sm text-zinc-400">No decided suggestions yet.</p>}
        {history.map((p) => (
          <Item key={p.id} item={p}>
            <ProposalCard proposal={p} busy onAccept={() => {}} onReject={() => {}} />
          </Item>
        ))}
      </section>
    </div>
  );
}

function Item({ item, children }: { item: SuggestionItem; children: React.ReactNode }) {
  const when = formatChatDate(item.decided_at ?? item.created_at);
  return (
    <div role="group" aria-label={item.summary.split("\n")[0]} className="space-y-1">
      <p className="text-xs text-zinc-400" suppressHydrationWarning>
        {when}
        {item.chat_title && ` · ${item.chat_title}`}
      </p>
      {children}
    </div>
  );
}


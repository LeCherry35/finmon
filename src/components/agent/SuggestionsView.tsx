"use client";

import { useEffect, useRef, useState } from "react";
import {
  acceptAllSuggestions,
  acceptSuggestion,
  rejectAllSuggestions,
  rejectSuggestion,
} from "@/actions/suggestions";
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
  /** "Accept all" / "Reject all" armed by a first click; a second one decides. */
  const [confirmAll, setConfirmAll] = useState<"accept" | "reject" | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const { refresh } = useSuggestionCount();

  useEffect(() => () => {
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
  }, []);

  /** One decision at a time (same single-flight pattern as AssistantView).
   *  A thrown request shows its error under `errorId` (0: above the list). */
  async function single(errorId: number, work: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      console.error("Deciding suggestions failed:", err);
      setError({ id: errorId, text: "Couldn't reach the server. Try again." });
    } finally {
      inFlight.current = false;
      setBusy(false);
      refresh();
    }
  }

  function decide(item: SuggestionItem, accept: boolean) {
    return single(item.id, async () => {
      const result = await (accept ? acceptSuggestion : rejectSuggestion)(item.id);
      if (!result.ok) {
        setError({ id: item.id, text: result.error });
        // e.g. already decided in the chat — take it out of Pending.
        if (result.error.startsWith("Already")) setPending((ps) => ps.filter((p) => p.id !== item.id));
        return;
      }
      setPending((ps) => ps.filter((p) => p.id !== item.id));
      setHistory((hs) => [{ ...result.data, chat_title: item.chat_title }, ...hs]);
    });
  }

  function decideAll(decision: "accept" | "reject") {
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    if (confirmAll !== decision) {
      setConfirmAll(decision);
      confirmTimer.current = setTimeout(() => setConfirmAll(null), 3000);
      return;
    }
    setConfirmAll(null);
    return single(0, async () => {
      const result = await (decision === "accept" ? acceptAllSuggestions : rejectAllSuggestions)();
      if (!result.ok) {
        setError({ id: 0, text: result.error });
        return;
      }
      const decided = new Set(result.data.map((p) => p.id));
      const titles = new Map(pending.map((p) => [p.id, p.chat_title]));
      setPending((ps) => ps.filter((p) => !decided.has(p.id)));
      setHistory((hs) => [
        ...[...result.data].reverse().map((p) => ({ ...p, chat_title: titles.get(p.id) ?? null })),
        ...hs,
      ]);
    });
  }

  return (
    <div className="max-w-3xl mx-auto py-6 px-4 space-y-6 md:py-10 md:space-y-8">
      <h1 className="text-xl font-semibold">Suggestions</h1>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-zinc-500">Pending ({pending.length})</h2>
        {pending.length > 1 && (
          <div className="flex gap-2">
            {(["accept", "reject"] as const).map((d) => (
              <button
                key={d}
                type="button"
                disabled={busy}
                onClick={() => decideAll(d)}
                className={`rounded-full border px-3 py-1 text-xs disabled:opacity-50 ${
                  confirmAll === d ? "border-zinc-900 font-medium" : "border-zinc-300 text-zinc-600 hover:border-zinc-500"
                }`}
              >
                {d === "accept" ? "Accept all" : "Reject all"}
                {confirmAll === d && ` ${pending.length}?`}
              </button>
            ))}
          </div>
        )}
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


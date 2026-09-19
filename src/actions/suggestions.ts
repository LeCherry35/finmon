"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/dal";
import { countPendingProposals, type AgentProposal } from "@/lib/agent-proposals";
import { decideWithNote, guard, type AgentResult as Result } from "@/lib/agent-chats";

// The Suggestions page: the assistant's proposals outside their chat.
// Declared as an alias, not re-exported: see src/actions/agent.ts.
export type SuggestionResult = Result<AgentProposal>;

/** Pending proposals, for the count button (refetched on navigation). */
export async function countPendingSuggestions(): Promise<number> {
  const { id: userId } = await requireUser();
  return countPendingProposals(userId);
}

async function decide(proposalId: number, decision: "accept" | "reject"): Promise<SuggestionResult> {
  const { id: userId } = await requireUser();
  if (!Number.isInteger(proposalId) || proposalId <= 0) return { ok: false, error: "Invalid proposal" };
  const result = await guard(async () => {
    const r = await decideWithNote(userId, proposalId, decision);
    if (!r.ok) return r;
    revalidatePath("/suggestions");
    return r;
  });
  return result.ok ? result.data : result;
}

export async function acceptSuggestion(proposalId: number) {
  return decide(proposalId, "accept");
}

export async function rejectSuggestion(proposalId: number) {
  return decide(proposalId, "reject");
}

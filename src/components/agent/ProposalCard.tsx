"use client";

import type { AgentProposal } from "@/lib/agent-proposals";

const STATUS_STYLES: Record<AgentProposal["status"], string> = {
  pending: "border-amber-300 bg-amber-50",
  accepted: "border-emerald-300 bg-emerald-50",
  rejected: "border-zinc-200 bg-zinc-50 opacity-70",
  failed: "border-red-300 bg-red-50",
};

/** A change the agent proposed. Nothing is written until the user accepts. */
export default function ProposalCard({
  proposal,
  busy,
  onAccept,
  onReject,
}: {
  proposal: AgentProposal;
  busy: boolean;
  onAccept: () => void;
  onReject: () => void;
}) {
  const [title, ...details] = proposal.summary.split("\n");
  return (
    <div className={`rounded-lg border px-3 py-2 text-sm ${STATUS_STYLES[proposal.status]}`}>
      <p className="font-medium">{title}</p>
      {details.length > 0 && (
        <ul className="mt-1 space-y-0.5 font-mono text-xs text-zinc-600">
          {details.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
      {proposal.status === "pending" ? (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={onAccept}
            disabled={busy}
            className="rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
          >
            Accept
          </button>
          <button
            type="button"
            onClick={onReject}
            disabled={busy}
            className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50"
          >
            Reject
          </button>
        </div>
      ) : (
        <p className="mt-1 text-xs text-zinc-500">
          {proposal.status === "accepted" && "Applied"}
          {proposal.status === "rejected" && "Rejected"}
          {proposal.status === "failed" && `Failed: ${proposal.error}`}
        </p>
      )}
    </div>
  );
}

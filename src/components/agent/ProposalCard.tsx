"use client";

import type { AgentProposal } from "@/lib/agent-proposals";

const ACCENT: Record<AgentProposal["status"], string> = {
  pending: "border-l-amber-400",
  accepted: "border-l-emerald-500",
  rejected: "border-l-zinc-300 opacity-70",
  failed: "border-l-red-500",
};

const PILL: Record<AgentProposal["status"], [label: string, className: string]> = {
  pending: ["Pending", "bg-amber-100 text-amber-800"],
  accepted: ["Applied", "bg-emerald-100 text-emerald-800"],
  rejected: ["Rejected", "bg-zinc-100 text-zinc-600"],
  failed: ["Failed", "bg-red-100 text-red-700"],
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
  const [pillLabel, pillClass] = PILL[proposal.status];
  return (
    <div
      className={`rounded-lg border border-zinc-200 border-l-4 bg-white px-3 py-2.5 text-sm shadow-sm ${ACCENT[proposal.status]}`}
    >
      <div className="flex items-start gap-2">
        <p className="flex-1 font-medium">{title}</p>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${pillClass}`}>
          {pillLabel}
        </span>
      </div>
      {details.length > 0 && (
        <ul className="mt-1 space-y-0.5 font-mono text-xs text-zinc-600">
          {details.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
      {proposal.status === "pending" && (
        <div className="mt-2.5 flex gap-2">
          <button
            type="button"
            onClick={onAccept}
            disabled={busy}
            className="rounded-full bg-zinc-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
          >
            Accept
          </button>
          <button
            type="button"
            onClick={onReject}
            disabled={busy}
            className="rounded-full border border-zinc-300 bg-white px-3.5 py-1.5 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50"
          >
            Reject
          </button>
        </div>
      )}
      {proposal.status === "failed" && <p className="mt-1 text-xs text-red-700">{proposal.error}</p>}
    </div>
  );
}

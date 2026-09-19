export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import SuggestionsView from "@/components/agent/SuggestionsView";
import { listProposals } from "@/lib/agent-proposals";
import { requireUser } from "@/lib/dal";
import { isAgentConfigured } from "@/lib/opencode";

export default async function SuggestionsPage() {
  if (!isAgentConfigured()) notFound();
  const { id: userId } = await requireUser();
  const { pending, history } = await listProposals(userId);
  return <SuggestionsView initialPending={pending} initialHistory={history} />;
}

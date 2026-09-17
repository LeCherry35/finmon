export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { listAgentChats } from "@/actions/agent";
import AssistantView from "@/components/agent/AssistantView";
import { requireUser } from "@/lib/dal";
import { isAgentConfigured } from "@/lib/opencode";

export default async function AssistantPage() {
  if (!isAgentConfigured()) notFound();
  await requireUser();
  return <AssistantView initialChats={await listAgentChats()} />;
}

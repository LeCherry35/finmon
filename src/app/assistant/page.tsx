export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { listAgentChats } from "@/actions/agent";
import AssistantView from "@/components/agent/AssistantView";
import { agentModels } from "@/lib/agent-models";
import { requireUser } from "@/lib/dal";
import { isAgentConfigured } from "@/lib/opencode";

export default async function AssistantPage() {
  if (!isAgentConfigured()) notFound();
  await requireUser();
  const { default: defaultModel, models } = agentModels();
  return <AssistantView initialChats={await listAgentChats()} models={models} defaultModel={defaultModel} />;
}

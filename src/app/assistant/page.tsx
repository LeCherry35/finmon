export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { listAgentChats, loadAgentChat } from "@/actions/agent";
import AssistantView from "@/components/agent/AssistantView";
import { requireUser } from "@/lib/dal";
import { isAgentConfigured } from "@/lib/opencode";

export default async function AssistantPage(props: PageProps<"/assistant">) {
  if (!isAgentConfigured()) notFound();
  await requireUser();
  const sp = await props.searchParams;
  const chatId = Number(Array.isArray(sp.chat) ? sp.chat[0] : sp.chat);

  const [chats, loaded] = await Promise.all([
    listAgentChats(),
    Number.isInteger(chatId) && chatId > 0 ? loadAgentChat(chatId) : null,
  ]);

  return <AssistantView initialChats={chats} initialChat={loaded?.ok ? loaded.data : null} />;
}

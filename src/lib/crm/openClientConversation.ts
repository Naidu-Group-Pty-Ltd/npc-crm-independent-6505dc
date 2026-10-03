/**
 * Opening a conversation with a client, on a deployment with no CRM vendor.
 *
 * The server decides everything that matters — whether the caller may reach
 * this client, which channels the record can carry, and whether a thread
 * already exists — so this is one call and the server's answer, refusal
 * included, in the server's own words. Two surfaces open threads (the
 * Conversations page and a client's Conversations tab) and both use this.
 */
import { invokeSecureFunction } from "@/lib/secureInvoke";
import { crmFunction } from "@/lib/crm/crmProvider";

export interface OpenedConversation {
  readonly id: string;
  readonly ghl_conversation_id: string;
  readonly client_id: string | null;
  readonly [key: string]: unknown;
}

/**
 * Ask the server for this client's thread, creating it where none exists.
 * Throws the server's sentence, which names what to fix.
 */
export async function openClientConversation(
  clientId: string,
): Promise<{ conversation: OpenedConversation; created: boolean }> {
  const { data, error } = await invokeSecureFunction<{
    conversation?: OpenedConversation;
    created?: boolean;
    error?: string;
  }>(crmFunction("sendMessage"), { action: "open_conversation", clientId });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  if (!data?.conversation?.id) {
    throw new Error("The conversation could not be opened.");
  }
  return { conversation: data.conversation, created: Boolean(data.created) };
}

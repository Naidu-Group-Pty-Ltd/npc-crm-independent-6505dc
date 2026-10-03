// OPENING A NATIVE CONVERSATION FROM THE OPERATOR'S SIDE.
//
// `crm-send-message` answers `action: 'open_conversation'` through this module
// so the send path's orderings — asserted against its source by
// `nativeSendPath.contract.test.ts` — are not disturbed by a second job living
// inline beside them.
//
// Four rules:
//
// **The caller must already be allowed to message clients.** This runs after
// `crm-send-message`'s permission check, and asks the same ownership question
// the send path asks, answered 404 in the same words, so a client somebody may
// not reach cannot be told apart from one that does not exist.
//
// **One thread per client, whichever end opened it.** A conversation already
// filed under the client's key, or already linked to the client, is returned
// rather than duplicated — an operator who opens a thread twice, or opens one
// a client already started by texting in, lands in the same place.
//
// **A client nobody can reach gets no thread.** With no usable mobile and no
// email there is no channel to speak on, and an empty thread with a composer
// that cannot send is a dead control. The refusal names the record, which the
// operator can fix.
//
// **A race resolves to the thread that won.** Two operators opening the same
// client at once both try to insert one key; `uq_ghl_conversation` refuses the
// second, and the second reads the first's row back.
import {
  australianMobileToE164,
  nativeConversationKey,
  reachableChannels,
} from "./nativeConversation.pure.ts";

/** The columns the Conversations page reads for a thread. */
const CONVERSATION_COLUMNS =
  "id, client_id, ghl_conversation_id, ghl_contact_id, channel_type, last_message_body, " +
  "last_message_date, last_message_direction, unread_count, conversation_status, available_channels";

const NOT_FOUND =
  "Client not found, or you no longer have access to their record.";

export type OpenConversationResult =
  | {
      readonly ok: true;
      readonly created: boolean;
      readonly conversation: Record<string, unknown>;
    }
  | { readonly ok: false; readonly status: number; readonly error: string };

// deno-lint-ignore no-explicit-any
type Client = any;

export async function openNativeConversation(
  supabase: Client,
  input: {
    readonly clientId: string;
    readonly userId: string;
    readonly superadmin: boolean;
  },
): Promise<OpenConversationResult> {
  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id, primary_mobile, primary_email, created_by, assigned_team_user_id")
    .eq("id", input.clientId)
    .maybeSingle();
  // A read that FAILED is not a client that is ABSENT: one is worth retrying.
  if (clientError) {
    return {
      ok: false,
      status: 503,
      error: "The client record could not be read. Please try again.",
    };
  }
  if (!client) return { ok: false, status: 404, error: NOT_FOUND };
  if (
    !input.superadmin &&
    client.created_by !== input.userId &&
    client.assigned_team_user_id !== input.userId
  ) {
    return { ok: false, status: 404, error: NOT_FOUND };
  }

  const mobile = australianMobileToE164(client.primary_mobile);
  const channels = reachableChannels({
    mobileE164: mobile,
    email: client.primary_email,
  });
  if (channels.length === 0) {
    return {
      ok: false,
      status: 422,
      error:
        "This client has no usable mobile number or email address recorded, so there is no channel " +
        "to open a conversation on. Add one to the client's record first.",
    };
  }

  const key = nativeConversationKey({ mobileE164: mobile, clientId: client.id });

  const byKey = await supabase
    .from("ghl_conversations")
    .select(CONVERSATION_COLUMNS)
    .eq("ghl_conversation_id", key)
    .maybeSingle();
  if (byKey.error) {
    return { ok: false, status: 503, error: "Conversations could not be read. Please try again." };
  }

  let existing = byKey.data;
  if (!existing) {
    // A thread already linked to the client under another key: the one an
    // inbound SMS opened before the record held this number, or one filed by
    // client id before a mobile was added.
    const byClient = await supabase
      .from("ghl_conversations")
      .select(CONVERSATION_COLUMNS)
      .eq("client_id", client.id)
      .order("last_message_date", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (byClient.error) {
      return { ok: false, status: 503, error: "Conversations could not be read. Please try again." };
    }
    existing = byClient.data;
  }

  if (existing) {
    // A thread keyed by number but opened before the client was known carries
    // no client; link it now that an operator has named whose it is. And make
    // sure the composer offers every channel the record can be reached on.
    const known = Array.isArray(existing.available_channels)
      ? (existing.available_channels as string[])
      : [];
    const merged = [...new Set([...known, ...channels])];
    const patch: Record<string, unknown> = {};
    if (!existing.client_id) patch.client_id = client.id;
    if (merged.length !== known.length) patch.available_channels = merged;
    if (Object.keys(patch).length > 0) {
      const { error: patchError } = await supabase
        .from("ghl_conversations")
        .update(patch)
        .eq("id", existing.id);
      if (patchError) {
        console.error("[openNativeConversation] could not update thread:", patchError.message);
      } else {
        existing = { ...existing, ...patch };
      }
    }
    return { ok: true, created: false, conversation: existing };
  }

  const inserted = await supabase
    .from("ghl_conversations")
    .insert({
      ghl_conversation_id: key,
      client_id: client.id,
      channel_type: channels[0],
      conversation_status: "open",
      available_channels: channels,
      unread_count: 0,
    })
    .select(CONVERSATION_COLUMNS)
    .single();

  if (inserted.error) {
    if (inserted.error.code === "23505") {
      const raced = await supabase
        .from("ghl_conversations")
        .select(CONVERSATION_COLUMNS)
        .eq("ghl_conversation_id", key)
        .maybeSingle();
      if (raced.data) return { ok: true, created: false, conversation: raced.data };
    }
    console.error("[openNativeConversation] insert failed:", inserted.error.message);
    return { ok: false, status: 500, error: "The conversation could not be opened." };
  }
  return { ok: true, created: true, conversation: inserted.data };
}

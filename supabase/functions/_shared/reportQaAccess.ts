// WP-07 — Central Report Q&A access resolver.
//
// Every report-qa action (load, chat, update, delete, summarize, export,
// share, revoke, memory) must route ownership through this helper so we
// answer one authoritative question: given an actor and a conversation,
// what can they do?  The DB is scoped directly — never "select all then
// filter in JS".

export type ReportQaRole =
  | "owner"
  | "collaborate"
  | "view"
  | "admin"
  | "denied";

export interface ReportQaAccess {
  role: ReportQaRole;
  conversation: {
    id: string;
    created_by: string | null;
    client_id: string | null;
    title: string | null;
  } | null;
  /** Share row used to grant access, if any. */
  share: { permission: string; shared_with: string } | null;
}

export interface ResolveOptions {
  actorId: string | null;
  isSuperadmin?: boolean;
  conversationId: string;
}

/**
 * Resolve the caller's effective access on a Q&A conversation.
 *
 * - Superadmin → `admin` (audited override; caller is responsible for logging).
 * - Owner (created_by = actor) → `owner`.
 * - Active share row where shared_with = actor:
 *     - permission='collaborate' → `collaborate`
 *     - any other value → `view`
 * - Otherwise → `denied` (and `conversation` is returned null to avoid leaking).
 */
export async function resolveReportQaAccess(
  supabase: any,
  { actorId, isSuperadmin, conversationId }: ResolveOptions,
): Promise<ReportQaAccess> {
  if (!conversationId) {
    return { role: "denied", conversation: null, share: null };
  }

  const { data: conv, error } = await supabase
    .from("report_qa_conversations")
    .select("id, created_by, client_id, title")
    .eq("id", conversationId)
    .maybeSingle();

  if (error || !conv) {
    return { role: "denied", conversation: null, share: null };
  }

  if (isSuperadmin) {
    return { role: "admin", conversation: conv, share: null };
  }

  if (actorId && conv.created_by === actorId) {
    return { role: "owner", conversation: conv, share: null };
  }

  if (actorId) {
    const { data: share } = await supabase
      .from("report_qa_conversation_shares")
      .select("permission, shared_with, is_active")
      .eq("conversation_id", conversationId)
      .eq("shared_with", actorId)
      .eq("is_active", true)
      .maybeSingle();

    if (share) {
      const role: ReportQaRole =
        share.permission === "collaborate" ? "collaborate" : "view";
      return {
        role,
        conversation: conv,
        share: { permission: share.permission, shared_with: share.shared_with },
      };
    }
  }

  // Deny: return null conversation so the caller cannot leak metadata.
  return { role: "denied", conversation: null, share: null };
}

/** True if the role may read the conversation and its messages. */
export function canRead(role: ReportQaRole): boolean {
  return role === "owner" || role === "collaborate" || role === "view" || role === "admin";
}

/** True if the role may append messages / mutate content-in-thread. */
export function canWrite(role: ReportQaRole): boolean {
  return role === "owner" || role === "collaborate" || role === "admin";
}

/** True if the role may reshape sharing (share, revoke, delete, rename). */
export function canAdminister(role: ReportQaRole): boolean {
  return role === "owner" || role === "admin";
}

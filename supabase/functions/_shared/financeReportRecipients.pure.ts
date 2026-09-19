/**
 * Who may receive a report through the Finance Portal, decided once.
 *
 * ## Why this is its own module
 *
 * `share-report-with-finance` has always been strict about the recipient: a
 * finance contact is a portal identity, not an email address, so a share is
 * refused unless the contact is active, has an un-revoked portal user, is
 * *assigned* to that client, and holds document-view permission for it. Four
 * conditions, all checked at the moment of sending.
 *
 * Nothing offered that answer *before* sending. The Command Centre menus named
 * a recipient by taking the first row of `finance_agent_contacts` ordered by
 * `is_default` — and in production no contact has ever been flagged default, so
 * "first row" meant insertion order. The partner that named produced has no
 * portal account at all: every send to it was refused at the third condition,
 * after the document had been rendered, and the menu had said its name with
 * complete confidence.
 *
 * So the picker has to state eligibility, which means the picker and the send
 * path have to agree about it. They agree here: `evaluateRecipient` is the only
 * statement of the rules, `share-report-with-finance` calls it for the listing
 * *and* for the send it performs, and a rule that changes changes for both.
 *
 * Pure by design — no imports, no Deno globals — so the repo's vitest suite can
 * exercise the rules without a database, and so an edge function can import it
 * under Deno unchanged.
 */

/** Why a partner cannot receive this client's report. `null` when they can. */
export type RecipientBlockReason =
  | "contact_inactive"
  | "no_portal_account"
  | "portal_account_revoked"
  | "not_assigned_to_client"
  | "documents_not_permitted";

/** The shape each condition is judged against. All fields may be absent. */
export interface RecipientInputs {
  contact: { id: string; is_active?: boolean | null } | null | undefined;
  portalUser:
    | {
        id: string;
        is_active?: boolean | null;
        revoked_at?: string | null;
        global_permissions?: unknown;
      }
    | null
    | undefined;
  assignment: { id: string; permissions?: unknown } | null | undefined;
}

export interface RecipientVerdict {
  eligible: boolean;
  reason: RecipientBlockReason | null;
  /** Set whenever a portal account exists, eligible or not. */
  portalUserId: string | null;
}

/**
 * Effective document visibility = OR-merge(global baseline, per-client matrix).
 *
 * `documents` is default-allow when **both** sides omit it, which matches
 * `finance-portal-document-requirements` and `finance-portal-client-tasks`. A
 * partner assigned before the permission matrix existed carries no `documents`
 * key on either side and has always been able to read documents in the portal;
 * reading the omission as a denial here would have hidden them from a picker
 * that the send path would then have accepted.
 */
export function canViewDocuments(globalPermissions: unknown, perClientPermissions: unknown): boolean {
  const global = (globalPermissions ?? {}) as Record<string, { view?: boolean } | undefined>;
  const perClient = (perClientPermissions ?? {}) as Record<string, { view?: boolean } | undefined>;
  const globalDocs = global?.documents;
  const clientDocs = perClient?.documents;
  if (!globalDocs && !clientDocs) return true;
  return !!globalDocs?.view || !!clientDocs?.view;
}

/**
 * The four conditions, in the order the send path reports them.
 *
 * Order is load-bearing for what a person reads: a partner with no portal
 * account and no assignment is missing the *account* first, and telling them to
 * assign a client to an account that does not exist sends them to the wrong
 * screen.
 */
export function evaluateRecipient(inputs: RecipientInputs): RecipientVerdict {
  const portalUserId = inputs.portalUser?.id ?? null;

  if (!inputs.contact?.is_active) {
    return { eligible: false, reason: "contact_inactive", portalUserId };
  }
  if (!inputs.portalUser) {
    return { eligible: false, reason: "no_portal_account", portalUserId: null };
  }
  if (!inputs.portalUser.is_active || inputs.portalUser.revoked_at) {
    return { eligible: false, reason: "portal_account_revoked", portalUserId };
  }
  if (!inputs.assignment) {
    return { eligible: false, reason: "not_assigned_to_client", portalUserId };
  }
  if (!canViewDocuments(inputs.portalUser.global_permissions, inputs.assignment.permissions)) {
    return { eligible: false, reason: "documents_not_permitted", portalUserId };
  }
  return { eligible: true, reason: null, portalUserId };
}

/**
 * The sentence the refusal is shown as — one wording for the picker's row and
 * for the error a send returns, so a person cannot be told two different things
 * about the same partner.
 */
export function recipientBlockMessage(reason: RecipientBlockReason): string {
  switch (reason) {
    case "contact_inactive":
      return "This Finance Partner is inactive.";
    case "no_portal_account":
      return "This Finance Partner does not have a Finance Portal account yet.";
    case "portal_account_revoked":
      return "This Finance Partner's Finance Portal access has been revoked.";
    case "not_assigned_to_client":
      return "This Finance Partner is not assigned to this client.";
    case "documents_not_permitted":
      return "This Finance Partner is not permitted to view this client's documents.";
  }
}

/** The HTTP status the send path answers a refusal with. */
export function recipientBlockStatus(reason: RecipientBlockReason): number {
  // A missing portal account is a state of the world to be fixed, not a
  // permission failure — 422 keeps it distinguishable from an authorisation
  // refusal in the logs, which is how it was answered before this module.
  return reason === "no_portal_account" || reason === "portal_account_revoked" ? 422 : 403;
}

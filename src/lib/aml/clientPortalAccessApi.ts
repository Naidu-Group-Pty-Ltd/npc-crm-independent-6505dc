import { invokeSecureFunction } from "@/lib/secureInvoke";
import type { AmlPortalAccessFacts } from "@/lib/aml/portalAccessState";

/**
 * Client Portal access, from the Command Centre.
 *
 * ── This adds no server capability ────────────────────────────────────
 * `client-portal-invite` already does all of it, and has for a long time:
 * `check_status`, sending an invitation, `resend_invite`, and `revoke`. It
 * holds one `client_portal_users` row per client (`.maybeSingle()` on
 * `client_id`), refuses a second invite for an already-active account with
 * a 409 unless resend is explicit, mints a 48-hour token, and emails the
 * link through Resend with the brand config.
 *
 * What was missing was never the endpoint — it was that nothing in the AML
 * workspace ever asked it anything. Activating a client wrote a portal
 * notification deep-linking `/client/aml` and left it at that, so on this
 * deployment AML-2026-00005 was activated, notified at 15:41, and has no
 * portal account at all: the notification is sitting in a portal the client
 * cannot reach.
 *
 * So this file READS ONLY. Issuing is left to `SendPortalInviteDialog`, which
 * already owns the whole of it — status, send, resend, copy-link and revoke —
 * and is a self-contained `{clientId, clientName, clientEmail}` component.
 * Adding an AML-side invite call would be a second set of semantics to keep
 * in step with it, over a table whose `UNIQUE(client_id)` means there is only
 * ever one account to get wrong.
 */

interface PortalUserRow {
  id: string;
  email: string | null;
  status: string | null;
  created_at: string | null;
  last_login_at: string | null;
  invite_expires_at: string | null;
  has_completed_onboarding: boolean | null;
  has_accepted_terms: boolean | null;
  terms_accepted_at: string | null;
}

const invoke = <T>(body: Record<string, unknown>) =>
  invokeSecureFunction<T>("client-portal-invite", body, { timeoutMs: 20000 });

/**
 * Read the client's portal account.
 *
 * `null` means the read did not answer — never "there is no account".
 * `deriveAmlPortalAccess` renders that as `unavailable`, because offering to
 * issue access on an unknown state is how a client who already has a login
 * gets a second invitation.
 */
export async function readClientPortalAccess(
  clientId: string,
  /**
   * The client's address, when the caller happens to know it. Leave it
   * `undefined` when it was not read — that is reported as "not known" and
   * offers the invitation anyway, rather than refusing one that would work.
   */
  clientEmail?: string | null,
): Promise<AmlPortalAccessFacts | null> {
  const { data, error } = await invoke<{
    success?: boolean;
    portal_user?: PortalUserRow | null;
  }>({ action: "check_status", client_id: clientId });

  if (error || !data?.success) return null;

  const row = data.portal_user ?? null;
  if (!row) {
    return { exists: false, email: clientEmail };
  }

  // `invite_token` is deliberately not returned by the server, so expiry is
  // read from the timestamp beside it. An invited row with no expiry has
  // nothing to measure and is treated as pending rather than expired —
  // guessing "expired" would push an operator to re-send a live invitation.
  const expiresAt = row.invite_expires_at;
  const invited = row.status === "invited";
  const expired = invited && Boolean(expiresAt) && new Date(expiresAt!).getTime() < Date.now();

  return {
    exists: true,
    status: row.status,
    invitePending: invited && !expired,
    inviteExpired: expired,
    inviteExpiresAt: expiresAt,
    lastLoginAt: row.last_login_at,
    hasAcceptedTerms: Boolean(row.has_accepted_terms),
    email: row.email ?? clientEmail,
  };
}

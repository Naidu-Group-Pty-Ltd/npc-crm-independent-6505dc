/**
 * The email that tells the activating Command Centre user their builder
 * acknowledged the activation (docs/builder-portal/52). Queued ONCE, by the
 * acknowledgement step, carrying only which activation it is about; the rest
 * is read here, at send time, and nothing about the client is read at all.
 *
 * Exactly once is the ledger's job, and the ledger is a LEASE, never a stamp
 * written ahead of the send. The job claims the email (a token that expires),
 * sends, and only then records it as sent — and only while it still holds the
 * token. So:
 *
 * - a claim that cannot be made throws with nothing sent (the outbox retries);
 * - a claim another worker holds DEFERS the job (`in_progress`) until its
 *   lease ends: the outbox offers it again then, and a deferral never spends
 *   the retry budget or dead-letters (`outboxDeferral.pure.ts`);
 * - a send that fails or throws releases the claim and throws, so the retry
 *   can send it;
 * - a worker that dies between claiming and recording leaves a lease that
 *   runs out, and the next retry takes it over and sends;
 * - a send whose record cannot be written throws, and the retry that follows
 *   sends under the SAME provider idempotency key, so the provider delivers
 *   it once.
 *
 * `send` is the existing portal email helper, injected so the rule can be
 * tested without a mail service.
 */
import { acknowledgementEmail, userDisplayName } from './privateConversations.pure.ts';
import { OutboxDeferral } from '../outboxDeferral.pure.ts';

type Db = any;
type Send = (input: {
  to: string; clientFirstName: string; title: string; message: string;
  type: 'success'; category: 'property'; actionUrl: string; idempotencyKey: string;
}) => Promise<{ success: boolean; error?: unknown }>;

/** How long a claim stands before a retry may take it over (the outbox backs off past it). */
export const ACKNOWLEDGEMENT_EMAIL_LEASE_SECONDS = 600;

export async function sendActivationAcknowledgedEmail(db: Db, event: { payload?: { selection_id?: unknown } }, send: Send) {
  const selectionId = String(event.payload?.selection_id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(selectionId)) return;
  const { data: notice, error: noticeError } = await db.from('builder_network_acknowledgement_notices')
    .select('email_sent_at, outcome').eq('selection_id', selectionId).maybeSingle();
  if (noticeError) throw new Error('acknowledgement_notice_unreadable');
  if (!notice || notice.outcome !== 'notified' || notice.email_sent_at) return;
  const { data: selection, error: selectionError } = await db.from('builder_stock_selections')
    .select('selected_by_user_id, stock_item_id, organisation_id, acknowledged_by_display_name')
    .eq('id', selectionId).maybeSingle();
  if (selectionError) throw new Error('activation_unreadable');
  if (!selection) return;
  const [{ data: user, error: userError }, { data: item, error: itemError }, { data: org, error: orgError }] = await Promise.all([
    db.from('custom_users').select('email, first_name, last_name, username, is_active, deleted_at')
      .eq('id', selection.selected_by_user_id).maybeSingle(),
    db.from('builder_network_stock_items').select('address_line, lot_number').eq('id', selection.stock_item_id).maybeSingle(),
    db.from('builder_network_stock_organisations').select('legal_name, trading_name').eq('id', selection.organisation_id).maybeSingle(),
  ]);
  // A read that failed is not an absent user or a nameless builder: throw, and
  // the outbox's backoff asks again rather than marking the job done.
  if (userError || itemError || orgError) throw new Error('acknowledgement_email_facts_unreadable');
  if (!user || !user.is_active || user.deleted_at || !user.email) return;
  const email = acknowledgementEmail({
    builderName: (typeof org?.trading_name === 'string' && org.trading_name.trim()) || org?.legal_name || 'The builder',
    address: item?.address_line ?? '',
    lotNumber: item?.lot_number ?? null,
    acknowledgedBy: selection.acknowledged_by_display_name ?? null,
    link: null,
  });

  // Lease the send before making it.
  const { data: claim, error: claimError } = await db.rpc('builder_network_claim_acknowledgement_email', {
    _selection_id: selectionId, _lease_seconds: ACKNOWLEDGEMENT_EMAIL_LEASE_SECONDS,
  });
  if (claimError || !claim || typeof claim.state !== 'string') throw new Error('acknowledgement_email_claim_failed');
  // Held by a worker that has not finished or has died: offered again when
  // its lease ends, without spending the outbox's retry budget.
  if (claim.state === 'held') throw new OutboxDeferral('acknowledgement_email_in_progress', String(claim.until ?? ''));
  if (claim.state !== 'claimed' || typeof claim.token !== 'string') return;
  const token = claim.token;

  const release = async (reason: string) => {
    const { error: releaseError } = await db.rpc('builder_network_settle_acknowledgement_email', {
      _selection_id: selectionId, _token: token, _sent: false,
    });
    if (releaseError) throw new Error('acknowledgement_email_not_sent_and_claim_not_released');
    throw new Error(`acknowledgement_email_not_sent:${reason.slice(0, 80)}`);
  };

  let sent: { success: boolean; error?: unknown };
  try {
    sent = await send({
      to: String(user.email),
      clientFirstName: (typeof user.first_name === 'string' && user.first_name.trim()) || userDisplayName(user) || 'there',
      title: email.title,
      message: email.html,
      type: 'success',
      category: 'property',
      actionUrl: '/admin/builder-portal/activated',
      idempotencyKey: `builder-activation-acknowledged/${selectionId}`,
    });
  } catch (err) {
    return release(err instanceof Error ? err.message : String(err));
  }
  if (!sent.success) return release(String(sent.error ?? 'unknown'));

  const { data: recorded, error: settleError } = await db.rpc('builder_network_settle_acknowledgement_email', {
    _selection_id: selectionId, _token: token, _sent: true,
  });
  if (settleError || recorded !== true) throw new Error('acknowledgement_email_sent_not_recorded');
}

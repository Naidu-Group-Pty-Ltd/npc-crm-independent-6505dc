/**
 * Loan writer undertakings (Annexure B) — shared gate (Phase 3).
 *
 * A referral may only be assigned to an individual loan writer / authorised
 * representative who has a live, signed undertaking. The undertaking is the
 * only thing that binds the individual (as opposed to their licensee) to the
 * information-boundary and conduct obligations, so assignment without one is a
 * compliance failure, not a data-entry omission.
 */

export const UNDERTAKING_TABLE = 'partner_loan_writer_undertakings';

export type UndertakingStatus = 'draft' | 'pending_signature' | 'active' | 'expired' | 'terminated';

export interface UndertakingRow {
  id: string;
  reference: string;
  status: UndertakingStatus;
  writer_full_name: string;
  finance_user_id: string | null;
  finance_agent_contact_id: string | null;
  effective_date: string | null;
  expiry_date: string | null;
  authorisation_end_date: string | null;
  signed_at: string | null;
  [key: string]: unknown;
}

function dayPassed(date: string | null): boolean {
  if (!date) return false;
  const end = new Date(`${date}T23:59:59.999Z`).getTime();
  return Number.isFinite(end) && end < Date.now();
}

/** True when the undertaking is signed, active, in date and not terminated. */
export function isUndertakingLive(row: UndertakingRow | null | undefined): boolean {
  if (!row) return false;
  if (row.status !== 'active') return false;
  if (!row.signed_at) return false;
  if (row.effective_date && new Date(`${row.effective_date}T00:00:00.000Z`).getTime() > Date.now()) return false;
  if (dayPassed(row.expiry_date)) return false;
  if (dayPassed(row.authorisation_end_date)) return false;
  return true;
}

/**
 * Flip any active undertaking that has run past its expiry or authorisation end
 * date to `expired`. Lazy on read — a cron would be a second source of truth for
 * a state that is fully derivable from two dates.
 */
export async function expireLapsedUndertakings(supabase: any): Promise<number> {
  const { data } = await supabase
    .from(UNDERTAKING_TABLE)
    .select('id, expiry_date, authorisation_end_date')
    .eq('status', 'active');

  const lapsed = (data ?? [])
    .filter((r: any) => dayPassed(r.expiry_date) || dayPassed(r.authorisation_end_date))
    .map((r: any) => r.id);

  if (lapsed.length === 0) return 0;
  await supabase.from(UNDERTAKING_TABLE).update({ status: 'expired' }).in('id', lapsed);
  return lapsed.length;
}

export interface UndertakingLookup {
  undertakingId?: string | null;
  financeUserId?: string | null;
  financeAgentContactId?: string | null;
  agreementId?: string | null;
}

/** Find the undertaking that would authorise this assignment, if any. */
export async function findUndertaking(
  supabase: any,
  lookup: UndertakingLookup,
): Promise<UndertakingRow | null> {
  if (lookup.undertakingId) {
    const { data } = await supabase
      .from(UNDERTAKING_TABLE).select('*').eq('id', lookup.undertakingId).maybeSingle();
    return (data as UndertakingRow) ?? null;
  }

  let query = supabase
    .from(UNDERTAKING_TABLE).select('*')
    .eq('status', 'active')
    .order('signed_at', { ascending: false })
    .limit(5);

  if (lookup.financeUserId) query = query.eq('finance_user_id', lookup.financeUserId);
  else if (lookup.financeAgentContactId) query = query.eq('finance_agent_contact_id', lookup.financeAgentContactId);
  else return null;

  const { data } = await query;
  const live = (data ?? []).find((row: UndertakingRow) => isUndertakingLive(row));
  return (live as UndertakingRow) ?? null;
}

export interface AssignmentGateResult {
  ok: boolean;
  undertaking: UndertakingRow | null;
  error?: string;
  message?: string;
}

/**
 * Gate a loan-writer assignment. Only outbound finance referrals are gated —
 * an inbound referral is assigned to an NPC consultant, who is bound by
 * employment rather than by an undertaking.
 */
export async function gateLoanWriterAssignment(
  supabase: any,
  params: {
    direction: string;
    financeUserId?: string | null;
    financeAgentContactId?: string | null;
    undertakingId?: string | null;
  },
): Promise<AssignmentGateResult> {
  if (params.direction !== 'outbound_finance_referral') return { ok: true, undertaking: null };
  if (!params.financeUserId && !params.undertakingId) return { ok: true, undertaking: null };

  await expireLapsedUndertakings(supabase);

  const undertaking = await findUndertaking(supabase, {
    undertakingId: params.undertakingId,
    financeUserId: params.financeUserId,
    financeAgentContactId: params.financeAgentContactId,
  });

  if (!undertaking) {
    return {
      ok: false,
      undertaking: null,
      error: 'undertaking_required',
      message: 'This loan writer has no signed, active undertaking (Annexure B). Record and activate one before assigning the referral.',
    };
  }

  if (!isUndertakingLive(undertaking)) {
    return {
      ok: false,
      undertaking,
      error: 'undertaking_not_live',
      message: `Undertaking ${undertaking.reference} is ${undertaking.status}. Only a signed, in-date undertaking can receive a referral.`,
    };
  }

  return { ok: true, undertaking };
}

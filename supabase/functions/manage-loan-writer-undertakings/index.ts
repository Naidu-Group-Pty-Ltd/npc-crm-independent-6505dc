/**
 * Loan Writer Undertakings (Annexure B) — Phase 3
 *
 * Command Centre staff maintain the register; finance partners may read their
 * own undertakings over the portal transport. The undertaking is what makes an
 * individual loan writer assignable, so activation requires a signature record.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
import { extractFinanceToken, resolveFinancePartner } from '../_shared/finance-portal-session.ts';
import { internalError } from '../_shared/errorResponse.ts';
import {
  UNDERTAKING_TABLE,
  expireLapsedUndertakings,
  isUndertakingLive,
} from '../_shared/loanWriterUndertakings.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const EVENTS_TABLE = 'partner_referral_events';

const WRITABLE = [
  'agreement_id', 'finance_agent_contact_id', 'finance_user_id',
  'writer_full_name', 'writer_email', 'writer_phone', 'writer_entity_name',
  'licensee_name', 'acl_number', 'crn', 'authorisation_end_date',
  'effective_date', 'expiry_date', 'notes',
] as const;

const DATE_FIELDS = new Set(['authorisation_end_date', 'effective_date', 'expiry_date']);

const TRANSITIONS: Record<string, string[]> = {
  draft: ['pending_signature', 'terminated'],
  pending_signature: ['active', 'draft', 'terminated'],
  active: ['expired', 'terminated'],
  expired: ['terminated'],
  terminated: [],
};

function json(body: unknown, corsHeaders: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * Copy only the columns in `WRITABLE`, normalising blanks and dates.
 *
 * Named for what it does rather than `sanitize`, which said that something had
 * been cleaned without saying against what. The distinction matters here: this
 * is an allowlist, so a column added to the table is not writable until it is
 * added above — and a reader at the call site can now see that.
 */
function pickWritable(input: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const key of WRITABLE) {
    if (!(key in input)) continue;
    let value = input[key as string];
    if (value === '' || value === undefined) value = null;
    if (value !== null && DATE_FIELDS.has(key)) value = String(value).slice(0, 10);
    out[key] = value;
  }
  return out;
}

async function nextReference(supabase: any): Promise<string> {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const { count } = await supabase.from(UNDERTAKING_TABLE).select('id', { count: 'exact', head: true });
  return `LWU-${day}-${String((count ?? 0) + 1).padStart(4, '0')}`;
}

/** Undertaking activity is written to the referral event log where a referral is in play. */
async function logGlobalEvent(supabase: any, summary: string, payload: Record<string, unknown>) {
  const referralId = payload.referral_id as string | undefined;
  if (!referralId) return;
  await supabase.from(EVENTS_TABLE).insert({
    referral_id: referralId,
    event_type: 'undertaking',
    summary,
    payload,
  });
}

function decorate(row: Record<string, unknown>) {
  return { ...row, is_live: isUndertakingLive(row as any) };
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  // CORS-CONTRACT: no hand-rolled `Access-Control-Allow-Headers` here.
  // `createCorsHeaders` already answers the canonical
  // `CORS_ALLOWED_REQUEST_HEADERS` list. A local literal can only ever be a
  // stale snapshot of it, and because it overrides the spread it silently
  // NARROWS the allowlist — the preflight then fails for any header added to
  // the canonical list later (this one had already fallen behind on
  // `x-step-up-token`), surfacing as an opaque "Failed to fetch".
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body = await req.json();
    const { action } = body ?? {};

    const financeToken = extractFinanceToken(req.headers, body);

    // ── Finance partner surface: own undertakings, read-only ──
    if (financeToken) {
      const resolved = await resolveFinancePartner(supabase, financeToken);
      if ((resolved as any).error) {
        return json({ error: (resolved as any).error }, corsHeaders, (resolved as any).status ?? 401);
      }
      const portalUser = (resolved as any).portalUser;
      if (action !== 'partner_list') return json({ error: 'unknown_action' }, corsHeaders, 400);

      await expireLapsedUndertakings(supabase);
      const { data, error } = await supabase
        .from(UNDERTAKING_TABLE)
        .select('id, reference, status, writer_full_name, writer_entity_name, licensee_name, acl_number, crn, effective_date, expiry_date, authorisation_end_date, signed_at, created_at')
        .or(`finance_user_id.eq.${portalUser.id},finance_agent_contact_id.eq.${portalUser.finance_contact_id ?? portalUser.id}`)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return json({ undertakings: (data ?? []).map(decorate) }, corsHeaders);
    }

    // ── Command Centre surface ──
    const csrf = enforceCsrf(req);
    if (!csrf.ok) return csrfDenied(corsHeaders, csrf);

    const authResult = await verifyAuth(supabase, req.headers, body);
    if (authResult.error) return createUnauthorizedResponse(authResult.error, corsHeaders);
    const actorId = authResult.userId ?? null;

    if (action === 'list') {
      await expireLapsedUndertakings(supabase);
      let query = supabase.from(UNDERTAKING_TABLE).select('*').order('created_at', { ascending: false }).limit(500);
      if (body.status) query = query.eq('status', body.status);
      if (body.agreement_id) query = query.eq('agreement_id', body.agreement_id);
      if (body.finance_user_id) query = query.eq('finance_user_id', body.finance_user_id);
      const { data, error } = await query;
      if (error) throw error;
      return json({ undertakings: (data ?? []).map(decorate) }, corsHeaders);
    }

    if (action === 'get') {
      const { id } = body;
      if (!id) return json({ error: 'id_required' }, corsHeaders, 400);
      const { data } = await supabase.from(UNDERTAKING_TABLE).select('*').eq('id', id).maybeSingle();
      if (!data) return json({ error: 'not_found' }, corsHeaders, 404);

      const { data: referrals } = await supabase
        .from('partner_referrals')
        .select('id, reference, status, client_first_name, client_surname, created_at')
        .eq('loan_writer_undertaking_id', id)
        .order('created_at', { ascending: false })
        .limit(100);

      return json({ undertaking: decorate(data), referrals: referrals ?? [] }, corsHeaders);
    }

    if (action === 'create') {
      const payload = pickWritable(body);
      if (!payload.writer_full_name) return json({ error: 'writer_full_name_required' }, corsHeaders, 400);

      const reference = await nextReference(supabase);
      const { data, error } = await supabase
        .from(UNDERTAKING_TABLE)
        .insert({ ...payload, reference, status: 'draft', created_by: actorId, updated_by: actorId })
        .select().single();
      if (error) throw error;
      return json({ undertaking: decorate(data) }, corsHeaders);
    }

    if (action === 'update') {
      const { id } = body;
      if (!id) return json({ error: 'id_required' }, corsHeaders, 400);
      const { data: existing } = await supabase.from(UNDERTAKING_TABLE).select('*').eq('id', id).maybeSingle();
      if (!existing) return json({ error: 'not_found' }, corsHeaders, 404);
      if (['terminated'].includes(existing.status)) {
        return json({ error: 'undertaking_closed', message: 'Terminated undertakings are read-only. Create a replacement.' }, corsHeaders, 409);
      }

      const { data, error } = await supabase
        .from(UNDERTAKING_TABLE)
        .update({ ...pickWritable(body), updated_by: actorId })
        .eq('id', id).select().single();
      if (error) throw error;
      return json({ undertaking: decorate(data) }, corsHeaders);
    }

    /** Record the signature. Activation is impossible without one. */
    if (action === 'record_signature') {
      const { id, signed_by_name, signature_method, signature_artefact_path, envelope_id, signed_at } = body;
      if (!id) return json({ error: 'id_required' }, corsHeaders, 400);
      if (!signed_by_name) return json({ error: 'signed_by_name_required' }, corsHeaders, 400);

      const { data, error } = await supabase
        .from(UNDERTAKING_TABLE)
        .update({
          signed_by_name,
          signature_method: signature_method ?? 'wet_or_typed',
          signature_artefact_path: signature_artefact_path ?? null,
          envelope_id: envelope_id ?? null,
          signed_at: signed_at ?? new Date().toISOString(),
          updated_by: actorId,
        })
        .eq('id', id).select().single();
      if (error) throw error;
      return json({ undertaking: decorate(data) }, corsHeaders);
    }

    if (action === 'transition') {
      const { id, status: nextStatus, reason } = body;
      if (!id) return json({ error: 'id_required' }, corsHeaders, 400);
      const { data: existing } = await supabase.from(UNDERTAKING_TABLE).select('*').eq('id', id).maybeSingle();
      if (!existing) return json({ error: 'not_found' }, corsHeaders, 404);

      const allowed = TRANSITIONS[existing.status] ?? [];
      if (!allowed.includes(nextStatus)) {
        return json({
          error: 'transition_not_allowed',
          message: `Cannot move an undertaking from "${existing.status}" to "${nextStatus}".`,
        }, corsHeaders, 409);
      }

      if (nextStatus === 'active') {
        const missing: string[] = [];
        if (!existing.signed_at) missing.push('Signature');
        if (!existing.effective_date) missing.push('Effective date');
        if (!existing.licensee_name) missing.push('Licensee / ACL holder');
        if (!existing.acl_number && !existing.crn) missing.push('ACL or credit representative number');
        if (missing.length > 0) {
          return json({
            error: 'activation_gate',
            message: `Complete the undertaking before activating: ${missing.join(', ')}.`,
            missing,
          }, corsHeaders, 422);
        }
      }

      const patch: Record<string, unknown> = { status: nextStatus, updated_by: actorId };
      if (nextStatus === 'terminated') {
        patch.terminated_at = new Date().toISOString();
        patch.termination_reason = reason ?? null;
      }

      const { data, error } = await supabase
        .from(UNDERTAKING_TABLE).update(patch).eq('id', id).select().single();
      if (error) throw error;

      // Terminating pulls the authority out from under any open assignment.
      if (nextStatus === 'terminated' || nextStatus === 'expired') {
        const { data: affected } = await supabase
          .from('partner_referrals')
          .select('id')
          .eq('loan_writer_undertaking_id', id)
          .not('status', 'in', '("settled","declined","withdrawn")');
        for (const row of affected ?? []) {
          await logGlobalEvent(supabase, `Loan writer undertaking ${existing.reference} became ${nextStatus}`, {
            referral_id: row.id, undertaking_id: id, status: nextStatus, reason: reason ?? null,
          });
        }
      }

      return json({ undertaking: decorate(data) }, corsHeaders);
    }

    if (action === 'delete_draft') {
      const { id } = body;
      if (!id) return json({ error: 'id_required' }, corsHeaders, 400);
      const { data: existing } = await supabase.from(UNDERTAKING_TABLE).select('status').eq('id', id).maybeSingle();
      if (!existing) return json({ error: 'not_found' }, corsHeaders, 404);
      if (existing.status !== 'draft') {
        return json({ error: 'not_a_draft', message: 'Only draft undertakings can be deleted. Terminate instead.' }, corsHeaders, 409);
      }
      const { error } = await supabase.from(UNDERTAKING_TABLE).delete().eq('id', id);
      if (error) throw error;
      return json({ success: true }, corsHeaders);
    }

    return json({ error: 'unknown_action' }, corsHeaders, 400);
  } catch (err) {
    console.error('[loan-writer-undertakings] error:', err);
    return json({ ...internalError(err, 'manage-loan-writer-undertakings'), error: 'internal_error' }, corsHeaders, 500);
  }
});

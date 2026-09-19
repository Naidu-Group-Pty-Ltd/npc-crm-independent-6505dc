/**
 * Partner Referral Register — Phase 2
 *
 * One engine, two directions:
 *   • inbound_property_referral  — finance partner refers a client to NPC (property strategy)
 *   • outbound_finance_referral  — NPC refers a client to a finance partner (credit assistance)
 *
 * Dual auth:
 *   • Command Centre staff  → verifyAuth (full record, internal notes, eligibility, conversion)
 *   • Finance partner portal → x-finance-session-token (boundary-projected record only)
 *
 * Information boundary (both agreement templates, cl. 3):
 *   partner-facing payloads carry name + contact + general purpose + approved milestone only.
 *   Internal notes, eligibility reasoning and conversion links are never projected outward.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
import { recordPartnerAudit } from '../_shared/partnerAudit.ts';

import { extractFinanceToken, resolveFinancePartner } from '../_shared/finance-portal-session.ts';
import { internalError } from '../_shared/errorResponse.ts';
import {
  UNDERTAKING_TABLE,
  expireLapsedUndertakings,
  gateLoanWriterAssignment,
  isUndertakingLive,
} from '../_shared/loanWriterUndertakings.ts';
import {
  CONSENT_STATEMENT_VERSION,
  buildConsentStatement,
  buildDisclosureText,
  consentLinkFor,
  generateConsentToken,
  hashConsentToken,
} from '../_shared/partnerConsent.ts';

const CONSENT_TABLE = 'partner_consent_requests';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const TABLE = 'partner_referrals';
const EVENTS_TABLE = 'partner_referral_events';

const DIRECTIONS = new Set(['inbound_property_referral', 'outbound_finance_referral']);

/** Status vocabularies differ per direction. */
const STATUS_FLOW: Record<string, Record<string, string[]>> = {
  inbound_property_referral: {
    draft: ['submitted', 'withdrawn'],
    submitted: ['accepted', 'declined', 'withdrawn'],
    accepted: ['contacted', 'declined', 'withdrawn'],
    contacted: ['engaged', 'declined', 'withdrawn'],
    engaged: ['contracted', 'withdrawn'],
    contracted: ['settled', 'withdrawn'],
    settled: [],
    declined: [],
    withdrawn: [],
  },
  outbound_finance_referral: {
    draft: ['submitted', 'withdrawn'],
    submitted: ['accepted', 'declined', 'withdrawn'],
    accepted: ['contacted', 'declined', 'withdrawn'],
    contacted: ['application', 'declined', 'withdrawn'],
    application: ['approved', 'declined', 'withdrawn'],
    approved: ['settled', 'withdrawn'],
    settled: [],
    declined: [],
    withdrawn: [],
  },
};

/** Milestones a partner may set themselves (cl. 3 — approved high-level updates only). */
const PARTNER_SETTABLE_STATUS = new Set(['accepted', 'contacted', 'application', 'approved', 'settled', 'declined']);

const WRITABLE_FIELDS = [
  'direction', 'agreement_id', 'finance_agent_contact_id',
  'referring_entity_name', 'referring_individual_name', 'referring_individual_crn',
  'referring_contact_email', 'referring_contact_phone',
  'client_first_name', 'client_surname', 'client_email', 'client_phone',
  'general_purpose', 'preferred_contact_method', 'preferred_contact_time',
  'consent_obtained', 'consent_method', 'consent_artefact_path',
  'benefit_disclosed', 'prior_client_check',
  'assigned_consultant_id', 'assigned_consultant_name',
  'assigned_finance_user_id', 'assigned_loan_writer_name',
  'commercial_eligibility', 'eligibility_reason', 'estimated_value',
  'internal_notes', 'shared_notes',
] as const;

const BOOL_FIELDS = new Set(['consent_obtained', 'benefit_disclosed']);
const NUMERIC_FIELDS = new Set(['estimated_value']);

/** Fields visible to a finance partner over the portal transport. */
const PARTNER_PROJECTION = [
  'id', 'reference', 'direction', 'status', 'status_reason',
  'client_first_name', 'client_surname', 'client_email', 'client_phone',
  'general_purpose', 'preferred_contact_method', 'preferred_contact_time',
  'consent_obtained', 'consent_obtained_at', 'benefit_disclosed',
  'assigned_loan_writer_name', 'assigned_finance_user_id',
  'referring_entity_name', 'referring_individual_name',
  'shared_notes', 'submitted_at', 'accepted_at', 'completed_at',
  'agreement_id', 'created_at', 'updated_at',
];

function projectForPartner(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const key of PARTNER_PROJECTION) out[key] = row[key] ?? null;
  return out;
}

/**
 * Copy only the columns in `WRITABLE_FIELDS`, dropping everything else the
 * caller sent.
 *
 * Named for what it does rather than `sanitize`, which claimed something had
 * been cleaned without saying against what — and left the allowlist invisible at
 * the call site, where it is the only thing standing between a request body and
 * every column of the table.
 */
function pickWritable(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of WRITABLE_FIELDS) {
    if (!(key in input)) continue;
    let value = input[key as string];
    if (value === '' || value === undefined) value = null;
    if (BOOL_FIELDS.has(key)) value = value === true || value === 'true';
    if (value !== null && NUMERIC_FIELDS.has(key)) {
      const n = Number(value);
      value = Number.isFinite(n) ? n : null;
    }
    out[key] = value;
  }
  return out;
}

function json(body: unknown, corsHeaders: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function logEvent(
  supabase: any,
  referralId: string,
  eventType: string,
  actor: { id: string | null; label: string | null; surface: string },
  summary: string,
  payload: Record<string, unknown> = {},
) {
  const { error } = await supabase.from(EVENTS_TABLE).insert({
    referral_id: referralId,
    event_type: eventType,
    actor_id: actor.id,
    actor_label: actor.label,
    actor_surface: actor.surface,
    summary,
    payload,
  });
  if (error) console.error('[partner-referrals] event log failed:', error.message);

  // Phase 6 — mirror into the tamper-evident compliance chain.
  await recordPartnerAudit(supabase, {
    referral_id: referralId,
    scope_type: 'referral',
    scope_id: referralId,
    actor_type: actor.surface === 'finance_portal' ? 'finance_partner' : 'team_user',
    actor_id: actor.id,
    actor_label: actor.label,
    category: eventType.startsWith('consent') ? 'consent' : 'lifecycle',
    action: `referral_${eventType}`,
    target_type: 'partner_referral',
    target_id: referralId,
    description: summary,
    metadata: payload,
  });
}


/** Human reference: RIP-20260730-0007 / ROF-… */
async function nextReference(supabase: any, direction: string): Promise<string> {
  const prefix = direction === 'inbound_property_referral' ? 'RIP' : 'ROF';
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const { count } = await supabase
    .from(TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('direction', direction);
  const seq = String((count ?? 0) + 1).padStart(4, '0');
  return `${prefix}-${day}-${seq}`;
}

/** Duplicate / prior-client detection against existing referrals and clients. */
async function priorClientCheck(
  supabase: any,
  params: { email?: string | null; phone?: string | null; excludeId?: string | null },
): Promise<{ result: 'new' | 'existing' | 'duplicate'; matches: Record<string, unknown>[] }> {
  const email = params.email?.trim().toLowerCase() || null;
  const phone = params.phone?.replace(/\D/g, '') || null;
  if (!email && !phone) return { result: 'new', matches: [] };

  const matches: Record<string, unknown>[] = [];

  if (email) {
    let q = supabase
      .from(TABLE)
      .select('id, reference, direction, status, client_first_name, client_surname, created_at')
      .ilike('client_email', email)
      .limit(10);
    if (params.excludeId) q = q.neq('id', params.excludeId);
    const { data } = await q;
    for (const row of data ?? []) matches.push({ ...row, match_type: 'referral', matched_on: 'email' });
  }

  let clientMatch = false;
  if (email) {
    const { data } = await supabase
      .from('clients')
      .select('id, primary_first_name, primary_surname, primary_email')
      .ilike('primary_email', email)
      .limit(5);
    if ((data ?? []).length > 0) {
      clientMatch = true;
      for (const row of data ?? []) matches.push({ ...row, match_type: 'client', matched_on: 'email' });
    }
  }

  if (matches.some((m) => m.match_type === 'referral')) return { result: 'duplicate', matches };
  if (clientMatch) return { result: 'existing', matches };
  return { result: 'new', matches };
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  // CORS-CONTRACT: the canonical allowlist comes from `createCorsHeaders`.
  // Overriding `Access-Control-Allow-Headers` locally only ever narrows it
  // (this copy had already fallen behind on `x-step-up-token`), which fails the
  // browser preflight as an opaque "Failed to fetch".
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body = await req.json();
    const { action } = body ?? {};

    const financeToken = extractFinanceToken(req.headers, body);

    // ───────────────────────────────────────────────────────
    // FINANCE PARTNER SURFACE (boundary-projected)
    // ───────────────────────────────────────────────────────
    if (financeToken) {
      const resolved = await resolveFinancePartner(supabase, financeToken);
      if ((resolved as any).error) {
        return json({ error: (resolved as any).error }, corsHeaders, (resolved as any).status ?? 401);
      }
      const portalUser = (resolved as any).portalUser;
      const actor = { id: portalUser.id, label: portalUser.email ?? null, surface: 'finance_portal' };

      // Partner scope: referrals assigned to this portal user, or raised by them.
      const scope = (q: any) =>
        q.or(`assigned_finance_user_id.eq.${portalUser.id},created_by.eq.${portalUser.id}`);

      if (action === 'partner_list') {
        let q = supabase.from(TABLE).select('*').order('created_at', { ascending: false }).limit(500);
        q = scope(q);
        if (body.direction && DIRECTIONS.has(body.direction)) q = q.eq('direction', body.direction);
        if (body.status) q = q.eq('status', body.status);
        const { data, error } = await q;
        if (error) throw error;
        return json({ referrals: (data ?? []).map(projectForPartner) }, corsHeaders);
      }

      if (action === 'partner_get') {
        const { id } = body;
        if (!id) return json({ error: 'id_required' }, corsHeaders, 400);
        const { data } = await scope(supabase.from(TABLE).select('*').eq('id', id)).maybeSingle();
        if (!data) return json({ error: 'not_found' }, corsHeaders, 404);
        const { data: events } = await supabase
          .from(EVENTS_TABLE)
          .select('id, event_type, summary, created_at, actor_surface')
          .eq('referral_id', id)
          .order('created_at', { ascending: false })
          .limit(100);
        return json({ referral: projectForPartner(data), events: events ?? [] }, corsHeaders);
      }

      // Partner status update — clamped to approved milestones only.
      if (action === 'partner_update_status') {
        const { id, status: nextStatus, reason } = body;
        if (!id) return json({ error: 'id_required' }, corsHeaders, 400);
        if (!PARTNER_SETTABLE_STATUS.has(nextStatus)) {
          return json({ error: 'status_not_permitted' }, corsHeaders, 403);
        }
        const { data: existing } = await scope(supabase.from(TABLE).select('*').eq('id', id)).maybeSingle();
        if (!existing) return json({ error: 'not_found' }, corsHeaders, 404);

        const allowed = STATUS_FLOW[existing.direction]?.[existing.status] ?? [];
        if (!allowed.includes(nextStatus)) {
          return json({
            error: 'transition_not_allowed',
            message: `Cannot move a referral from "${existing.status}" to "${nextStatus}".`,
          }, corsHeaders, 409);
        }

        const patch: Record<string, unknown> = { status: nextStatus, status_reason: reason ?? null, updated_by: portalUser.id };
        if (nextStatus === 'accepted') patch.accepted_at = new Date().toISOString();
        if (nextStatus === 'declined') patch.declined_at = new Date().toISOString();
        if (nextStatus === 'settled') patch.completed_at = new Date().toISOString();

        const { data, error } = await supabase.from(TABLE).update(patch).eq('id', id).select().single();
        if (error) throw error;
        await logEvent(supabase, id, `status_${nextStatus}`, actor,
          `Partner moved referral ${existing.status} → ${nextStatus}`, { from: existing.status, to: nextStatus });
        return json({ referral: projectForPartner(data) }, corsHeaders);
      }

      if (action === 'partner_add_note') {
        const { id, note } = body;
        if (!id || !note) return json({ error: 'id_and_note_required' }, corsHeaders, 400);
        const { data: existing } = await scope(supabase.from(TABLE).select('id').eq('id', id)).maybeSingle();
        if (!existing) return json({ error: 'not_found' }, corsHeaders, 404);
        await logEvent(supabase, id, 'note', actor, String(note).slice(0, 2000));
        return json({ success: true }, corsHeaders);
      }

      return json({ error: 'unknown_action' }, corsHeaders, 400);
    }

    // ───────────────────────────────────────────────────────
    // COMMAND CENTRE SURFACE
    // ───────────────────────────────────────────────────────
    const csrf = enforceCsrf(req);
    if (!csrf.ok) return csrfDenied(corsHeaders, csrf);

    const authResult = await verifyAuth(supabase, req.headers, body);
    if (authResult.error) return createUnauthorizedResponse(authResult.error, corsHeaders);
    const actorId = authResult.userId ?? null;
    const actor = { id: actorId, label: authResult.username ?? null, surface: 'command_centre' };

    if (action === 'list') {
      let query = supabase.from(TABLE).select('*').order('created_at', { ascending: false }).limit(1000);
      if (body.direction && DIRECTIONS.has(body.direction)) query = query.eq('direction', body.direction);
      if (body.status) query = query.eq('status', body.status);
      if (body.agreement_id) query = query.eq('agreement_id', body.agreement_id);
      if (body.finance_agent_contact_id) query = query.eq('finance_agent_contact_id', body.finance_agent_contact_id);
      if (body.commercial_eligibility) query = query.eq('commercial_eligibility', body.commercial_eligibility);
      const { data, error } = await query;
      if (error) throw error;
      return json({ referrals: data ?? [] }, corsHeaders);
    }

    if (action === 'get') {
      const { id } = body;
      if (!id) return json({ error: 'id_required' }, corsHeaders, 400);
      const { data: referral, error } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      if (!referral) return json({ error: 'not_found' }, corsHeaders, 404);

      const { data: events } = await supabase
        .from(EVENTS_TABLE).select('*').eq('referral_id', id)
        .order('created_at', { ascending: false }).limit(200);

      // The governing-agreement join is gone. Commercial terms are no longer
      // held by the platform: any agreement is between the parties directly,
      // so quoting fee models back from a register the platform maintains is
      // exactly the participation being retired. `agreement_id` survives on
      // historical rows and is simply not resolved.
      const agreement: Record<string, unknown> | null = null;

      return json({ referral, events: events ?? [], agreement }, corsHeaders);
    }

    if (action === 'create') {
      const payload = pickWritable(body);
      const direction = String(payload.direction ?? '');
      if (!DIRECTIONS.has(direction)) return json({ error: 'direction_invalid' }, corsHeaders, 400);
      if (!payload.client_first_name) return json({ error: 'client_first_name_required' }, corsHeaders, 400);

      // No agreement snapshot. A referral no longer records which
      // platform-held agreement governs it, because the platform no longer
      // holds one — see `_shared/agreements/templateResource.pure.ts`.
      const agreementVersion: number | null = null;

      // A loan writer can only be attached at creation if their undertaking is live.
      if (payload.assigned_finance_user_id) {
        const gate = await gateLoanWriterAssignment(supabase, {
          direction,
          financeUserId: payload.assigned_finance_user_id as string,
          financeAgentContactId: (payload.finance_agent_contact_id as string) ?? null,
          undertakingId: (body.loan_writer_undertaking_id as string) ?? null,
        });
        if (!gate.ok) return json({ error: gate.error, message: gate.message }, corsHeaders, 422);
        if (gate.undertaking) {
          payload.loan_writer_undertaking_id = gate.undertaking.id;
          payload.assigned_loan_writer_name = payload.assigned_loan_writer_name || gate.undertaking.writer_full_name;
        }
      }

      const check = await priorClientCheck(supabase, {
        email: payload.client_email as string | null,
        phone: payload.client_phone as string | null,
      });

      const reference = await nextReference(supabase, direction);
      const insert: Record<string, unknown> = {
        ...payload,
        reference,
        agreement_version: agreementVersion,
        prior_client_check: payload.prior_client_check ?? check.result,
        status: 'draft',
        created_by: actorId,
        updated_by: actorId,
      };
      if (insert.consent_obtained === true) insert.consent_obtained_at = new Date().toISOString();
      if (insert.benefit_disclosed === true) insert.benefit_disclosed_at = new Date().toISOString();

      const { data, error } = await supabase.from(TABLE).insert(insert).select().single();
      if (error) throw error;

      await logEvent(supabase, data.id, 'created', actor,
        `Referral ${reference} registered (${direction})`, { direction, prior_client_check: check.result });
      if (check.result === 'duplicate') {
        await logEvent(supabase, data.id, 'duplicate_flagged', actor,
          'Potential duplicate referral detected on client contact details', { matches: check.matches });
      }

      return json({ referral: data, duplicate_matches: check.matches }, corsHeaders);
    }

    if (action === 'update') {
      const { id } = body;
      if (!id) return json({ error: 'id_required' }, corsHeaders, 400);

      const { data: existing } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
      if (!existing) return json({ error: 'not_found' }, corsHeaders, 404);
      if (['settled', 'declined', 'withdrawn'].includes(existing.status)) {
        return json({ error: 'referral_closed', message: 'Closed referrals are read-only.' }, corsHeaders, 409);
      }

      const payload = pickWritable(body);
      delete payload.direction; // immutable

      if (payload.consent_obtained === true && !existing.consent_obtained) {
        payload.consent_obtained_at = new Date().toISOString();
      }
      if (payload.benefit_disclosed === true && !existing.benefit_disclosed) {
        payload.benefit_disclosed_at = new Date().toISOString();
      }

      // Re-gate whenever the assignment changes on this edit.
      if ('assigned_finance_user_id' in payload &&
          payload.assigned_finance_user_id &&
          payload.assigned_finance_user_id !== existing.assigned_finance_user_id) {
        const gate = await gateLoanWriterAssignment(supabase, {
          direction: existing.direction,
          financeUserId: payload.assigned_finance_user_id as string,
          financeAgentContactId: (payload.finance_agent_contact_id as string) ?? existing.finance_agent_contact_id ?? null,
          undertakingId: (body.loan_writer_undertaking_id as string) ?? null,
        });
        if (!gate.ok) return json({ error: gate.error, message: gate.message }, corsHeaders, 422);
        if (gate.undertaking) {
          payload.loan_writer_undertaking_id = gate.undertaking.id;
          payload.assigned_loan_writer_name = payload.assigned_loan_writer_name || gate.undertaking.writer_full_name;
        }
      }

      const changedKeys = Object.keys(payload).filter(
        (k) => String(existing[k] ?? '') !== String(payload[k] ?? ''),
      );

      const { data, error } = await supabase
        .from(TABLE).update({ ...payload, updated_by: actorId }).eq('id', id).select().single();
      if (error) throw error;

      if (changedKeys.length > 0) {
        await logEvent(supabase, id, 'updated', actor, `Updated ${changedKeys.length} field(s)`, { fields: changedKeys });
      }
      return json({ referral: data }, corsHeaders);
    }

    if (action === 'transition') {
      const { id, status: nextStatus, reason } = body;
      if (!id) return json({ error: 'id_required' }, corsHeaders, 400);

      const { data: existing } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
      if (!existing) return json({ error: 'not_found' }, corsHeaders, 404);

      const allowed = STATUS_FLOW[existing.direction]?.[existing.status] ?? [];
      if (!allowed.includes(nextStatus)) {
        return json({
          error: 'transition_not_allowed',
          message: `Cannot move a referral from "${existing.status}" to "${nextStatus}".`,
        }, corsHeaders, 409);
      }

      // Submission gate — consent + benefit disclosure before any client data leaves NPC.
      if (nextStatus === 'submitted') {
        const missing: string[] = [];
        if (!existing.consent_obtained) missing.push('Client consent');
        if (!existing.benefit_disclosed) missing.push('Benefit disclosure');
        if (!existing.general_purpose) missing.push('General purpose of referral');
        if (!existing.client_email && !existing.client_phone) missing.push('Client contact detail');
        if (existing.prior_client_check === 'unchecked') missing.push('Prior-client check');
        if (existing.direction === 'outbound_finance_referral' && existing.assigned_finance_user_id) {
          const gate = await gateLoanWriterAssignment(supabase, {
            direction: existing.direction,
            financeUserId: existing.assigned_finance_user_id,
            financeAgentContactId: existing.finance_agent_contact_id,
            undertakingId: existing.loan_writer_undertaking_id,
          });
          if (!gate.ok) missing.push('Live loan writer undertaking (Annexure B)');
        }
        if (missing.length > 0) {
          return json({
            error: 'submission_gate',
            message: `Complete the compliance gate before submitting: ${missing.join(', ')}.`,
            missing,
          }, corsHeaders, 422);
        }
      }

      const patch: Record<string, unknown> = { status: nextStatus, status_reason: reason ?? null, updated_by: actorId };
      const now = new Date().toISOString();
      if (nextStatus === 'submitted') patch.submitted_at = now;
      if (nextStatus === 'accepted') patch.accepted_at = now;
      if (nextStatus === 'declined') patch.declined_at = now;
      if (nextStatus === 'settled') patch.completed_at = now;

      const { data, error } = await supabase.from(TABLE).update(patch).eq('id', id).select().single();
      if (error) throw error;

      await logEvent(supabase, id, `status_${nextStatus}`, actor,
        `Status changed ${existing.status} → ${nextStatus}`, { from: existing.status, to: nextStatus, reason: reason ?? null });
      return json({ referral: data }, corsHeaders);
    }

    /** Commercial eligibility decision (Annexure A — office use only). */
    if (action === 'set_eligibility') {
      const { id, commercial_eligibility, eligibility_reason } = body;
      if (!id) return json({ error: 'id_required' }, corsHeaders, 400);
      if (!['pending', 'eligible', 'not_eligible'].includes(commercial_eligibility)) {
        return json({ error: 'eligibility_invalid' }, corsHeaders, 400);
      }
      const { data, error } = await supabase
        .from(TABLE)
        .update({ commercial_eligibility, eligibility_reason: eligibility_reason ?? null, updated_by: actorId })
        .eq('id', id).select().single();
      if (error) throw error;
      await logEvent(supabase, id, 'eligibility_set', actor,
        `Commercial eligibility set to ${commercial_eligibility}`, { eligibility_reason: eligibility_reason ?? null });
      return json({ referral: data }, corsHeaders);
    }

    /** Re-run the duplicate / prior-client check on demand. */
    if (action === 'run_prior_client_check') {
      const { id } = body;
      if (!id) return json({ error: 'id_required' }, corsHeaders, 400);
      const { data: existing } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
      if (!existing) return json({ error: 'not_found' }, corsHeaders, 404);

      const check = await priorClientCheck(supabase, {
        email: existing.client_email, phone: existing.client_phone, excludeId: id,
      });
      const { data, error } = await supabase
        .from(TABLE).update({ prior_client_check: check.result, updated_by: actorId })
        .eq('id', id).select().single();
      if (error) throw error;
      await logEvent(supabase, id, 'prior_client_check', actor,
        `Prior-client check: ${check.result}`, { matches: check.matches });
      return json({ referral: data, matches: check.matches }, corsHeaders);
    }

    /** Link the referral to an existing client / purchase file / deal. */
    if (action === 'link_records') {
      const { id, client_id, purchase_file_id, client_deal_id } = body;
      if (!id) return json({ error: 'id_required' }, corsHeaders, 400);
      const patch: Record<string, unknown> = { updated_by: actorId };
      if ('client_id' in body) patch.client_id = client_id || null;
      if ('purchase_file_id' in body) patch.purchase_file_id = purchase_file_id || null;
      if ('client_deal_id' in body) patch.client_deal_id = client_deal_id || null;

      const { data, error } = await supabase.from(TABLE).update(patch).eq('id', id).select().single();
      if (error) throw error;
      await logEvent(supabase, id, 'records_linked', actor, 'Referral linked to internal records', patch);
      return json({ referral: data }, corsHeaders);
    }

    /** Convert an accepted referral into a client record. */
    if (action === 'convert_to_client') {
      const { id } = body;
      if (!id) return json({ error: 'id_required' }, corsHeaders, 400);
      const { data: existing } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
      if (!existing) return json({ error: 'not_found' }, corsHeaders, 404);
      if (existing.client_id) return json({ error: 'already_converted', client_id: existing.client_id }, corsHeaders, 409);
      if (!existing.consent_obtained) {
        return json({ error: 'consent_required', message: 'Client consent must be recorded before conversion.' }, corsHeaders, 422);
      }
      if (!['accepted', 'contacted', 'engaged', 'application', 'approved', 'contracted'].includes(existing.status)) {
        return json({ error: 'status_invalid', message: 'Accept the referral before converting it.' }, corsHeaders, 409);
      }

      const { data: client, error } = await supabase
        .from('clients')
        .insert({
          primary_first_name: existing.client_first_name,
          primary_surname: existing.client_surname,
          primary_email: existing.client_email,
          primary_mobile: existing.client_phone,
          lead_source: existing.direction === 'inbound_property_referral' ? 'Finance partner referral' : 'Partner referral',
          notes: existing.general_purpose,
        })
        .select('id')
        .single();
      if (error) throw error;

      const { data, error: updErr } = await supabase
        .from(TABLE).update({ client_id: client.id, updated_by: actorId }).eq('id', id).select().single();
      if (updErr) throw updErr;

      await logEvent(supabase, id, 'converted_to_client', actor, 'Referral converted to a client record', { client_id: client.id });
      return json({ referral: data, client_id: client.id }, corsHeaders);
    }

    if (action === 'add_note') {
      const { id, note } = body;
      if (!id || !note) return json({ error: 'id_and_note_required' }, corsHeaders, 400);
      await logEvent(supabase, id, 'note', actor, String(note).slice(0, 2000));
      return json({ success: true }, corsHeaders);
    }

    if (action === 'delete_draft') {
      const { id } = body;
      if (!id) return json({ error: 'id_required' }, corsHeaders, 400);
      const { data: existing } = await supabase.from(TABLE).select('id, status').eq('id', id).maybeSingle();
      if (!existing) return json({ error: 'not_found' }, corsHeaders, 404);
      if (existing.status !== 'draft') return json({ error: 'only_drafts_deletable' }, corsHeaders, 409);
      const { error } = await supabase.from(TABLE).delete().eq('id', id);
      if (error) throw error;
      return json({ success: true }, corsHeaders);
    }

    /**
     * Always empty, and kept rather than removed.
     *
     * There is no register of agreements to attach a referral to any more.
     * The action stays so a browser running an older bundle gets an empty
     * picker instead of `unknown_action`, which would surface as an error
     * toast on a page that is otherwise working.
     */
    if (action === 'list_active_agreements') {
      return json({ agreements: [] }, corsHeaders);
    }

    /** Finance portal users, for assigning an outbound referral to a loan writer. */
    if (action === 'list_finance_users') {
      const { data, error } = await supabase
        .from('finance_portal_users')
        // `finance_agent_contacts` carries `name` and `company` — not
        // `contact_name`/`company_name`. A non-existent column fails the whole
        // read, so the loan-writer picker came back empty.
        .select('id, email, is_active, finance_contact_id, finance_agent_contacts:finance_contact_id (name, company)')
        .eq('is_active', true)
        .order('email', { ascending: true });
      if (error) throw error;
      return json({ users: data ?? [] }, corsHeaders);
    }

    /** Live undertakings available to receive an outbound referral. */
    if (action === 'list_active_undertakings') {
      await expireLapsedUndertakings(supabase);
      let q = supabase
        .from(UNDERTAKING_TABLE)
        .select('id, reference, status, writer_full_name, writer_entity_name, licensee_name, acl_number, crn, finance_user_id, finance_agent_contact_id, effective_date, expiry_date, authorisation_end_date, signed_at')
        .eq('status', 'active')
        .order('writer_full_name', { ascending: true });
      if (body.finance_user_id) q = q.eq('finance_user_id', body.finance_user_id);
      if (body.agreement_id) q = q.eq('agreement_id', body.agreement_id);
      const { data, error } = await q;
      if (error) throw error;
      return json({ undertakings: (data ?? []).filter((row: any) => isUndertakingLive(row)) }, corsHeaders);
    }

    /** Assign an outbound referral to a loan writer — gated on a live undertaking. */
    if (action === 'assign_loan_writer') {
      const { id, assigned_finance_user_id, loan_writer_undertaking_id, assigned_loan_writer_name } = body;
      if (!id) return json({ error: 'id_required' }, corsHeaders, 400);
      const { data: existing } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
      if (!existing) return json({ error: 'not_found' }, corsHeaders, 404);

      // Clearing the assignment is always allowed.
      if (!assigned_finance_user_id && !loan_writer_undertaking_id) {
        const { data, error } = await supabase.from(TABLE).update({
          assigned_finance_user_id: null,
          loan_writer_undertaking_id: null,
          assigned_loan_writer_name: null,
          updated_by: actorId,
        }).eq('id', id).select().single();
        if (error) throw error;
        await logEvent(supabase, id, 'loan_writer_unassigned', actor, 'Loan writer assignment cleared');
        return json({ referral: data }, corsHeaders);
      }

      const gate = await gateLoanWriterAssignment(supabase, {
        direction: existing.direction,
        financeUserId: assigned_finance_user_id ?? null,
        financeAgentContactId: existing.finance_agent_contact_id ?? null,
        undertakingId: loan_writer_undertaking_id ?? null,
      });
      if (!gate.ok) return json({ error: gate.error, message: gate.message }, corsHeaders, 422);

      const patch: Record<string, unknown> = {
        assigned_finance_user_id: assigned_finance_user_id ?? gate.undertaking?.finance_user_id ?? null,
        loan_writer_undertaking_id: gate.undertaking?.id ?? null,
        assigned_loan_writer_name:
          assigned_loan_writer_name || gate.undertaking?.writer_full_name || existing.assigned_loan_writer_name || null,
        updated_by: actorId,
      };

      const { data, error } = await supabase.from(TABLE).update(patch).eq('id', id).select().single();
      if (error) throw error;
      await logEvent(supabase, id, 'loan_writer_assigned', actor,
        `Assigned to ${patch.assigned_loan_writer_name}${gate.undertaking ? ` under undertaking ${gate.undertaking.reference}` : ''}`,
        { undertaking_id: gate.undertaking?.id ?? null, undertaking_reference: gate.undertaking?.reference ?? null });
      return json({ referral: data, undertaking: gate.undertaking }, corsHeaders);
    }

    // ── Consent capture (Annexure A) ───────────────────────

    if (action === 'list_consent_requests') {
      const { id } = body;
      if (!id) return json({ error: 'id_required' }, corsHeaders, 400);
      const { data, error } = await supabase
        .from(CONSENT_TABLE)
        .select('id, referral_id, channel, recipient_name, recipient_email, recipient_phone, statement_version, statement_text, disclosure_text, status, sent_at, first_viewed_at, signed_at, declined_at, revoked_at, expires_at, signature_name, signature_ip, created_at')
        .eq('referral_id', id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return json({ consent_requests: data ?? [] }, corsHeaders);
    }

    /** Issue a fresh signing link. Any previous live request is superseded. */
    if (action === 'issue_consent_request') {
      const { id, channel, recipient_email, recipient_phone, expires_in_days } = body;
      if (!id) return json({ error: 'id_required' }, corsHeaders, 400);
      const { data: existing } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
      if (!existing) return json({ error: 'not_found' }, corsHeaders, 404);
      if (existing.consent_obtained) {
        return json({ error: 'consent_already_recorded', message: 'Consent is already recorded for this referral.' }, corsHeaders, 409);
      }

      const email = recipient_email || existing.client_email;
      const phone = recipient_phone || existing.client_phone;
      const useChannel = channel || (email ? 'email' : phone ? 'sms' : 'manual');
      if (useChannel === 'email' && !email) return json({ error: 'recipient_email_required' }, corsHeaders, 400);
      if (useChannel === 'sms' && !phone) return json({ error: 'recipient_phone_required' }, corsHeaders, 400);

      // The referral's own `referring_entity_name` is the only source now; it
      // was already preferred over the agreement's partner name below.
      let feeSummary: string | null = null;
      const partnerName: string | null = null;

      const clientName = [existing.client_first_name, existing.client_surname].filter(Boolean).join(' ');
      const statement = buildConsentStatement({
        clientName: clientName || 'the client',
        direction: existing.direction,
        referringEntity: existing.referring_entity_name ?? partnerName,
        receivingEntity: partnerName ?? existing.referring_entity_name,
        generalPurpose: existing.general_purpose,
      });
      const disclosure = buildDisclosureText(existing.direction, feeSummary);

      // Supersede outstanding links so only one is ever signable.
      await supabase.from(CONSENT_TABLE)
        .update({ status: 'revoked', revoked_at: new Date().toISOString() })
        .eq('referral_id', id).in('status', ['pending', 'viewed']);

      const token = generateConsentToken();
      const tokenHash = await hashConsentToken(token);
      const days = Math.min(Math.max(Number(expires_in_days) || 14, 1), 60);

      const { data: created, error } = await supabase.from(CONSENT_TABLE).insert({
        referral_id: id,
        token_hash: tokenHash,
        channel: useChannel,
        recipient_name: clientName || null,
        recipient_email: email ?? null,
        recipient_phone: phone ?? null,
        statement_version: CONSENT_STATEMENT_VERSION,
        statement_text: statement,
        disclosure_text: disclosure,
        expires_at: new Date(Date.now() + days * 86400000).toISOString(),
        created_by: actorId,
      }).select().single();
      if (error) throw error;

      const link = consentLinkFor(token, origin);
      await logEvent(supabase, id, 'consent_requested', actor,
        `Consent link issued via ${useChannel}`, { consent_request_id: created.id, channel: useChannel, expires_at: created.expires_at });

      return json({ consent_request: created, consent_link: link }, corsHeaders);
    }

    if (action === 'revoke_consent_request') {
      const { consent_request_id, reason } = body;
      if (!consent_request_id) return json({ error: 'consent_request_id_required' }, corsHeaders, 400);
      const { data: cr } = await supabase.from(CONSENT_TABLE).select('*').eq('id', consent_request_id).maybeSingle();
      if (!cr) return json({ error: 'not_found' }, corsHeaders, 404);
      if (!['pending', 'viewed'].includes(cr.status)) {
        return json({ error: 'request_not_live', message: 'Only an outstanding consent link can be revoked.' }, corsHeaders, 409);
      }
      const { data, error } = await supabase.from(CONSENT_TABLE)
        .update({ status: 'revoked', revoked_at: new Date().toISOString() })
        .eq('id', consent_request_id).select().single();
      if (error) throw error;
      await logEvent(supabase, cr.referral_id, 'consent_revoked', actor, 'Consent link revoked', { consent_request_id, reason: reason ?? null });
      return json({ consent_request: data }, corsHeaders);
    }

    /** Consent taken verbally / on paper — evidence path is mandatory. */
    if (action === 'record_manual_consent') {
      const { id, consent_method, consent_artefact_path, obtained_at, note } = body;
      if (!id) return json({ error: 'id_required' }, corsHeaders, 400);
      if (!consent_method) return json({ error: 'consent_method_required' }, corsHeaders, 400);
      if (!consent_artefact_path && !note) {
        return json({
          error: 'evidence_required',
          message: 'Record where the consent evidence is held (file reference or a note describing the call).',
        }, corsHeaders, 422);
      }

      const { data, error } = await supabase.from(TABLE).update({
        consent_obtained: true,
        consent_obtained_at: obtained_at ?? new Date().toISOString(),
        consent_method,
        consent_artefact_path: consent_artefact_path ?? null,
        updated_by: actorId,
      }).eq('id', id).select().single();
      if (error) throw error;

      await logEvent(supabase, id, 'consent_recorded', actor,
        `Consent recorded manually (${consent_method})`, { consent_method, consent_artefact_path: consent_artefact_path ?? null, note: note ?? null });
      return json({ referral: data }, corsHeaders);
    }

    return json({ error: 'unknown_action' }, corsHeaders, 400);
  } catch (error) {
    console.error('[manage-partner-referrals] error:', error);
    return json({ ...internalError(error, 'manage-partner-referrals'), error: 'internal_error' }, corsHeaders, 500);
  }
});

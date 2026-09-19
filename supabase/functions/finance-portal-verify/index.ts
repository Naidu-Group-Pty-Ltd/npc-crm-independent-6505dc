import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0'
import { createCorsHeaders } from "../_shared/auth.ts"
import { csrfDenied, enforceCsrf } from "../_shared/csrfGuard.ts"
import { extractFinanceSessionToken } from "../_shared/financeSessionToken.ts"
import { ACKNOWLEDGEMENTS_INCOMPLETE_ERROR, readAcknowledgements } from '../_shared/portalAgreement.ts'
import { hashSessionToken } from '../_shared/sessionHash.ts'
import { readBoundedJson } from '../_shared/validate.ts';

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    let sessionToken: string | null = null;
    let action: string | null = null;
    let body: Record<string, unknown> = {};
    try {
      body = await readBoundedJson(req);
      sessionToken = extractFinanceSessionToken(req.headers, body);
      action = typeof body?.action === 'string' ? body.action : null;
    } catch {
      sessionToken = extractFinanceSessionToken(req.headers);
    }

    if (action === 'accept_terms' || action === 'complete_onboarding') {
      const csrf = enforceCsrf(req);
      if (!csrf.ok) return csrfDenied(corsHeaders, csrf);
    }

    if (!sessionToken) {
      return new Response(
        JSON.stringify({ error: 'Session token is required', valid: false }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: portalUser, error } = await supabase
      .from('finance_portal_users')
      .select(`
        id, finance_contact_id, email, is_active, revoked_at,
        has_accepted_terms, has_completed_onboarding,
        session_expires_at,
        finance_agent_contacts:finance_contact_id (id, name, company, contact_type, is_active)
      `)
      .eq('session_token', sessionToken)
      .maybeSingle()

    if (error || !portalUser || !portalUser.is_active || portalUser.revoked_at) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired session', valid: false }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!portalUser.session_expires_at || new Date(portalUser.session_expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ error: 'Session expired', valid: false }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const contact = portalUser.finance_agent_contacts as any;
    if (!contact || !contact.is_active) {
      return new Response(
        JSON.stringify({ error: 'Linked finance contact is no longer active', valid: false }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // The current Finance Portal agreement. One row per portal, so this portal
    // carries its own version, hash and acceptance history for the document the
    // Solicitor and Builder portals also present.
    const { data: currentTerms } = await supabase
      .from('portal_terms_versions')
      .select('id, version, title, content_markdown, document_hash, effective_at')
      .eq('portal', 'finance')
      .is('retired_at', null)
      .lte('effective_at', new Date().toISOString())
      .order('effective_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    // Acceptance is version-aware. `has_accepted_terms` only records that the
    // partner once accepted something; an amended agreement would otherwise
    // never be presented to anyone already through the door.
    const { data: currentAcceptance } = currentTerms
      ? await supabase
          .from('portal_terms_acceptances')
          .select('id')
          .eq('terms_version_id', currentTerms.id)
          .eq('finance_user_id', portalUser.id)
          .maybeSingle()
      : { data: null }
    const hasAcceptedCurrentTerms = Boolean(currentTerms && currentAcceptance)

    if (action === 'get_governance') {
      return new Response(
        JSON.stringify({
          success: true,
          terms: currentTerms ?? null,
          terms_accepted: hasAcceptedCurrentTerms,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (action === 'accept_terms') {
      if (!currentTerms) {
        return new Response(
          JSON.stringify({ error: 'Current terms unavailable' }),
          { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Every mandatory acknowledgment must be asserted. The list is shared
      // with the Solicitor and Builder portals: one agreement, one gate.
      const { acknowledgements, missing } = readAcknowledgements(body)
      if (missing.length > 0) {
        return new Response(
          JSON.stringify({ error: ACKNOWLEDGEMENTS_INCOMPLETE_ERROR, code: 'ACKNOWLEDGEMENTS_INCOMPLETE', missing }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Uniqueness is a PARTIAL unique index, which PostgREST cannot target
      // with `on_conflict`; read first and tolerate a concurrent insert, as the
      // Solicitor Portal does.
      if (!currentAcceptance) {
        const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
        const userAgent = req.headers.get('user-agent')
        const { error: acceptanceError } = await supabase.from('portal_terms_acceptances').insert({
          portal: 'finance',
          terms_version_id: currentTerms.id,
          finance_user_id: portalUser.id,
          acknowledgements,
          ip_hash: ip ? await hashSessionToken(`ip:${ip}`) : null,
          user_agent_hash: userAgent ? await hashSessionToken(`ua:${userAgent}`) : null,
        })
        if (acceptanceError && acceptanceError.code !== '23505') throw acceptanceError
      }

      const { error: flagError } = await supabase
        .from('finance_portal_users')
        .update({ has_accepted_terms: true, terms_accepted_at: new Date().toISOString() })
        .eq('id', portalUser.id)
      if (flagError) throw flagError

      return new Response(
        JSON.stringify({ success: true, terms_version_id: currentTerms.id, version: currentTerms.version }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (action === 'complete_onboarding') {
      await supabase
        .from('finance_portal_users')
        .update({ has_completed_onboarding: true })
        .eq('id', portalUser.id)
      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({
        valid: true,
        user: {
          id: portalUser.id,
          finance_contact_id: portalUser.finance_contact_id,
          email: portalUser.email,
          name: contact.name,
          company: contact.company,
          contact_type: contact.contact_type,
          has_accepted_terms: portalUser.has_accepted_terms,
          has_accepted_current_terms: hasAcceptedCurrentTerms,
          current_terms_version: currentTerms?.version ?? null,
          has_completed_onboarding: portalUser.has_completed_onboarding,
        },
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    console.error('Finance portal verify error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error', valid: false }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0'
import { createCorsHeaders, createSolicitorSessionCookie } from "../_shared/auth.ts"
import { csrfDenied, enforceCsrf } from "../_shared/csrfGuard.ts"
import { resolveSolicitorSession } from "../_shared/solicitorPortalAuth.ts"
import { auditSolicitorIdentity, issueSolicitorSession } from "../_shared/solicitorSessions.ts"
import { hashSessionToken } from "../_shared/sessionHash.ts"
import { ACKNOWLEDGEMENTS_INCOMPLETE_ERROR, readAcknowledgements } from "../_shared/portalAgreement.ts"


Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* ignore */ }
    const action = typeof body?.action === 'string' ? body.action : null;

    if (action === 'accept_terms' || action === 'accept_current_terms' || action === 'complete_onboarding' || action === 'complete_onboarding_step' || action === 'revoke_session' || action === 'revoke_other_sessions') {
      const csrf = enforceCsrf(req);
      if (!csrf.ok) return csrfDenied(corsHeaders, csrf);
    }

    const session = await resolveSolicitorSession(supabase, req.headers, body);
    if (!session.ok || !session.user) {
      return new Response(
        JSON.stringify({ error: session.error, valid: false }),
        { status: session.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    let migratedCookie: string | null = null;
    let migratedSession: { id: string; absolute_expires_at: string; idle_expires_at: string } | null = null;
    if (session.legacy_token) {
      const issued = await issueSolicitorSession(supabase, session.user.id, req, { legacyMigrated: true });
      const { error: clearLegacyError } = await supabase.from('solicitor_portal_users').update({ session_token: null, session_expires_at: null }).eq('id', session.user.id).eq('session_token', session.legacy_token);
      if (clearLegacyError) throw clearLegacyError;
      await auditSolicitorIdentity(supabase, req, { userId: session.user.id, firmId: session.user.firm_id, action: 'legacy_session_migrated', sessionId: issued.id });
      migratedCookie = createSolicitorSessionCookie(issued.token, issued.absoluteExpiresAt);
      migratedSession = { id: issued.id, absolute_expires_at: issued.absoluteExpiresAt.toISOString(), idle_expires_at: issued.idleExpiresAt.toISOString() };
    }

    if (action === 'accept_terms' || action === 'accept_current_terms') {
      const { data: terms } = await supabase.from('portal_terms_versions').select('id, version, document_hash').eq('portal','solicitor').is('retired_at',null).lte('effective_at',new Date().toISOString()).order('effective_at',{ascending:false}).limit(1).maybeSingle();
      if (!terms) return new Response(JSON.stringify({ error: 'Current terms unavailable' }), { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      // Every mandatory acknowledgment must be asserted. The list is shared
      // with the Builder and Finance portals: one agreement, one gate.
      const { acknowledgements, missing } = readAcknowledgements(body);
      if (missing.length > 0) {
        return new Response(
          JSON.stringify({ error: ACKNOWLEDGEMENTS_INCOMPLETE_ERROR, code: 'ACKNOWLEDGEMENTS_INCOMPLETE', missing }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
      // Uniqueness is enforced by the per-portal PARTIAL unique indexes
      // (`portal_terms_acceptances_solicitor_key`), which PostgREST cannot
      // target with `on_conflict` — an upsert here fails with 42P10. Read the
      // existing acceptance first and insert only when absent, tolerating a
      // concurrent insert that trips the partial index.
      const { data: existingAcceptance, error: existingError } = await supabase
        .from('portal_terms_acceptances')
        .select('id')
        .eq('terms_version_id', terms.id)
        .eq('solicitor_user_id', session.user.id)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existingAcceptance) {
        const { error: acceptanceError } = await supabase.from('portal_terms_acceptances').insert({ portal:'solicitor', terms_version_id:terms.id, solicitor_user_id:session.user.id, acknowledgements, ip_hash:ip ? await hashSessionToken(`ip:${ip}`):null, user_agent_hash:req.headers.get('user-agent') ? await hashSessionToken(`ua:${req.headers.get('user-agent')}`):null });
        if (acceptanceError && acceptanceError.code !== '23505') throw acceptanceError;
      }
      await supabase
        .from('solicitor_portal_users')
        .update({ has_accepted_terms: true, terms_accepted_at: new Date().toISOString() })
        .eq('id', session.user.id)
      await auditSolicitorIdentity(supabase, req, {
        userId: session.user.id, firmId: session.user.firm_id,
        action: 'terms_version_accepted', sessionId: session.session_id,
        metadata: { terms_version_id: terms.id, version: terms.version, document_hash: terms.document_hash ?? null, acknowledgements },
      });
      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json', ...(migratedCookie ? { 'Set-Cookie': migratedCookie } : {}) },
      })
    }

    if (action === 'get_governance') {
      const [{ data: terms }, { data: steps }] = await Promise.all([
        supabase.from('portal_terms_versions').select('id, version, title, content_markdown, document_hash, effective_at').eq('portal','solicitor').is('retired_at',null).lte('effective_at',new Date().toISOString()).order('effective_at',{ascending:false}).limit(1).maybeSingle(),
        supabase.from('solicitor_onboarding_steps').select('step_key, mandatory, completed_at').eq('solicitor_user_id',session.user.id).order('created_at'),
      ]);
      return new Response(JSON.stringify({ success:true, terms, terms_accepted:session.user.has_accepted_current_terms, steps:steps||[] }), { status:200, headers:{...corsHeaders,'Content-Type':'application/json',...(migratedCookie?{'Set-Cookie':migratedCookie}:{})} });
    }
    if (action === 'complete_onboarding' || action === 'complete_onboarding_step') {
      const stepKey = action === 'complete_onboarding_step' && typeof body.step_key === 'string' ? body.step_key : null;
      let stepQuery = supabase.from('solicitor_onboarding_steps').update({ completed_at:new Date().toISOString(), completed_session_id:session.session_id||null }).eq('solicitor_user_id',session.user.id);
      if (stepKey) stepQuery = stepQuery.eq('step_key',stepKey);
      const { error: stepError } = await stepQuery;
      if (stepError) throw stepError;
      const { data: mandatorySteps, error: mandatoryError } = await supabase
        .from('solicitor_onboarding_steps')
        .select('completed_at')
        .eq('solicitor_user_id', session.user.id)
        .eq('mandatory', true);
      if (mandatoryError) throw mandatoryError;
      const mandatoryComplete = (mandatorySteps || []).length > 0
        && (mandatorySteps || []).every((step) => Boolean(step.completed_at));
      await supabase
        .from('solicitor_portal_users')
        .update({ has_completed_onboarding: mandatoryComplete })
        .eq('id', session.user.id)
      await auditSolicitorIdentity(supabase, req, {
        userId: session.user.id, firmId: session.user.firm_id,
        action: 'onboarding_updated', sessionId: session.session_id,
        metadata: { step_key: stepKey, mandatory_complete: mandatoryComplete },
      });
      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json', ...(migratedCookie ? { 'Set-Cookie': migratedCookie } : {}) },
      })
    }

    if (action === 'list_sessions') {
      const { data: sessions } = await supabase.from('solicitor_portal_sessions')
        .select('id, created_at, absolute_expires_at, idle_expires_at, last_used_at, revoked_at, revoked_reason, device_label')
        .eq('solicitor_user_id', session.user.id).order('last_used_at', { ascending: false });
      return new Response(JSON.stringify({ success: true, current_session_id: session.session_id || null, sessions: sessions || [] }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json', ...(migratedCookie ? { 'Set-Cookie': migratedCookie } : {}) } });
    }
    if (action === 'revoke_session') {
      const targetId = typeof body.session_id === 'string' ? body.session_id : '';
      const { data: target } = await supabase.from('solicitor_portal_sessions').update({ revoked_at: new Date().toISOString(), revoked_reason: 'user_revoked_device' })
        .eq('id', targetId).eq('solicitor_user_id', session.user.id).is('revoked_at', null).select('id').maybeSingle();
      if (target) await auditSolicitorIdentity(supabase, req, { userId: session.user.id, firmId: session.user.firm_id, action: 'session_revoked', sessionId: target.id });
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json', ...(target?.id === session.session_id ? { 'Set-Cookie': createSolicitorSessionCookie('', new Date(0), { clear: true }) } : {}) } });
    }
    if (action === 'revoke_other_sessions') {
      const query = supabase.from('solicitor_portal_sessions').update({ revoked_at: new Date().toISOString(), revoked_reason: 'user_revoked_other_devices' })
        .eq('solicitor_user_id', session.user.id).is('revoked_at', null);
      const { data: revoked } = session.session_id ? await query.neq('id', session.session_id).select('id') : await query.select('id');
      await auditSolicitorIdentity(supabase, req, { userId: session.user.id, firmId: session.user.firm_id, action: 'other_sessions_revoked', sessionId: session.session_id, metadata: { count: (revoked || []).length } });
      return new Response(JSON.stringify({ success: true, revoked: (revoked || []).length }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Track presence for the "what's changed since your last visit" surface.
    const previousSeenAt = session.user.last_seen_at;
    await supabase
      .from('solicitor_portal_users')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', session.user.id)

    return new Response(
      JSON.stringify({
        valid: true,
        user: {
          id: session.user.id,
          firm_id: session.user.firm_id,
          email: session.user.email,
          name: session.user.name,
          phone: session.user.phone,
          position: session.user.position,
          portal_role: session.user.portal_role,
          firm_name: session.user.firm?.trading_name || session.user.firm?.name || null,
          practising_states: session.user.firm?.practising_states || [],
          has_accepted_terms: session.user.has_accepted_terms,
          has_completed_onboarding: session.user.has_completed_onboarding,
          current_terms_version: session.user.current_terms_version,
          has_accepted_current_terms: session.user.has_accepted_current_terms,
          has_completed_mandatory_onboarding: session.user.has_completed_mandatory_onboarding,
          must_change_password: session.user.must_change_password,
        },
        previous_seen_at: previousSeenAt,
        session: migratedSession || (session.session_id ? { id: session.session_id } : null),
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json', ...(migratedCookie ? { 'Set-Cookie': migratedCookie } : {}) } }
    )
  } catch (error: any) {
    console.error('Solicitor portal verify error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error', valid: false }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

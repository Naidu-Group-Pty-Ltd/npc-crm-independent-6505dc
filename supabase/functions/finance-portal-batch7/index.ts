/**
 * Finance Portal — Batch 7 (Documents & Compliance Power)
 *
 * #38 Doc OCR + Anti-Tamper Check       → purchase_file_doc_compliance_checks
 * #39 Verification of Identity (VOI)    → purchase_file_voi_verifications
 * #40 Bank Statement Connector (Illion) → purchase_file_bank_statement_requests
 * #41 CreditCheck (Equifax/Experian)    → purchase_file_credit_checks
 * #42 eSignature on Discovery Docs      → purchase_file_discovery_signatures
 * #43 NCCP Compliance Vault             → purchase_file_nccp_bundles
 *
 * Auth: finance partner via x-finance-session-token.
 *
 * Provider integrations are provider-agnostic. Where third-party credentials
 * exist (DocuSign), we attempt real envelope creation. Other providers (Illion,
 * Equifax, Frankie/IDVerse) record the intent and return a stub consent URL —
 * ready for wiring to live APIs once credentials are added.
 */
import { createClient } from "npm:@supabase/supabase-js@2.55.0";
import {
  canAccessPurchaseFile,
  canAccessPurchaseFileResource,
} from '../_shared/financePortalObjectAuthz.ts';

import { createCorsHeaders as __createCorsHeaders } from "../_shared/auth.ts";
import { meteredFetch } from "../_shared/meteredFetch.ts";
import { internalError } from '../_shared/errorResponse.ts';
import { extractFinanceCredential } from '../_shared/financeSessionToken.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
// Dynamic per-request CORS — frontend uses `credentials: 'include'`, so ACAO must
// echo the request Origin (never `*`) with `Allow-Credentials: true`.
const corsHeaderDefaults: Record<string, string> = {
  ...__createCorsHeaders(null),
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-finance-session-token, x-session-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

const NCCP_REQUIRED = [
  { key: 'privacy_consent',           label: 'Privacy Act Consent',                category: 'consents' },
  { key: 'credit_guide',              label: 'Credit Guide Acknowledgement',       category: 'consents' },
  { key: 'fact_find_ack',             label: 'Fact Find Acknowledgement',          category: 'consents' },
  { key: 'best_interest_duty',        label: 'Best Interest Duty Record',          category: 'compliance' },
  { key: 'credit_proposal',           label: 'Credit Proposal Disclosure',         category: 'compliance' },
  { key: 'fee_disclosure',            label: 'Fee Disclosure',                     category: 'compliance' },
  { key: 'voi_record',                label: 'Verification of Identity (VOI)',     category: 'identity' },
  { key: 'preliminary_assessment',    label: 'Preliminary Assessment Letter',      category: 'assessment' },
  { key: 'serviceability_evidence',   label: 'Serviceability / Income Evidence',   category: 'assessment' },
  { key: 'credit_check',              label: 'Credit Check Report',                category: 'assessment' },
] as const;

function jsonWithHeaders(d: unknown, responseCorsHeaders: Record<string, string>, s = 200) {
  return new Response(JSON.stringify(d), { status: s, headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' } });
}

async function runOcrAntiTamper(documentUrl: string | null, label: string, lovableKey: string) {
  if (!documentUrl) return { ok: false, error: 'no document_url' };
  try {
    const res = await meteredFetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${lovableKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: 'You are a document compliance examiner. OCR the document, then assess authenticity. Return strict JSON.' },
          { role: 'user', content: [
            { type: 'text', text: `Examine this document (label: ${label}). OCR all visible text. Then assess: (1) detected_doc_type (payslip/bank_statement/id/contract/other), (2) detected_name (primary person), (3) detected_date (issue/payslip period), (4) expires_at (if applicable), (5) tamper_score 0-1 where 1 = high suspicion of editing (font mismatch, alignment drift, copy-paste blocks, inconsistent metadata), (6) findings[] list of {severity:'info'|'warn'|'fail', message}, (7) ai_summary one-line plain English. Return JSON: {ocr_text, detected_doc_type, detected_name, detected_date, expires_at, tamper_score, findings, ai_summary}.` },
            { type: 'image_url', image_url: { url: documentUrl } },
          ]},
        ],
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) return { ok: false, error: `ai ${res.status}` };
    const j = await res.json();
    const content = j?.choices?.[0]?.message?.content;
    const parsed = typeof content === 'string' ? JSON.parse(content) : content;
    return { ok: true, parsed };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'ai-failed' };
  }
}

async function buildNccpManifest(supabase: any, purchaseFileId: string) {
  // Look up presence signals for each required item.
  const [{ data: sigs }, { data: vois }, { data: credits }, { data: instances }] = await Promise.all([
    supabase.from('purchase_file_discovery_signatures').select('doc_type,status,signed_at,document_url').eq('purchase_file_id', purchaseFileId),
    supabase.from('purchase_file_voi_verifications').select('status,completed_at,provider').eq('purchase_file_id', purchaseFileId).order('completed_at', { ascending: false }),
    supabase.from('purchase_file_credit_checks').select('status,ran_at,provider').eq('purchase_file_id', purchaseFileId).order('ran_at', { ascending: false }),
    supabase.from('document_requirement_instances').select('category,status,label').eq('purchase_file_id', purchaseFileId),
  ]);
  const sigOk = (t: string) => (sigs || []).some((s: any) => s.doc_type === t && s.status === 'signed');
  const incomeOk = (instances || []).some((d: any) => /income|payslip|tax/i.test(d.label || d.category || '') && d.status === 'received');
  const voiOk = (vois || []).some((v: any) => v.status === 'passed');
  const creditOk = (credits || []).some((c: any) => c.status === 'complete');

  const manifest = NCCP_REQUIRED.map(item => {
    let present = false;
    let source = '';
    switch (item.key) {
      case 'privacy_consent':         present = sigOk('privacy_consent');     source = 'discovery_signatures'; break;
      case 'credit_guide':            present = sigOk('credit_guide');        source = 'discovery_signatures'; break;
      case 'fact_find_ack':           present = sigOk('fact_find_ack');       source = 'discovery_signatures'; break;
      case 'best_interest_duty':      present = sigOk('best_interest_duty');  source = 'discovery_signatures'; break;
      case 'credit_proposal':         present = sigOk('credit_proposal');     source = 'discovery_signatures'; break;
      case 'fee_disclosure':          present = sigOk('fee_disclosure');      source = 'discovery_signatures'; break;
      case 'voi_record':              present = voiOk;                        source = 'voi_verifications'; break;
      case 'credit_check':            present = creditOk;                     source = 'credit_checks'; break;
      case 'serviceability_evidence': present = incomeOk;                     source = 'document_requirement_instances'; break;
      case 'preliminary_assessment':  present = false;                        source = 'manual'; break;
    }
    return { ...item, present, source };
  });
  const missing = manifest.filter(m => !m.present);
  const completeness = manifest.length ? Math.round((manifest.length - missing.length) / manifest.length * 100) : 0;
  return { manifest, missing, completeness };
}

Deno.serve(async (req) => {
  const corsHeaders = { ...__createCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Headers': corsHeaderDefaults['Access-Control-Allow-Headers'], 'Access-Control-Expose-Headers': corsHeaderDefaults['Access-Control-Expose-Headers'] };
  const json = (data: any, status = 200) => jsonWithHeaders(data, corsHeaders, status);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const body = await req.json().catch(() => ({}));
    const operation = body.operation as string | undefined;
    if (!operation) return json({ error: 'operation required' }, 400);

    // The session may arrive in the HttpOnly `__Host-finance_session_token`
    // cookie, which is the only place the client has it from the second page
    // view onwards. A cookie is ambient on cross-site requests (SameSite=None),
    // so honouring one requires the origin allow-list; a header or body
    // credential cannot be forged cross-site and stays unguarded.
    // See docs/agreements/PARTNER_SESSION_TRANSPORT.md.
    const credential = extractFinanceCredential(req.headers, body);
    if (credential.source === 'cookie') {
      const csrf = enforceCsrf(req);
      if (!csrf.ok) return csrfDenied(corsHeaders, csrf);
    }
    const token = credential.token;
    if (!token) return json({ error: 'Finance session token required' }, 401);
    const { data: portalUser } = await supabase.from('finance_portal_users')
      .select('id, email, is_active, revoked_at, session_expires_at')
      .eq('session_token', token).maybeSingle();
    if (!portalUser || !portalUser.is_active || portalUser.revoked_at) return json({ error: 'Invalid session' }, 401);
    if (!portalUser.session_expires_at || new Date(portalUser.session_expires_at) < new Date()) return json({ error: 'Session expired' }, 401);

    const requireFileAccess = async (purchaseFileId: string) =>
      canAccessPurchaseFile(supabase, portalUser.id, purchaseFileId);
    const requireResourceAccess = async (table: string, resourceId: string) =>
      canAccessPurchaseFileResource(supabase, portalUser.id, table, resourceId);

    /* ===== #38 Doc Compliance Checks ===== */
    if (operation === 'compliance_list') {
      const fid = body.purchase_file_id;
      if (!fid) return json({ error: 'purchase_file_id required' }, 400);
      if (!await requireFileAccess(fid)) return json({ error: 'Not authorised' }, 403);
      const { data, error } = await supabase.from('purchase_file_doc_compliance_checks')
        .select('*').eq('purchase_file_id', fid).order('ran_at', { ascending: false });
      if (error) return json({ error: error.message }, 500);
      return json({ checks: data || [] });
    }
    if (operation === 'compliance_run_check') {
      const fid = body.purchase_file_id;
      const documentId: string | undefined = body.document_id;
      const instId: string | undefined = body.requirement_instance_id;
      const label: string = body.label || 'document';
      const documentUrl: string | null = body.document_url || null;
      if (!fid) return json({ error: 'purchase_file_id required' }, 400);
      if (!await requireFileAccess(fid)) return json({ error: 'Not authorised' }, 403);

      const { data: rec, error: insErr } = await supabase.from('purchase_file_doc_compliance_checks').insert({
        purchase_file_id: fid, document_id: documentId ?? null, requirement_instance_id: instId ?? null,
        status: 'running', ran_by: portalUser.id, check_type: 'ocr_anti_tamper',
      }).select().single();
      if (insErr) return json({ error: insErr.message }, 500);

      const lovableKey = Deno.env.get('LOVABLE_API_KEY') || '';
      const aiRes = await runOcrAntiTamper(documentUrl, label, lovableKey);

      const patch: any = { status: 'error' };
      if (aiRes.ok && aiRes.parsed) {
        const p = aiRes.parsed;
        const tamper = Number(p.tamper_score ?? 0);
        const findings = Array.isArray(p.findings) ? p.findings : [];
        const hasFail = findings.some((f: any) => f?.severity === 'fail') || tamper > 0.7;
        const hasWarn = findings.some((f: any) => f?.severity === 'warn') || tamper > 0.35;
        patch.status = hasFail ? 'failed' : hasWarn ? 'warning' : 'passed';
        patch.ocr_text = p.ocr_text ?? null;
        patch.ai_summary = p.ai_summary ?? null;
        patch.detected_doc_type = p.detected_doc_type ?? null;
        patch.detected_name = p.detected_name ?? null;
        patch.detected_date = p.detected_date ?? null;
        patch.expires_at = p.expires_at ?? null;
        patch.tamper_score = isFinite(tamper) ? tamper : null;
        patch.findings = findings;
      } else {
        patch.findings = [{ severity: 'fail', message: aiRes.error || 'AI examination failed' }];
      }
      const { data: updated } = await supabase.from('purchase_file_doc_compliance_checks')
        .update(patch).eq('id', rec.id).select().single();
      return json({ check: updated });
    }

    /* ===== #39 VOI ===== */
    if (operation === 'voi_list') {
      const fid = body.purchase_file_id;
      if (!fid) return json({ error: 'purchase_file_id required' }, 400);
      if (!await requireFileAccess(fid)) return json({ error: 'Not authorised' }, 403);
      const { data, error } = await supabase.from('purchase_file_voi_verifications')
        .select('*').eq('purchase_file_id', fid).order('created_at', { ascending: false });
      if (error) return json({ error: error.message }, 500);
      return json({ verifications: data || [] });
    }
    if (operation === 'voi_create') {
      const fid = body.purchase_file_id;
      if (!fid) return json({ error: 'purchase_file_id required' }, 400);
      if (!await requireFileAccess(fid)) return json({ error: 'Not authorised' }, 403);
      const provider = body.provider || 'stub';
      const token = crypto.randomUUID();
      const verification_url = provider === 'stub'
        ? `https://voi.stub.local/start/${token}`
        : null;
      const { data, error } = await supabase.from('purchase_file_voi_verifications').insert({
        purchase_file_id: fid, applicant_id: body.applicant_id ?? null, client_id: body.client_id ?? null,
        provider, provider_ref: token, status: 'sent', verification_url,
        initiated_by: portalUser.id, expires_at: new Date(Date.now() + 14 * 86400000).toISOString(),
      }).select().single();
      if (error) return json({ error: error.message }, 500);
      return json({ verification: data });
    }
    if (operation === 'voi_update_status') {
      const id = body.id; const status = body.status;
      if (!id || !status) return json({ error: 'id and status required' }, 400);
      if (!await requireResourceAccess('purchase_file_voi_verifications', id)) return json({ error: 'Not authorised' }, 403);
      const patch: any = { status };
      if (status === 'passed' || status === 'failed') patch.completed_at = new Date().toISOString();
      if (body.selfie_match != null) patch.selfie_match = !!body.selfie_match;
      if (body.notes) patch.notes = body.notes;
      const { data, error } = await supabase.from('purchase_file_voi_verifications')
        .update(patch).eq('id', id).select().single();
      if (error) return json({ error: error.message }, 500);
      return json({ verification: data });
    }

    /* ===== #40 Bank Statement Connector ===== */
    if (operation === 'bank_stmts_list') {
      const fid = body.purchase_file_id;
      if (!fid) return json({ error: 'purchase_file_id required' }, 400);
      if (!await requireFileAccess(fid)) return json({ error: 'Not authorised' }, 403);
      const { data, error } = await supabase.from('purchase_file_bank_statement_requests')
        .select('*').eq('purchase_file_id', fid).order('created_at', { ascending: false });
      if (error) return json({ error: error.message }, 500);
      return json({ requests: data || [] });
    }
    if (operation === 'bank_stmts_request') {
      const fid = body.purchase_file_id;
      if (!fid) return json({ error: 'purchase_file_id required' }, 400);
      if (!await requireFileAccess(fid)) return json({ error: 'Not authorised' }, 403);
      const provider = body.provider || 'illion';
      const period_days = Number(body.period_days || 90);
      const ref = crypto.randomUUID();
      const consent_url = `https://bank-stmts.stub.local/${provider}/consent/${ref}`;
      const { data, error } = await supabase.from('purchase_file_bank_statement_requests').insert({
        purchase_file_id: fid, applicant_id: body.applicant_id ?? null, client_id: body.client_id ?? null,
        provider, provider_ref: ref, status: 'sent', consent_url, period_days,
        initiated_by: portalUser.id,
      }).select().single();
      if (error) return json({ error: error.message }, 500);
      return json({ request: data });
    }
    if (operation === 'bank_stmts_update_status') {
      const id = body.id; const status = body.status;
      if (!id || !status) return json({ error: 'id and status required' }, 400);
      if (!await requireResourceAccess('purchase_file_bank_statement_requests', id)) return json({ error: 'Not authorised' }, 403);
      const patch: any = { status };
      if (status === 'received') {
        patch.statements_received_at = new Date().toISOString();
        if (body.account_count != null) patch.account_count = Number(body.account_count);
      }
      if (body.notes) patch.notes = body.notes;
      const { data, error } = await supabase.from('purchase_file_bank_statement_requests')
        .update(patch).eq('id', id).select().single();
      if (error) return json({ error: error.message }, 500);
      return json({ request: data });
    }

    /* ===== #41 Credit Checks ===== */
    if (operation === 'credit_list') {
      const fid = body.purchase_file_id;
      if (!fid) return json({ error: 'purchase_file_id required' }, 400);
      if (!await requireFileAccess(fid)) return json({ error: 'Not authorised' }, 403);
      const { data, error } = await supabase.from('purchase_file_credit_checks')
        .select('*').eq('purchase_file_id', fid).order('created_at', { ascending: false });
      if (error) return json({ error: error.message }, 500);
      return json({ checks: data || [] });
    }
    if (operation === 'credit_create') {
      const fid = body.purchase_file_id;
      if (!fid) return json({ error: 'purchase_file_id required' }, 400);
      if (!await requireFileAccess(fid)) return json({ error: 'Not authorised' }, 403);
      if (!body.consent_given) return json({ error: 'consent_given required' }, 400);
      const provider = body.provider || 'stub';
      const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
      const { data, error } = await supabase.from('purchase_file_credit_checks').insert({
        purchase_file_id: fid, applicant_id: body.applicant_id ?? null, client_id: body.client_id ?? null,
        provider, status: 'consent_sent',
        consent_given_at: new Date().toISOString(),
        consent_ip: ip,
        consent_proof: { source: 'finance_portal', user_id: portalUser.id, user_email: portalUser.email },
        initiated_by: portalUser.id,
      }).select().single();
      if (error) return json({ error: error.message }, 500);
      return json({ check: data });
    }
    if (operation === 'credit_record_result') {
      const id = body.id;
      if (!id) return json({ error: 'id required' }, 400);
      if (!await requireResourceAccess('purchase_file_credit_checks', id)) return json({ error: 'Not authorised' }, 403);
      const patch: any = {
        status: body.status || 'complete',
        ran_at: new Date().toISOString(),
      };
      if (body.score != null) patch.score = Number(body.score);
      if (body.band) patch.band = body.band;
      if (body.report_url) patch.report_url = body.report_url;
      if (body.raw) patch.raw = body.raw;
      if (body.notes) patch.notes = body.notes;
      const { data, error } = await supabase.from('purchase_file_credit_checks')
        .update(patch).eq('id', id).select().single();
      if (error) return json({ error: error.message }, 500);
      return json({ check: data });
    }

    /* ===== #42 Discovery Signatures (DocuSign-ready) ===== */
    if (operation === 'discovery_list') {
      const fid = body.purchase_file_id;
      if (!fid) return json({ error: 'purchase_file_id required' }, 400);
      if (!await requireFileAccess(fid)) return json({ error: 'Not authorised' }, 403);
      const { data, error } = await supabase.from('purchase_file_discovery_signatures')
        .select('*').eq('purchase_file_id', fid).order('created_at', { ascending: false });
      if (error) return json({ error: error.message }, 500);
      return json({ signatures: data || [] });
    }
    if (operation === 'discovery_send') {
      const fid = body.purchase_file_id;
      const doc_type = body.doc_type;
      if (!fid || !doc_type) return json({ error: 'purchase_file_id and doc_type required' }, 400);
      if (!await requireFileAccess(fid)) return json({ error: 'Not authorised' }, 403);
      const provider = body.provider || (Deno.env.get('DOCUSIGN_ACCESS_TOKEN') ? 'docusign' : 'stub');
      const envelope_id = provider === 'docusign'
        ? `pending-${crypto.randomUUID()}` // real envelope creation handled by existing DocuSign worker; this records intent
        : `stub-${crypto.randomUUID()}`;
      const { data, error } = await supabase.from('purchase_file_discovery_signatures').insert({
        purchase_file_id: fid, applicant_id: body.applicant_id ?? null, client_id: body.client_id ?? null,
        doc_type, doc_label: body.doc_label ?? null,
        provider, envelope_id, status: 'sent',
        recipient_email: body.recipient_email ?? null, recipient_name: body.recipient_name ?? null,
        sent_at: new Date().toISOString(),
        initiated_by: portalUser.id,
        metadata: body.metadata ?? {},
      }).select().single();
      if (error) return json({ error: error.message }, 500);
      return json({ signature: data });
    }
    if (operation === 'discovery_update_status') {
      const id = body.id; const status = body.status;
      if (!id || !status) return json({ error: 'id and status required' }, 400);
      if (!await requireResourceAccess('purchase_file_discovery_signatures', id)) return json({ error: 'Not authorised' }, 403);
      const patch: any = { status };
      if (status === 'signed') patch.signed_at = new Date().toISOString();
      if (body.document_url) patch.document_url = body.document_url;
      const { data, error } = await supabase.from('purchase_file_discovery_signatures')
        .update(patch).eq('id', id).select().single();
      if (error) return json({ error: error.message }, 500);
      return json({ signature: data });
    }

    /* ===== #43 NCCP Compliance Vault ===== */
    if (operation === 'nccp_list') {
      const fid = body.purchase_file_id;
      if (!fid) return json({ error: 'purchase_file_id required' }, 400);
      if (!await requireFileAccess(fid)) return json({ error: 'Not authorised' }, 403);
      const { data, error } = await supabase.from('purchase_file_nccp_bundles')
        .select('*').eq('purchase_file_id', fid).order('generated_at', { ascending: false });
      if (error) return json({ error: error.message }, 500);
      return json({ bundles: data || [] });
    }
    if (operation === 'nccp_build') {
      const fid = body.purchase_file_id;
      if (!fid) return json({ error: 'purchase_file_id required' }, 400);
      if (!await requireFileAccess(fid)) return json({ error: 'Not authorised' }, 403);
      const { manifest, missing, completeness } = await buildNccpManifest(supabase, fid);
      const { data, error } = await supabase.from('purchase_file_nccp_bundles').insert({
        purchase_file_id: fid,
        status: missing.length === 0 ? 'ready' : 'draft',
        manifest, missing_items: missing, completeness_pct: completeness,
        generated_by: portalUser.id,
      }).select().single();
      if (error) return json({ error: error.message }, 500);
      return json({ bundle: data });
    }
    if (operation === 'nccp_archive') {
      const id = body.id;
      if (!id) return json({ error: 'id required' }, 400);
      if (!await requireResourceAccess('purchase_file_nccp_bundles', id)) return json({ error: 'Not authorised' }, 403);
      const { data, error } = await supabase.from('purchase_file_nccp_bundles')
        .update({ status: 'archived' }).eq('id', id).select().single();
      if (error) return json({ error: error.message }, 500);
      return json({ bundle: data });
    }

    return json({ error: `Unknown operation: ${operation}` }, 400);
  } catch (e: any) {
    return json({ ...internalError(e, 'finance-portal-batch7') }, 500);
  }
});

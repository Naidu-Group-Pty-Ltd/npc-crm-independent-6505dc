/**
 * Finance Portal — Document Requirements Matrix (Phase 2)
 * Operations:
 *   list_templates              -> { templates }  (filtered by purchase_type, optional)
 *   list_requirements           -> { requirements }  (for a purchase_file_id)
 *   instantiate_from_template   -> { inserted }    (seeds a file with the default checklist)
 *   add_requirement             -> { requirement } (custom row)
 *   update_requirement          -> { requirement }
 *   delete_requirement          -> { ok }
 *   request_from_client         -> { notified, requirement_ids }
 *   link_document               -> { requirement }
 *   set_status                  -> { requirement }
 *   verify_requirement          -> { requirement }
 *
 * Auth & permission gating mirror finance-portal-purchase-files:
 *   session-token → finance_portal_users → assignment → mergePermissions
 * Permission key: `documents` (view/edit/delete). Default-allow when matrix omits it.
 */
import { createClient } from "npm:@supabase/supabase-js@2.55.0";
import { notifyFinancePortalAssignees } from "../_shared/finance-portal-notify.ts";

import { createCorsHeaders as __createCorsHeaders } from "../_shared/auth.ts";
import { internalError } from '../_shared/errorResponse.ts';
import { extractFinanceSessionToken } from '../_shared/financeSessionToken.ts';
// Dynamic per-request CORS — frontend uses `credentials: 'include'`, so ACAO must
// echo the request Origin (never `*`) with `Allow-Credentials: true`.
const corsHeaderDefaults: Record<string, string> = {
  ...__createCorsHeaders(null),
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-finance-session-token, x-session-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

const REQ_COLUMNS = [
  'category','label','description','owner','status','is_required','sort_order',
  'visible_to_client','visible_to_finance','visible_to_npc','visible_to_legal',
  'expiry_date','notes','document_id','soft_expiry_date',
];

/* ── Category → quality rules (lender-neutral defaults) ── */
const CATEGORY_RULES: Record<string, { maxAgeDays: number; expectedTypes: string[]; preferPdf?: boolean }> = {
  income_payg:           { maxAgeDays: 60,  expectedTypes: ['payslip'] },
  income_self_employed:  { maxAgeDays: 365, expectedTypes: ['tax_return','bas','financials'] },
  bank_statements:       { maxAgeDays: 30,  expectedTypes: ['bank_statement'], preferPdf: true },
  existing_loans:        { maxAgeDays: 60,  expectedTypes: ['loan_statement'], preferPdf: true },
  identity:              { maxAgeDays: 1825, expectedTypes: ['drivers_licence','passport','medicare'] },
  deposit_proof:         { maxAgeDays: 30,  expectedTypes: ['bank_statement','gift_letter'] },
  valuation:             { maxAgeDays: 90,  expectedTypes: ['valuation_report'], preferPdf: true },
  loan_approval:         { maxAgeDays: 90,  expectedTypes: ['approval_letter'], preferPdf: true },
  purchase_docs:         { maxAgeDays: 365, expectedTypes: ['contract','section_32'], preferPdf: true },
  assets:                { maxAgeDays: 90,  expectedTypes: ['statement','valuation'] },
  liabilities:           { maxAgeDays: 60,  expectedTypes: ['loan_statement','credit_card_statement'] },
  settlement:            { maxAgeDays: 30,  expectedTypes: ['settlement_statement'], preferPdf: true },
  other:                 { maxAgeDays: 365, expectedTypes: [] },
};

function detectDocTypeFromFilename(filename: string): string | null {
  const n = filename.toLowerCase();
  if (/payslip|pay\s*slip|pay[-_ ]?stub/.test(n)) return 'payslip';
  if (/tax[-_ ]?return|notice.?of.?assessment|noa/.test(n)) return 'tax_return';
  if (/bas\b/.test(n)) return 'bas';
  if (/bank.?statement|statement.*bank|trans[-_ ]?list/.test(n)) return 'bank_statement';
  if (/loan.?statement|home.?loan/.test(n)) return 'loan_statement';
  if (/credit.?card/.test(n)) return 'credit_card_statement';
  if (/licen[cs]e|driver/.test(n)) return 'drivers_licence';
  if (/passport/.test(n)) return 'passport';
  if (/medicare/.test(n)) return 'medicare';
  if (/contract|section.?32|sale/.test(n)) return 'contract';
  if (/valuation/.test(n)) return 'valuation_report';
  if (/approval|loa\b/.test(n)) return 'approval_letter';
  if (/settlement/.test(n)) return 'settlement_statement';
  if (/gift/.test(n)) return 'gift_letter';
  return null;
}

function detectDateFromFilename(filename: string): string | null {
  // Matches YYYY-MM-DD, YYYYMMDD, DD-MM-YYYY, DD_MM_YYYY
  const m1 = filename.match(/(20\d{2})[-_./ ]?(\d{2})[-_./ ]?(\d{2})/);
  if (m1) {
    const [_, y, mo, d] = m1;
    const dt = new Date(`${y}-${mo}-${d}`);
    if (!isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  }
  const m2 = filename.match(/(\d{2})[-_./ ](\d{2})[-_./ ](20\d{2})/);
  if (m2) {
    const [_, d, mo, y] = m2;
    const dt = new Date(`${y}-${mo}-${d}`);
    if (!isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  }
  return null;
}

function assessQuality(args: {
  category: string;
  filename: string;
  mimeType: string;
  fileSize: number;
  uploadedAt: string;
  detectedDate: string | null;
}): { status: 'ok'|'warning'|'error'; flags: any[]; softExpiry: string | null; detectedType: string | null } {
  const rule = CATEGORY_RULES[args.category] || CATEGORY_RULES.other;
  const flags: any[] = [];

  const detectedType = detectDocTypeFromFilename(args.filename);
  if (rule.expectedTypes.length > 0 && detectedType && !rule.expectedTypes.includes(detectedType)) {
    flags.push({
      code: 'wrong_type',
      severity: 'error',
      message: `Filename suggests ${detectedType.replace(/_/g, ' ')} but ${args.category.replace(/_/g, ' ')} expected.`,
    });
  }

  // Image quality / format hints
  if (rule.preferPdf && args.mimeType && !args.mimeType.includes('pdf')) {
    flags.push({
      code: 'prefer_pdf',
      severity: 'warning',
      message: 'PDF preferred — image uploads can be rejected by lender packagers.',
    });
  }
  if (args.mimeType?.startsWith('image/') && args.fileSize < 120 * 1024) {
    flags.push({
      code: 'low_resolution',
      severity: 'warning',
      message: 'Image is small (<120KB). Likely too low-resolution for the lender.',
    });
  }

  // Staleness
  const referenceDate = args.detectedDate || args.uploadedAt;
  const ageMs = Date.now() - new Date(referenceDate).getTime();
  const ageDays = Math.floor(ageMs / 86400000);
  if (ageDays > rule.maxAgeDays) {
    flags.push({
      code: 'stale',
      severity: 'error',
      message: `Dated ${ageDays} days ago — exceeds the ${rule.maxAgeDays}-day window for ${args.category.replace(/_/g, ' ')}.`,
    });
  } else if (ageDays > Math.round(rule.maxAgeDays * 0.75)) {
    flags.push({
      code: 'aging',
      severity: 'warning',
      message: `Dated ${ageDays} days ago — approaching the ${rule.maxAgeDays}-day window.`,
    });
  }

  // Soft expiry
  const base = args.detectedDate ? new Date(args.detectedDate) : new Date(args.uploadedAt);
  const expiry = new Date(base.getTime() + rule.maxAgeDays * 86400000);
  const softExpiry = expiry.toISOString().slice(0, 10);

  const errorCount = flags.filter(f => f.severity === 'error').length;
  const status: 'ok'|'warning'|'error' = errorCount > 0 ? 'error' : (flags.length > 0 ? 'warning' : 'ok');
  return { status, flags, softExpiry, detectedType };
}


function jsonResponseWithHeaders(data: any, responseCorsHeaders: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
  });
}

// Delegates to the ONE cookie-aware reader. The local body used to read only
// the header and the request body, so a portal whose session lives in the
// HttpOnly `__Host-finance_session_token` cookie (WP-11B/C) got a 401 on
// every call once its in-memory token was lost to a page load.
function extractToken(headers: Headers, body?: any): string | null {
  return extractFinanceSessionToken(headers, body as Record<string, unknown> | undefined);
}

function mergePermissions(global: any, perClient: any) {
  const out: Record<string, { view: boolean; edit: boolean; delete: boolean }> = {};
  const keys = new Set<string>([
    ...Object.keys(global && typeof global === 'object' ? global : {}),
    ...Object.keys(perClient && typeof perClient === 'object' ? perClient : {}),
  ]);
  for (const k of keys) {
    const g = (global && global[k]) || {};
    const p = (perClient && perClient[k]) || {};
    out[k] = {
      view: !!(g.view || p.view),
      edit: !!(g.edit || p.edit),
      delete: !!(g.delete || p.delete),
    };
  }
  return out;
}

function pickAllowed(payload: any, allowed: string[]) {
  const out: Record<string, any> = {};
  if (!payload || typeof payload !== 'object') return out;
  for (const k of allowed) if (k in payload) out[k] = payload[k];
  return out;
}

Deno.serve(async (req) => {
  const corsHeaders = { ...__createCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Headers': corsHeaderDefaults['Access-Control-Allow-Headers'], 'Access-Control-Expose-Headers': corsHeaderDefaults['Access-Control-Expose-Headers'] };
  const jsonResponse = (data: any, status = 200) => jsonResponseWithHeaders(data, corsHeaders, status);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({}));
    const sessionToken = extractToken(req.headers, body);
    if (!sessionToken) return jsonResponse({ error: 'Session token required' }, 401);

    const { data: portalUser } = await supabase
      .from('finance_portal_users')
      .select('id, email, is_active, revoked_at, session_expires_at, global_permissions')
      .eq('session_token', sessionToken)
      .maybeSingle();

    if (!portalUser || !portalUser.is_active || portalUser.revoked_at) {
      return jsonResponse({ error: 'Invalid session' }, 401);
    }
    if (!portalUser.session_expires_at || new Date(portalUser.session_expires_at) < new Date()) {
      return jsonResponse({ error: 'Session expired' }, 401);
    }

    const { operation } = body;
    if (!operation) return jsonResponse({ error: 'operation required' }, 400);

    async function getEffectivePermissions(clientId: string) {
      const { data: assignment } = await supabase
        .from('finance_portal_client_assignments')
        .select('permissions')
        .eq('finance_user_id', portalUser.id)
        .eq('client_id', clientId)
        .maybeSingle();
      if (!assignment) return null;
      const merged = mergePermissions(portalUser.global_permissions, assignment.permissions);
      const globalHas = portalUser.global_permissions && (portalUser.global_permissions as any).documents;
      const clientHas = assignment.permissions && (assignment.permissions as any).documents;
      if (!globalHas && !clientHas) {
        merged.documents = { view: true, edit: true, delete: false };
      }
      return merged;
    }

    async function loadFile(fileId: string) {
      const { data } = await supabase
        .from('purchase_files')
        .select('id, client_id, title, purchase_type')
        .eq('id', fileId)
        .maybeSingle();
      return data;
    }

    /* ── list_templates ── */
    if (operation === 'list_templates') {
      const purchaseType = body.purchase_type;
      let q = supabase.from('document_requirement_templates').select('*').eq('is_active', true).order('sort_order');
      if (purchaseType) q = q.eq('purchase_type', purchaseType);
      const { data, error } = await q;
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ templates: data });
    }

    /* ── list_requirements (per purchase file) ── */
    if (operation === 'list_requirements') {
      const fileId = body.purchase_file_id;
      if (!fileId) return jsonResponse({ error: 'purchase_file_id required' }, 400);
      const file = await loadFile(fileId);
      if (!file) return jsonResponse({ error: 'Not found' }, 404);
      const perms = await getEffectivePermissions(file.client_id);
      if (!perms?.documents?.view) return jsonResponse({ error: 'Forbidden' }, 403);

      const { data, error } = await supabase
        .from('document_requirement_instances')
        .select('*, finance_portal_documents(id, original_filename, storage_path, file_size, mime_type, created_at)')
        .eq('purchase_file_id', fileId)
        .order('category')
        .order('sort_order');
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ requirements: data });
    }

    /* ── instantiate_from_template (seed checklist) ── */
    if (operation === 'instantiate_from_template') {
      const fileId = body.purchase_file_id;
      if (!fileId) return jsonResponse({ error: 'purchase_file_id required' }, 400);
      const file = await loadFile(fileId);
      if (!file) return jsonResponse({ error: 'Not found' }, 404);
      const perms = await getEffectivePermissions(file.client_id);
      if (!perms?.documents?.edit) return jsonResponse({ error: 'Forbidden' }, 403);

      const { data: existing } = await supabase
        .from('document_requirement_instances')
        .select('template_id')
        .eq('purchase_file_id', fileId)
        .not('template_id', 'is', null);
      const existingTemplateIds = new Set((existing || []).map((r: any) => r.template_id));

      const { data: templates } = await supabase
        .from('document_requirement_templates')
        .select('*')
        .eq('purchase_type', file.purchase_type)
        .eq('is_active', true)
        .order('sort_order');

      const rows = (templates || [])
        .filter((t: any) => !existingTemplateIds.has(t.id))
        .map((t: any) => ({
          purchase_file_id: fileId,
          client_id: file.client_id,
          template_id: t.id,
          category: t.category,
          label: t.label,
          description: t.description,
          owner: t.default_owner,
          status: 'required',
          is_required: t.is_required,
          sort_order: t.sort_order,
          created_by_finance_user_id: portalUser.id,
        }));

      if (rows.length === 0) return jsonResponse({ inserted: 0 });
      const { data, error } = await supabase
        .from('document_requirement_instances')
        .insert(rows)
        .select();
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ inserted: data?.length || 0, requirements: data });
    }

    /* ── add_requirement (custom) ── */
    if (operation === 'add_requirement') {
      const fileId = body.purchase_file_id;
      const payload = body.payload || {};
      if (!fileId) return jsonResponse({ error: 'purchase_file_id required' }, 400);
      const file = await loadFile(fileId);
      if (!file) return jsonResponse({ error: 'Not found' }, 404);
      const perms = await getEffectivePermissions(file.client_id);
      if (!perms?.documents?.edit) return jsonResponse({ error: 'Forbidden' }, 403);

      const insert = pickAllowed(payload, REQ_COLUMNS);
      if (!insert.label) return jsonResponse({ error: 'label required' }, 400);
      if (!insert.category) insert.category = 'other';

      const { data, error } = await supabase
        .from('document_requirement_instances')
        .insert({
          ...insert,
          purchase_file_id: fileId,
          client_id: file.client_id,
          created_by_finance_user_id: portalUser.id,
        })
        .select()
        .single();
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ requirement: data });
    }

    /* ── update_requirement ── */
    if (operation === 'update_requirement') {
      const reqId = body.requirement_id;
      const payload = body.payload || {};
      if (!reqId) return jsonResponse({ error: 'requirement_id required' }, 400);

      const { data: existing } = await supabase
        .from('document_requirement_instances')
        .select('id, purchase_file_id, client_id')
        .eq('id', reqId)
        .maybeSingle();
      if (!existing) return jsonResponse({ error: 'Not found' }, 404);
      const perms = await getEffectivePermissions(existing.client_id);
      if (!perms?.documents?.edit) return jsonResponse({ error: 'Forbidden' }, 403);

      const update = pickAllowed(payload, REQ_COLUMNS);
      const { data, error } = await supabase
        .from('document_requirement_instances')
        .update(update)
        .eq('id', reqId)
        .select()
        .single();
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ requirement: data });
    }

    /* ── delete_requirement ── */
    if (operation === 'delete_requirement') {
      const reqId = body.requirement_id;
      if (!reqId) return jsonResponse({ error: 'requirement_id required' }, 400);
      const { data: existing } = await supabase
        .from('document_requirement_instances')
        .select('id, client_id')
        .eq('id', reqId)
        .maybeSingle();
      if (!existing) return jsonResponse({ error: 'Not found' }, 404);
      const perms = await getEffectivePermissions(existing.client_id);
      if (!perms?.documents?.delete && !perms?.documents?.edit) {
        return jsonResponse({ error: 'Forbidden' }, 403);
      }
      const { error } = await supabase
        .from('document_requirement_instances')
        .delete()
        .eq('id', reqId);
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ ok: true });
    }

    /* ── set_status (lightweight status changes incl. waive) ── */
    if (operation === 'set_status') {
      const reqId = body.requirement_id;
      const status = body.status;
      if (!reqId || !status) return jsonResponse({ error: 'requirement_id and status required' }, 400);
      const { data: existing } = await supabase
        .from('document_requirement_instances')
        .select('id, client_id')
        .eq('id', reqId)
        .maybeSingle();
      if (!existing) return jsonResponse({ error: 'Not found' }, 404);
      const perms = await getEffectivePermissions(existing.client_id);
      if (!perms?.documents?.edit) return jsonResponse({ error: 'Forbidden' }, 403);

      const { data, error } = await supabase
        .from('document_requirement_instances')
        .update({ status })
        .eq('id', reqId)
        .select()
        .single();
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ requirement: data });
    }

    /* ── verify_requirement ── */
    if (operation === 'verify_requirement') {
      const reqId = body.requirement_id;
      const unverify = !!body.unverify;
      if (!reqId) return jsonResponse({ error: 'requirement_id required' }, 400);
      const { data: existing } = await supabase
        .from('document_requirement_instances')
        .select('id, client_id, status')
        .eq('id', reqId)
        .maybeSingle();
      if (!existing) return jsonResponse({ error: 'Not found' }, 404);
      const perms = await getEffectivePermissions(existing.client_id);
      if (!perms?.documents?.edit) return jsonResponse({ error: 'Forbidden' }, 403);

      const update: Record<string, any> = unverify
        ? { verified_at: null, verified_by_finance_user_id: null, status: 'uploaded' }
        : { verified_at: new Date().toISOString(), verified_by_finance_user_id: portalUser.id, status: 'verified' };

      const { data, error } = await supabase
        .from('document_requirement_instances')
        .update(update)
        .eq('id', reqId)
        .select()
        .single();
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ requirement: data });
    }

    /* ── link_document (associates an uploaded finance_portal_documents row) ── */
    if (operation === 'link_document') {
      const reqId = body.requirement_id;
      const documentId = body.document_id;
      if (!reqId || !documentId) return jsonResponse({ error: 'requirement_id and document_id required' }, 400);
      const { data: existing } = await supabase
        .from('document_requirement_instances')
        .select('id, client_id')
        .eq('id', reqId)
        .maybeSingle();
      if (!existing) return jsonResponse({ error: 'Not found' }, 404);
      const perms = await getEffectivePermissions(existing.client_id);
      if (!perms?.documents?.edit) return jsonResponse({ error: 'Forbidden' }, 403);

      const { data, error } = await supabase
        .from('document_requirement_instances')
        .update({
          document_id: documentId,
          uploaded_at: new Date().toISOString(),
          status: 'uploaded',
        })
        .eq('id', reqId)
        .select()
        .single();
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ requirement: data });
    }

    /* ── request_from_client (multi-select trigger) ── */
    if (operation === 'request_from_client') {
      const fileId = body.purchase_file_id;
      const requirementIds: string[] = Array.isArray(body.requirement_ids) ? body.requirement_ids : [];
      const message: string | null = body.message || null;
      if (!fileId || requirementIds.length === 0) {
        return jsonResponse({ error: 'purchase_file_id and requirement_ids required' }, 400);
      }
      const file = await loadFile(fileId);
      if (!file) return jsonResponse({ error: 'Not found' }, 404);
      const perms = await getEffectivePermissions(file.client_id);
      if (!perms?.documents?.edit) return jsonResponse({ error: 'Forbidden' }, 403);

      const now = new Date().toISOString();
      const { data: updated, error: updErr } = await supabase
        .from('document_requirement_instances')
        .update({
          status: 'requested',
          requested_at: now,
          requested_by_finance_user_id: portalUser.id,
          request_message: message,
          visible_to_client: true,
        })
        .in('id', requirementIds)
        .eq('purchase_file_id', fileId)
        .select();
      if (updErr) return jsonResponse({ error: updErr.message }, 500);

      const labels = (updated || []).map((r: any) => r.label).slice(0, 5).join(', ');
      const more = (updated || []).length > 5 ? ` +${updated!.length - 5} more` : '';

      // Notify NPC team-side assignees (mirror finance partners working alongside)
      try {
        await notifyFinancePortalAssignees({
          client_id: file.client_id,
          notification_type: 'document_requirement_requested',
          title: `Documents requested on ${file.title}`,
          body: `${(updated || []).length} item(s) requested from client: ${labels}${more}`,
          link_path: `/finance/purchase-files/${fileId}?tab=documents`,
          metadata: { purchase_file_id: fileId, requirement_ids: requirementIds },
          exclude_portal_user_id: portalUser.id,
        });
      } catch (e) {
        console.warn('[document-requirements] notify failed', e);
      }

      // Client-side surfacing (portal dashboard widget) reads `document_requirement_instances`
      // directly via realtime — no separate notification row needed here.


      return jsonResponse({ requirement_ids: requirementIds, notified: (updated || []).length });
    }

    /* ── analyze_quality (C1) ── */
    if (operation === 'analyze_quality') {
      const reqId = body.requirement_id;
      if (!reqId) return jsonResponse({ error: 'requirement_id required' }, 400);
      const { data: req } = await supabase
        .from('document_requirement_instances')
        .select('id, category, client_id, document_id, finance_portal_documents(id, original_filename, mime_type, file_size, created_at)')
        .eq('id', reqId)
        .maybeSingle();
      if (!req) return jsonResponse({ error: 'Not found' }, 404);
      const perms = await getEffectivePermissions(req.client_id);
      if (!perms?.documents?.edit) return jsonResponse({ error: 'Forbidden' }, 403);
      const doc: any = req.finance_portal_documents;
      if (!doc) return jsonResponse({ error: 'No linked document to analyze' }, 400);

      const detectedDate = detectDateFromFilename(doc.original_filename);
      const result = assessQuality({
        category: req.category,
        filename: doc.original_filename || '',
        mimeType: doc.mime_type || '',
        fileSize: doc.file_size || 0,
        uploadedAt: doc.created_at || new Date().toISOString(),
        detectedDate,
      });

      const { data: updated, error } = await supabase
        .from('document_requirement_instances')
        .update({
          quality_status: result.status,
          quality_flags: result.flags,
          quality_checked_at: new Date().toISOString(),
          detected_doc_type: result.detectedType,
          detected_doc_date: detectedDate,
          soft_expiry_date: result.softExpiry,
        })
        .eq('id', reqId)
        .select()
        .single();
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ requirement: updated });
    }

    /* ── analyze_quality_bulk ── */
    if (operation === 'analyze_quality_bulk') {
      const fileId = body.purchase_file_id;
      if (!fileId) return jsonResponse({ error: 'purchase_file_id required' }, 400);
      const file = await loadFile(fileId);
      if (!file) return jsonResponse({ error: 'Not found' }, 404);
      const perms = await getEffectivePermissions(file.client_id);
      if (!perms?.documents?.edit) return jsonResponse({ error: 'Forbidden' }, 403);

      const { data: reqs } = await supabase
        .from('document_requirement_instances')
        .select('id, category, document_id, finance_portal_documents(id, original_filename, mime_type, file_size, created_at)')
        .eq('purchase_file_id', fileId)
        .not('document_id', 'is', null);

      let analyzed = 0;
      for (const r of (reqs || []) as any[]) {
        const doc = r.finance_portal_documents;
        if (!doc) continue;
        const detectedDate = detectDateFromFilename(doc.original_filename || '');
        const result = assessQuality({
          category: r.category,
          filename: doc.original_filename || '',
          mimeType: doc.mime_type || '',
          fileSize: doc.file_size || 0,
          uploadedAt: doc.created_at || new Date().toISOString(),
          detectedDate,
        });
        await supabase.from('document_requirement_instances').update({
          quality_status: result.status,
          quality_flags: result.flags,
          quality_checked_at: new Date().toISOString(),
          detected_doc_type: result.detectedType,
          detected_doc_date: detectedDate,
          soft_expiry_date: result.softExpiry,
        }).eq('id', r.id);
        analyzed++;
      }
      return jsonResponse({ analyzed });
    }

    /* ── list_message_templates (C2) ── */
    if (operation === 'list_message_templates') {
      const { data, error } = await supabase
        .from('finance_portal_doc_message_templates')
        .select('*')
        .or(`finance_user_id.is.null,finance_user_id.eq.${portalUser.id}`)
        .eq('is_active', true)
        .order('reason')
        .order('name');
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ templates: data || [] });
    }

    if (operation === 'upsert_message_template') {
      const payload = body.payload || {};
      if (!payload.name || !payload.reason || !payload.body) {
        return jsonResponse({ error: 'name, reason, body required' }, 400);
      }
      const row: any = {
        finance_user_id: portalUser.id,
        name: payload.name,
        reason: payload.reason,
        body: payload.body,
        is_active: payload.is_active !== false,
      };
      let q;
      if (payload.id) {
        q = supabase.from('finance_portal_doc_message_templates')
          .update(row).eq('id', payload.id).eq('finance_user_id', portalUser.id).select().single();
      } else {
        q = supabase.from('finance_portal_doc_message_templates').insert(row).select().single();
      }
      const { data, error } = await q;
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ template: data });
    }

    if (operation === 'delete_message_template') {
      const id = body.template_id;
      if (!id) return jsonResponse({ error: 'template_id required' }, 400);
      const { error } = await supabase
        .from('finance_portal_doc_message_templates')
        .delete().eq('id', id).eq('finance_user_id', portalUser.id);
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ ok: true });
    }

    /* ── list_expiring (C4 - dashboard widget) ── */
    if (operation === 'list_expiring') {
      const days = Math.min(180, Math.max(1, Number(body.within_days) || 30));
      const cutoff = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
      const { data: assignments } = await supabase
        .from('finance_portal_client_assignments')
        .select('client_id')
        .eq('finance_user_id', portalUser.id);
      const clientIds = (assignments || []).map((a: any) => a.client_id);
      if (clientIds.length === 0) return jsonResponse({ items: [] });

      const { data, error } = await supabase
        .from('document_requirement_instances')
        .select('id, label, category, status, soft_expiry_date, detected_doc_date, purchase_file_id, client_id, quality_status, purchase_files(title)')
        .in('client_id', clientIds)
        .not('soft_expiry_date', 'is', null)
        .lte('soft_expiry_date', cutoff)
        .neq('status', 'waived')
        .order('soft_expiry_date');
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ items: data || [] });
    }

    return jsonResponse({ error: `Unknown operation: ${operation}` }, 400);
  } catch (err: any) {
    return jsonResponse({ ...internalError(err, 'finance-portal-document-requirements') }, 500);
  }
});

// pdf-import-client-report — Phase 11G client-safe reporting / audit export.
//
// Generates SANITIZED client-safe report summaries from internal import state
// and manages their approval/export lifecycle. It NEVER calls AI, never mutates
// templates, never sends email, never creates public links, and never returns
// raw PDFs, screenshots, signed URLs, storage paths, raw OCR/extracted text,
// raw metadata JSON, or logs.
//
// Access: admin (pdf_admin) or superadmin (developer_admin), plus service-role.
//   generate_preview / save_draft / list_reports / review_report /
//   approve_report / reject_report / mark_exported / supersede_report

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import {
  verifyAuth,
  createTokenAuthCorsHeaders,
  createUnauthorizedResponse,
  createForbiddenResponse,
} from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TABLE = 'pdf_import_client_reports';
const VERSION = 'pdf-import-client-report-v1';

const DISALLOWED: Array<{ code: string; re: RegExp; reason: string }> = [
  { code: 'service_role_key', re: /SUPABASE_SERVICE_ROLE_KEY/gi, reason: 'service-role secret reference' },
  { code: 'service_role', re: /service_role/gi, reason: 'service-role reference' },
  { code: 'signed_url_marker', re: /signed[-_]?url/gi, reason: 'signed URL marker' },
  { code: 'storage_objects', re: /storage\.objects/gi, reason: 'storage table reference' },
  { code: 'artifact_bucket', re: /template-import-artifacts[^\s]*/gi, reason: 'storage bucket/object path' },
  { code: 'diagnostics_bucket', re: /pdf-import-diagnostics[^\s]*/gi, reason: 'diagnostics bucket/object path' },
  { code: 'signed_or_token_url', re: /https?:\/\/[^\s]*(?:token=|signature=|x-goog-signature|\?)[^\s]*/gi, reason: 'signed/tokenized URL' },
  { code: 'http_url', re: /https?:\/\/[^\s)]+/gi, reason: 'external URL' },
  { code: 'stack_trace', re: /(?:stack trace|traceback|at\s+\w+\s*\([^)]*:\d+:\d+\))/gi, reason: 'stack trace' },
  { code: 'sql_snippet', re: /\b(?:select\s+.+\s+from|insert\s+into|update\s+\w+\s+set|delete\s+from)\b/gi, reason: 'SQL snippet' },
  { code: 'raw_json_dump', re: /\{["'][^}]{60,}\}/g, reason: 'raw JSON-like payload' },
  { code: 'artifact_path_key', re: /\b\w*_artifact_path\b/gi, reason: 'artifact path reference' },
];
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

function sanitizeText(value: any, audience: string, field: string) {
  let v = String(value ?? '');
  const redactions: any[] = [];
  for (const { code, re, reason } of DISALLOWED) {
    const r = new RegExp(re.source, re.flags);
    if (r.test(v)) { v = v.replace(new RegExp(re.source, re.flags), '[redacted]'); redactions.push({ code, field, reason }); }
  }
  if (audience === 'external_client' && new RegExp(UUID_RE.source, 'gi').test(v)) {
    v = v.replace(new RegExp(UUID_RE.source, 'gi'), '[redacted]');
    redactions.push({ code: 'internal_uuid', field, reason: 'internal identifier removed for external audience' });
  }
  v = v.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return { value: v, redactions };
}

function sanitizePayload(p: any) {
  const audience = p.audience;
  const redactions: any[] = [...(p.redactions ?? [])];
  const t = sanitizeText(p.title, audience, 'title'); redactions.push(...t.redactions);
  const s = sanitizeText(p.summary, audience, 'summary'); redactions.push(...s.redactions);
  const sections = (p.sections ?? []).map((sec: any) => {
    const body = sanitizeText(sec.body, audience, `section.${sec.id}.body`); redactions.push(...body.redactions);
    const items: string[] = [];
    for (let i = 0; i < (sec.items ?? []).length; i++) {
      const it = sanitizeText(sec.items[i], audience, `section.${sec.id}.items[${i}]`); redactions.push(...it.redactions);
      if (it.value.trim()) items.push(it.value);
    }
    return { ...sec, body: body.value, items };
  });
  return { ...p, title: t.value || 'PDF import report', summary: s.value, sections, redactions };
}

function detectUnsafe(p: any): boolean {
  const texts: string[] = [p.title, p.summary];
  for (const sec of p.sections ?? []) { texts.push(sec.body); for (const it of sec.items ?? []) texts.push(it); }
  for (const v of texts) {
    for (const { re } of DISALLOWED) if (new RegExp(re.source, re.flags).test(String(v ?? ''))) return true;
    if (p.audience === 'external_client' && new RegExp(UUID_RE.source, 'gi').test(String(v ?? ''))) return true;
  }
  return false;
}

const DECISION_WORDING: Record<string, string> = {
  accepted: 'The template import passed quality review and is ready for use.',
  accepted_with_warnings: 'The template import has been accepted with minor layout warnings that do not block use.',
  rejected: 'The import did not meet quality requirements and requires rework.',
  needs_rerun: 'The import needs to be re-run before it can be approved.',
  manual_review_required: 'The template requires manual review before it can be approved.',
  blocked: 'The import is on hold pending internal review.',
  not_reviewed: 'The import has not yet been reviewed.',
};
const QUALITY_WORDING: Record<string, string> = { pass: 'Quality checks passed.', warning: 'Quality checks passed with minor warnings.', fail: 'Quality checks did not pass.', blocked: 'Quality checks are on hold.', not_evaluated: 'Quality checks have not been evaluated yet.' };
const EXPORT_WORDING: Record<string, string> = { completed: 'Export validation completed successfully.', partial: 'Export validation partially completed.', manual_required: 'Export validation requires manual review.', failed: 'Export validation did not pass.', not_ready: 'Export validation is pending.', missing: 'Export validation is pending.' };
const TYPE_LABELS: Record<string, string> = {
  import_status_summary: 'Template Import Status Summary', template_quality_summary: 'Template Quality Summary',
  manual_review_summary: 'Manual Review Summary', accepted_with_warnings_summary: 'Accepted With Warnings Summary',
  rejected_import_summary: 'Import Rejected Summary', production_audit_summary: 'Production Audit Summary', release_readiness_summary: 'Release Readiness Summary',
};
const CLIENT_FACING = new Set(['import_status_summary', 'template_quality_summary', 'manual_review_summary', 'accepted_with_warnings_summary', 'rejected_import_summary']);
function defaultAudience(t: string): string {
  if (t === 'production_audit_summary' || t === 'release_readiness_summary') return 'internal_business';
  if (CLIENT_FACING.has(t)) return 'external_client';
  return 'internal_operator';
}

function buildReport(input: { reportType: string; audience: string; importId: string | null; templateId: string | null; meta: any; operatorNote: string | null; nowIso: string }) {
  const { reportType, audience, importId, templateId, meta, operatorNote, nowIso } = input;
  const os = meta?.production_operator_control_audit?.operatorState ?? {};
  const decision = os?.decision ?? null;
  const gate = meta?.golden_regression_summary?.qualityGateStatus ?? null;
  const parity = meta?.export_parity_summary?.status ?? null;
  const manual = os?.manualReviewRequired === true || meta?.visual_quality_summary?.manualReviewRequired === true;
  const blocked = os?.blocked === true || meta?.adaptive_reconciliation_policy?.decision === 'blocked';

  let summary = 'This summary describes the current status of the template import quality workflow.';
  if (reportType === 'manual_review_summary' || manual) summary = DECISION_WORDING.manual_review_required;
  else if (reportType === 'rejected_import_summary') summary = DECISION_WORDING.rejected;
  else if (reportType === 'accepted_with_warnings_summary') summary = DECISION_WORDING.accepted_with_warnings;
  else if (decision && DECISION_WORDING[decision]) summary = DECISION_WORDING[decision];

  const sections: any[] = [];
  sections.push({ id: 'overview', title: 'Overview', body: `This is a ${TYPE_LABELS[reportType] ?? 'summary'} generated on ${nowIso.slice(0, 10)}.`, status: 'info', items: [] });
  sections.push({ id: 'quality_review', title: 'Quality Review', body: gate ? (QUALITY_WORDING[gate] ?? 'Quality checks have been reviewed.') : 'Quality checks have been reviewed.', status: gate === 'fail' || gate === 'blocked' ? 'fail' : gate === 'warning' ? 'warning' : gate === 'pass' ? 'pass' : 'info', items: [] });
  sections.push({ id: 'export_validation', title: 'Export Validation', body: parity ? (EXPORT_WORDING[parity] ?? 'Export validation is pending.') : 'Export validation is pending.', status: parity === 'failed' ? 'fail' : parity === 'manual_required' ? 'warning' : parity === 'completed' ? 'pass' : 'info', items: [] });
  sections.push({ id: 'operator_decision', title: 'Operator Decision', body: decision ? (DECISION_WORDING[decision] ?? 'The import has been reviewed.') : 'The import has been reviewed.', status: decision === 'rejected' || decision === 'blocked' ? 'fail' : decision === 'accepted_with_warnings' || decision === 'manual_review_required' ? 'warning' : decision === 'accepted' ? 'pass' : 'info', items: [] });
  sections.push({ id: 'manual_review', title: 'Manual Review', body: manual ? 'Manual review is required before this template can be approved.' : 'No manual review is required at this time.', status: manual ? 'warning' : 'pass', items: [] });
  const warnings: string[] = [];
  if (gate === 'warning') warnings.push('Minor quality warnings are present.');
  if (parity === 'manual_required') warnings.push('Export validation needs a manual check.');
  if (manual) warnings.push('A manual review step is pending.');
  sections.push({ id: 'warnings_limitations', title: 'Warnings and Limitations', body: warnings.length ? 'The following client-safe warnings apply:' : 'No client-relevant warnings are present.', status: warnings.length ? 'warning' : 'pass', items: warnings });
  let nextAction = 'The template is ready for use.';
  if (blocked) nextAction = 'The import is on hold pending internal review.';
  else if (decision === 'rejected' || decision === 'needs_rerun') nextAction = 'The import requires rework before it can be approved.';
  else if (manual || decision === 'manual_review_required') nextAction = 'A manual review is pending before approval.';
  else if (parity === 'manual_required' || parity === 'not_ready' || parity === 'missing' || !parity) nextAction = 'Export validation is pending before final approval.';
  else if (decision === 'accepted_with_warnings') nextAction = 'The template is ready for use; minor warnings have been noted.';
  sections.push({ id: 'next_action', title: 'Next Action', body: nextAction, status: 'info', items: [] });
  if (operatorNote && String(operatorNote).trim()) sections.push({ id: 'operator_note', title: 'Operator Note', body: String(operatorNote), status: 'info', items: [] });
  if (audience !== 'external_client') {
    const perfRisk = meta?.performance_cost_audit?.riskLevel ?? meta?.performance_cost_audit?.overallRisk ?? null;
    if (perfRisk) sections.push({ id: 'performance_context', title: 'Performance Context (internal)', body: `Performance/cost risk level: ${perfRisk}.`, status: 'info', items: [] });
  }
  sections.push({ id: 'audit_statement', title: 'Audit Statement', body: 'This summary was generated from the internal PDF import quality workflow. It contains no raw PDF content, screenshots, signed URLs, storage paths, or logs.', status: 'info', items: [] });

  const rawPayload = {
    version: VERSION, reportType, audience, safetyLevel: 'safe', status: 'draft',
    importId, templateId, title: TYPE_LABELS[reportType] ?? 'PDF Import Report', summary, sections, redactions: [],
    sourceSummary: { operatorDecision: decision, qualityGateStatus: gate, exportParityStatus: parity, manualReviewRequired: manual, generatedFrom: [] },
    generatedAt: nowIso,
  };
  const sanitized = sanitizePayload(rawPayload);
  const unsafe = detectUnsafe(sanitized);
  let safetyLevel = 'safe';
  if (unsafe) safetyLevel = 'blocked';
  else if (blocked) safetyLevel = audience === 'external_client' ? 'internal_only' : 'safe_with_warnings';
  else if (manual || gate === 'warning' || parity === 'manual_required') safetyLevel = 'safe_with_warnings';
  return { ...sanitized, safetyLevel };
}

Deno.serve(async (req) => {
  const cors = createTokenAuthCorsHeaders(req.headers.get('origin'));
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(cors, __csrf);

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const body = await req.json().catch(() => ({}));
    const auth = await verifyAuth(admin, req.headers, body);
    if (auth.error || !auth.userId) return createUnauthorizedResponse(auth.error ?? 'unauthorized', cors);

    const isService = auth.userId === 'service_role';
    const actorId: string | null = isService ? null : auth.userId;
    if (!isService) {
      const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', auth.userId);
      const roleList = Array.isArray(roles) ? roles.map((r: any) => r.role) : [];
      if (!(roleList.includes('admin') || roleList.includes('superadmin'))) {
        return createForbiddenResponse('admin or superadmin required for PDF import client reports', cors);
      }
    }

    const operation = (body.operation as string) || 'list_reports';
    const nowIso = new Date().toISOString();

    if (operation === 'generate_preview' || operation === 'save_draft') {
      let payload: any;
      if (operation === 'generate_preview') {
        const reportType = String(body.report_type ?? 'import_status_summary');
        const audience = String(body.audience ?? defaultAudience(reportType));
        const importId = body.import_id ? String(body.import_id) : null;
        let meta: any = {}; let templateId: string | null = body.template_id ? String(body.template_id) : null;
        if (importId) {
          const { data: imp } = await admin.from('template_imports').select('id,created_template_id,meta').eq('id', importId).maybeSingle();
          if (imp) { meta = imp.meta ?? {}; templateId = templateId ?? (imp.created_template_id ? String(imp.created_template_id) : null); }
        }
        payload = buildReport({ reportType, audience, importId, templateId, meta, operatorNote: body.operator_note ? String(body.operator_note) : null, nowIso });
        if (body.persist !== true) return json({ ok: true, report: payload });
      } else {
        payload = body.payload;
        if (!payload || payload.version !== VERSION) return json({ error: 'invalid payload version' }, 400);
        // Re-sanitize server-side (defence in depth) and re-detect unsafe content.
        payload = sanitizePayload(payload);
        if (detectUnsafe(payload)) payload = { ...payload, safetyLevel: 'blocked' };
      }

      const status = payload.audience === 'external_client' ? 'pending_review' : 'draft';
      const { data: inserted, error: insErr } = await admin.from(TABLE).insert({
        import_id: payload.importId ?? null, template_id: payload.templateId ?? null,
        report_type: payload.reportType, audience: payload.audience, safety_level: payload.safetyLevel, status,
        title: payload.title || 'PDF import report', summary: payload.summary || 'Summary unavailable.',
        report_payload: payload, redactions: payload.redactions ?? [], source_summary: payload.sourceSummary ?? {},
        generated_by: actorId, generated_at: nowIso,
      }).select('*').maybeSingle();
      if (insErr) return json({ error: insErr.message }, 500);
      return json({ ok: true, report: inserted });
    }

    if (operation === 'list_reports') {
      const limit = Math.min(Math.max(Number(body.limit) || 100, 1), 500);
      let q = admin.from(TABLE).select('*').order('generated_at', { ascending: false }).limit(limit);
      if (body.import_id) q = q.eq('import_id', String(body.import_id));
      if (body.template_id) q = q.eq('template_id', String(body.template_id));
      if (body.status && body.status !== 'all') q = q.eq('status', String(body.status));
      if (body.audience && body.audience !== 'all') q = q.eq('audience', String(body.audience));
      if (body.report_type && body.report_type !== 'all') q = q.eq('report_type', String(body.report_type));
      const { data, error } = await q;
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, reports: data ?? [] });
    }

    const lifecycle: Record<string, true> = { review_report: true, approve_report: true, reject_report: true, mark_exported: true, supersede_report: true };
    if (lifecycle[operation]) {
      const reportId = body.report_id as string;
      if (!reportId) return json({ error: 'report_id required' }, 400);
      const note = typeof body.note === 'string' ? body.note : null;
      const { data: row, error: getErr } = await admin.from(TABLE).select('*').eq('id', reportId).maybeSingle();
      if (getErr) return json({ error: getErr.message }, 500);
      if (!row) return json({ error: 'report not found' }, 404);

      let patch: Record<string, unknown> | null = null;
      if (operation === 'review_report') {
        patch = { status: 'pending_review', reviewed_by: actorId, reviewed_at: nowIso, review_note: note };
      } else if (operation === 'approve_report') {
        if (row.safety_level === 'blocked') return json({ error: 'blocked reports cannot be approved' }, 409);
        if (row.safety_level === 'internal_only') return json({ error: 'internal_only reports cannot be approved for external export' }, 409);
        if (row.safety_level === 'safe_with_warnings' && !note) return json({ error: 'approval note required for safe_with_warnings reports' }, 409);
        patch = { status: 'approved', approved_by: actorId, approved_at: nowIso, approval_note: note };
      } else if (operation === 'reject_report') {
        patch = { status: 'rejected', rejected_by: actorId, rejected_at: nowIso, rejection_note: note };
      } else if (operation === 'mark_exported') {
        if (row.status !== 'approved') return json({ error: 'only approved reports can be marked exported' }, 409);
        if (row.safety_level === 'blocked' || row.safety_level === 'internal_only') return json({ error: 'report is not exportable' }, 409);
        const fmt = body.export_format ? String(body.export_format) : 'markdown';
        if (fmt === 'pdf') return json({ error: 'PDF export is not enabled in Phase 11G.' }, 400);
        if (!['json', 'markdown', 'html'].includes(fmt)) return json({ error: 'invalid export format' }, 400);
        patch = { status: 'exported', exported_by: actorId, exported_at: nowIso, export_note: note, export_format: fmt };
      } else if (operation === 'supersede_report') {
        patch = { status: 'superseded', superseded_at: nowIso, review_note: note ?? row.review_note };
      }
      if (!patch) return json({ error: 'invalid transition' }, 400);
      const { data: updated, error: updErr } = await admin.from(TABLE).update(patch).eq('id', reportId).select('*').maybeSingle();
      if (updErr) return json({ error: updErr.message }, 500);
      return json({ ok: true, report: updated });
    }

    return json({ error: `unknown operation: ${operation}` }, 400);
  } catch (err) {
    return json({ ...internalError(err, 'pdf-import-client-report') }, 500);
  }
});

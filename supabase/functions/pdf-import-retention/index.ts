// pdf-import-retention — Phase 11E artifact retention + cleanup governance.
//
// DRY-RUN ONLY. Detects retention/cleanup candidates, persists them for review,
// and manages their lifecycle (review / approve-for-future-cleanup / reject /
// block / supersede). There is NO delete operation. It NEVER deletes storage
// objects or rows, never archives, never compacts metadata, never mutates
// templates, and never calls AI. It stores metadata references only — never raw
// PDF/OCR text, raster content, signed URLs, or secrets.
//
// Access: admin (pdf_admin) or superadmin (developer_admin), plus service-role.
// Approving a delete_candidate that requires_developer_approval needs superadmin.

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
const TABLE = 'pdf_import_retention_events';
const ARTIFACT_BUCKET = 'template-import-artifacts';
const META_COMPACT_THRESHOLD = 500_000;
const ACTIVE_STATUSES = ['candidate', 'reviewed', 'approved_for_future_cleanup', 'blocked'];

interface RuleMeta {
  domain: string;
  decision: string;
  cleanup_action: string;
  safety_level: string;
  recommended_action: string;
  title: string;
}

// Kept in sync with src/lib/reportTemplate/ingestion/retention/pdfImportRetentionPolicy.ts
const RULES: Record<string, RuleMeta> = {
  source_pdf_retained: { domain: 'source_pdf', decision: 'blocked', cleanup_action: 'blocked_from_cleanup', safety_level: 'manual_only', recommended_action: 'Never auto-delete. Handle manually only.', title: 'Source PDF retained' },
  docling_artifact_old: { domain: 'docling_artifact', decision: 'archive_candidate', cleanup_action: 'archive_later', safety_level: 'requires_operator_approval', recommended_action: 'Archive candidate after operator approval.', title: 'Docling artifact older than window' },
  page_manifest_old: { domain: 'page_manifest', decision: 'archive_candidate', cleanup_action: 'archive_later', safety_level: 'requires_operator_approval', recommended_action: 'Archive candidate after operator approval.', title: 'Page manifest older than window' },
  diagnostics_old_success: { domain: 'diagnostics', decision: 'archive_candidate', cleanup_action: 'archive_later', safety_level: 'requires_operator_approval', recommended_action: 'Archive candidate after operator approval.', title: 'Old successful-import diagnostics' },
  diagnostics_failed_import_retained: { domain: 'diagnostics', decision: 'retain', cleanup_action: 'preserve_for_audit', safety_level: 'safe_to_recommend', recommended_action: 'Retain for failure triage evidence.', title: 'Failed-import diagnostics retained' },
  visual_quality_old_accepted: { domain: 'visual_quality', decision: 'archive_candidate', cleanup_action: 'archive_later', safety_level: 'requires_operator_approval', recommended_action: 'Archive candidate after operator approval.', title: 'Old accepted Visual QA evidence' },
  visual_quality_manual_review_retained: { domain: 'visual_quality', decision: 'retain', cleanup_action: 'preserve_for_manual_review', safety_level: 'safe_to_recommend', recommended_action: 'Retain - required for manual review.', title: 'Manual-review Visual QA retained' },
  visual_repair_old: { domain: 'visual_repair', decision: 'review', cleanup_action: 'mark_for_review', safety_level: 'requires_operator_approval', recommended_action: 'Operator review.', title: 'Old visual repair artifact' },
  visual_repair_applied_retained: { domain: 'visual_repair', decision: 'retain', cleanup_action: 'preserve_for_audit', safety_level: 'safe_to_recommend', recommended_action: 'Retain - repair audit evidence.', title: 'Applied/rejected repair retained' },
  export_parity_old: { domain: 'export_parity', decision: 'archive_candidate', cleanup_action: 'archive_later', safety_level: 'requires_operator_approval', recommended_action: 'Archive candidate after operator approval.', title: 'Old export parity artifact' },
  export_parity_golden_retained: { domain: 'export_parity', decision: 'retain', cleanup_action: 'preserve_for_regression', safety_level: 'safe_to_recommend', recommended_action: 'Retain - golden/regression evidence.', title: 'Golden/release export parity retained' },
  golden_history_retained: { domain: 'golden_history', decision: 'retain', cleanup_action: 'preserve_for_regression', safety_level: 'requires_developer_approval', recommended_action: 'Retain summary rows; never auto-prune.', title: 'Golden run history retained' },
  monitoring_event_old_resolved: { domain: 'monitoring_events', decision: 'archive_candidate', cleanup_action: 'archive_later', safety_level: 'requires_operator_approval', recommended_action: 'Archive candidate after operator approval.', title: 'Old resolved monitoring event' },
  phase10_metadata_large: { domain: 'phase10_metadata', decision: 'review', cleanup_action: 'compact_metadata_later', safety_level: 'requires_operator_approval', recommended_action: 'Compact metadata in a later phase; never auto-compact.', title: 'Oversized Phase 10 metadata' },
  operator_audit_retained: { domain: 'operator_audit', decision: 'retain', cleanup_action: 'preserve_for_audit', safety_level: 'blocked', recommended_action: 'Retain - never auto-delete operator audit.', title: 'Operator audit retained' },
  storage_object_orphaned: { domain: 'storage_orphan', decision: 'delete_candidate', cleanup_action: 'delete_later', safety_level: 'requires_developer_approval', recommended_action: 'Delete candidate - requires developer approval. Dry-run only.', title: 'Orphaned storage object' },
  metadata_reference_missing_object: { domain: 'metadata_reference', decision: 'review', cleanup_action: 'repair_reference', safety_level: 'requires_operator_approval', recommended_action: 'Investigate and repair the reference; do not delete.', title: 'Metadata reference to missing object' },
  unknown_artifact_review: { domain: 'unknown', decision: 'review', cleanup_action: 'mark_for_review', safety_level: 'requires_operator_approval', recommended_action: 'Operator review to classify.', title: 'Unknown artifact needs review' },
};

function olderThan(dateStr: unknown, days: number, nowMs: number): boolean {
  if (!dateStr) return false;
  const ts = new Date(String(dateStr)).getTime();
  if (Number.isNaN(ts)) return false;
  return nowMs - ts > days * 24 * 60 * 60 * 1000;
}

function looksLikeUrl(v: string): boolean {
  const s = v.trim().toLowerCase();
  return s.startsWith('http://') || s.startsWith('https://') || s.includes('token=') || s.includes('signature=') || s.includes('?');
}

function domainForKey(key: string): string {
  const k = key.toLowerCase();
  if (k.includes('visual_quality')) return 'visual_quality';
  if (k.includes('visual_repair')) return 'visual_repair';
  if (k.includes('export_parity')) return 'export_parity';
  if (k.includes('diagnostic')) return 'diagnostics';
  if (k.includes('manifest')) return 'page_manifest';
  if (k.includes('cdir') || k.includes('source_chunk') || k.includes('schema') || k.includes('import_asset')) return 'docling_artifact';
  return 'unknown';
}

function extractPaths(meta: Record<string, any>): Array<{ domain: string; path: string }> {
  const out: Array<{ domain: string; path: string }> = [];
  const seen = new Set<string>();
  for (const [key, val] of Object.entries(meta ?? {})) {
    if (typeof val !== 'string') continue;
    if (!(key.endsWith('_artifact_path') || key.endsWith('_path'))) continue;
    const value = val.trim();
    if (!value || looksLikeUrl(value)) continue;
    const dedupe = `${key}:${value}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push({ domain: domainForKey(key), path: value });
  }
  return out;
}

function mk(ruleId: string, opts: {
  scopeType: string; scopeId: string; scopeLabel?: string | null; message: string;
  storageBucket?: string | null; storageObjectPath?: string | null;
  importId?: string | null; templateId?: string | null; monitoringEventId?: string | null; goldenRunId?: string | null;
  evidence?: any[]; estimatedBytes?: number | null; objectCreatedAt?: string | null; objectUpdatedAt?: string | null; runId: string;
}) {
  const rule = RULES[ruleId];
  return {
    version: 'pdf-import-retention-event-v1',
    retentionRuleId: ruleId,
    domain: rule.domain,
    decision: rule.decision,
    cleanupAction: rule.cleanup_action,
    safetyLevel: rule.safety_level,
    title: rule.title,
    message: opts.message,
    scopeType: opts.scopeType,
    scopeId: opts.scopeId,
    scopeLabel: opts.scopeLabel ?? null,
    dedupeKey: `${ruleId}:${opts.scopeType}:${opts.scopeId}`,
    storageBucket: opts.storageBucket ?? null,
    storageObjectPath: opts.storageObjectPath ?? null,
    importId: opts.importId ?? null,
    templateId: opts.templateId ?? null,
    monitoringEventId: opts.monitoringEventId ?? null,
    goldenRunId: opts.goldenRunId ?? null,
    evidence: opts.evidence ?? [],
    recommendedAction: rule.recommended_action,
    estimatedBytes: opts.estimatedBytes ?? null,
    objectCreatedAt: opts.objectCreatedAt ?? null,
    objectUpdatedAt: opts.objectUpdatedAt ?? null,
    runId: opts.runId,
  };
}

function evaluate(signals: {
  imports: any[]; goldenRuns: any[]; monitoringEvents: any[]; storageObjects: any[]; nowMs: number; runId: string;
}) {
  const events: any[] = [];
  const seen = new Set<string>();
  const push = (e: any) => { if (!seen.has(e.dedupeKey)) { seen.add(e.dedupeKey); events.push(e); } };
  const { imports, goldenRuns, monitoringEvents, storageObjects, nowMs, runId } = signals;

  const referenced = new Set<string>();
  for (const imp of imports) for (const r of extractPaths(imp?.meta ?? {})) referenced.add(r.path);
  const storageNames = new Set<string>(storageObjects.map((o: any) => String(o?.name ?? '')));
  const haveStorage = storageObjects.length > 0;

  for (const imp of imports) {
    const importId = imp?.id ? String(imp.id) : null;
    if (!importId) continue;
    const templateId = imp?.created_template_id ?? imp?.template_id ?? null;
    const label = imp?.source_filename ?? null;
    const meta = imp?.meta ?? {};
    const status = String(imp?.status ?? '');
    const age = imp?.updated_at ?? imp?.created_at;
    const decision = meta?.production_operator_control_audit?.operatorState?.decision ?? null;
    const manualReview = meta?.production_operator_control_audit?.operatorState?.manualReviewRequired === true
      || meta?.visual_quality_summary?.manualReviewRequired === true;

    if (label) push(mk('source_pdf_retained', { scopeType: 'import', scopeId: importId, scopeLabel: label, message: `Source PDF for import ${importId} is retained.`, importId, templateId, runId, evidence: [{ code: 'source_filename', label: 'Source filename', value: label, message: 'Import source reference (name only).' }] }));
    if (meta?.production_operator_control_audit) push(mk('operator_audit_retained', { scopeType: 'import', scopeId: importId, scopeLabel: label, message: `Operator control audit for import ${importId} is retained.`, importId, templateId, runId }));

    const metaSize = typeof imp?.meta_size_bytes === 'number' ? imp.meta_size_bytes : null;
    if (metaSize != null && metaSize > META_COMPACT_THRESHOLD) push(mk('phase10_metadata_large', { scopeType: 'import', scopeId: importId, scopeLabel: label, message: `Import ${importId} metadata is ${metaSize} bytes.`, importId, templateId, estimatedBytes: metaSize, runId }));

    for (const ref of extractPaths(meta)) {
      const scopeId = `${importId}:${ref.path}`;
      const base = { scopeType: 'artifact', scopeId, scopeLabel: ref.path, storageBucket: ARTIFACT_BUCKET, storageObjectPath: ref.path, importId, templateId, runId } as const;
      if (haveStorage && !storageNames.has(ref.path)) {
        push(mk('metadata_reference_missing_object', { ...base, message: `Import ${importId} references a missing storage object (${ref.domain}).` }));
        continue;
      }
      if (ref.domain === 'visual_quality') {
        if (manualReview) push(mk('visual_quality_manual_review_retained', { ...base, message: `Visual QA evidence for import ${importId} retained (manual review).` }));
        else if ((decision === 'accepted' || decision === 'accepted_with_warnings') && olderThan(age, 180, nowMs)) push(mk('visual_quality_old_accepted', { ...base, message: `Old accepted Visual QA evidence for import ${importId}.` }));
      } else if (ref.domain === 'visual_repair') {
        const rs = meta?.visual_repair_summary?.status ?? null;
        if (rs === 'applied' || rs === 'rejected') push(mk('visual_repair_applied_retained', { ...base, message: `Repair artifact for import ${importId} retained (${rs}).` }));
        else if (olderThan(age, 180, nowMs)) push(mk('visual_repair_old', { ...base, message: `Old visual repair artifact for import ${importId}.` }));
      } else if (ref.domain === 'export_parity') {
        if (meta?.export_parity_summary?.isGoldenBaseline === true || meta?.export_parity_summary?.releaseEvidence === true) push(mk('export_parity_golden_retained', { ...base, message: `Export parity for import ${importId} retained (golden/release).` }));
        else if (olderThan(age, 180, nowMs)) push(mk('export_parity_old', { ...base, message: `Old export parity artifact for import ${importId}.` }));
      } else if (ref.domain === 'diagnostics') {
        if (status === 'failed') push(mk('diagnostics_failed_import_retained', { ...base, message: `Diagnostics for failed import ${importId} retained.` }));
        else if (olderThan(age, 90, nowMs)) push(mk('diagnostics_old_success', { ...base, message: `Old successful-import diagnostics for import ${importId}.` }));
      } else if (ref.domain === 'page_manifest') {
        if (olderThan(age, 180, nowMs)) push(mk('page_manifest_old', { ...base, message: `Old page manifest for import ${importId}.` }));
      } else if (ref.domain === 'docling_artifact') {
        if (olderThan(age, 180, nowMs)) push(mk('docling_artifact_old', { ...base, message: `Old Docling artifact for import ${importId}.` }));
      } else {
        push(mk('unknown_artifact_review', { ...base, message: `Unknown artifact for import ${importId} needs review.` }));
      }
    }
  }

  for (const run of goldenRuns) {
    const corpusId = run?.corpus_id ?? run?.corpusId;
    if (corpusId == null) continue;
    push(mk('golden_history_retained', { scopeType: 'golden_corpus', scopeId: String(corpusId), scopeLabel: String(corpusId), message: `Golden run history for corpus ${corpusId} is retained.`, goldenRunId: run?.id ? String(run.id) : null, runId }));
  }

  for (const ev of monitoringEvents) {
    const id = ev?.id ? String(ev.id) : null;
    if (!id) continue;
    const st = String(ev?.status ?? '');
    if (['resolved', 'suppressed', 'false_positive'].includes(st) && olderThan(ev?.updated_at ?? ev?.last_seen_at, 180, nowMs)) {
      push(mk('monitoring_event_old_resolved', { scopeType: 'monitoring_event', scopeId: id, scopeLabel: String(ev?.rule_id ?? ''), message: `Old ${st} monitoring event ${id}.`, monitoringEventId: id, runId }));
    }
  }

  for (const obj of storageObjects) {
    const name = obj?.name ? String(obj.name) : null;
    if (!name || referenced.has(name)) continue;
    const createdAt = obj?.created_at ? String(obj.created_at) : null;
    const sizeRaw = obj?.metadata?.size;
    const size = typeof sizeRaw === 'number' ? sizeRaw : (typeof sizeRaw === 'string' && Number.isFinite(Number(sizeRaw)) ? Number(sizeRaw) : null);
    if (olderThan(createdAt, 90, nowMs)) push(mk('storage_object_orphaned', { scopeType: 'storage_object', scopeId: name, scopeLabel: name, message: `Orphaned storage object ${name} older than 90 days (dry-run).`, storageBucket: ARTIFACT_BUCKET, storageObjectPath: name, estimatedBytes: size, objectCreatedAt: createdAt, objectUpdatedAt: obj?.updated_at ? String(obj.updated_at) : null, runId }));
    else push(mk('unknown_artifact_review', { scopeType: 'storage_object', scopeId: name, scopeLabel: name, message: `Recent unreferenced storage object ${name} needs review.`, storageBucket: ARTIFACT_BUCKET, storageObjectPath: name, estimatedBytes: size, objectCreatedAt: createdAt, runId }));
  }

  let retain = 0, review = 0, archive = 0, del = 0, blocked = 0, recoverable = 0;
  for (const e of events) {
    if (e.decision === 'retain') retain++;
    else if (e.decision === 'review') review++;
    else if (e.decision === 'archive_candidate') archive++;
    else if (e.decision === 'delete_candidate') del++;
    else if (e.decision === 'blocked') blocked++;
    if ((e.decision === 'archive_candidate' || e.decision === 'delete_candidate') && typeof e.estimatedBytes === 'number') recoverable += e.estimatedBytes;
  }
  return { runId, events, retainCount: retain, reviewCount: review, archiveCandidateCount: archive, deleteCandidateCount: del, blockedCount: blocked, estimatedRecoverableBytes: recoverable };
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
    const storageDb = createClient(SUPABASE_URL, SERVICE_ROLE, { db: { schema: 'storage' } });
    const body = await req.json().catch(() => ({}));
    const auth = await verifyAuth(admin, req.headers, body);
    if (auth.error || !auth.userId) return createUnauthorizedResponse(auth.error ?? 'unauthorized', cors);

    const isService = auth.userId === 'service_role';
    const actorId: string | null = isService ? null : auth.userId;
    let isSuperadmin = isService;
    if (!isService) {
      const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', auth.userId);
      const roleList = Array.isArray(roles) ? roles.map((r: any) => r.role) : [];
      const isAdmin = roleList.includes('admin') || roleList.includes('superadmin');
      isSuperadmin = roleList.includes('superadmin');
      if (!isAdmin) return createForbiddenResponse('admin or superadmin required for PDF import retention', cors);
    }

    const operation = (body.operation as string) || 'list_events';
    const nowIso = new Date().toISOString();

    if (operation === 'run_scan') {
      const runId = `retention-${nowIso.replace(/[:.]/g, '-')}`;
      const nowMs = Date.now();

      const { data: imports } = await admin.from('template_imports').select('id,created_template_id,status,source_filename,meta,updated_at,created_at').order('updated_at', { ascending: false }).limit(1000);
      const { data: goldenRuns } = await admin.from('pdf_import_golden_runs').select('id,corpus_id').limit(2000);
      const { data: monitoringEvents } = await admin.from('pdf_import_monitoring_events').select('id,rule_id,status,updated_at,last_seen_at').limit(2000);
      let storageObjects: any[] = [];
      let storageTruncated = false;
      try {
        const { data: objs } = await storageDb.from('objects').select('id,name,bucket_id,metadata,created_at,updated_at').eq('bucket_id', ARTIFACT_BUCKET).limit(2000);
        storageObjects = Array.isArray(objs) ? objs : [];
        if (storageObjects.length >= 2000) storageTruncated = true;
      } catch (_e) {
        storageObjects = [];
      }

      // compute per-import meta size (best-effort, from JSON string length)
      const importsWithSize = (imports ?? []).map((imp: any) => {
        let sizeBytes: number | null = null;
        try { sizeBytes = imp?.meta ? new TextEncoder().encode(JSON.stringify(imp.meta)).length : 0; } catch { sizeBytes = null; }
        return { ...imp, meta_size_bytes: sizeBytes };
      });

      const result = evaluate({ imports: importsWithSize, goldenRuns: goldenRuns ?? [], monitoringEvents: monitoringEvents ?? [], storageObjects, nowMs, runId });

      if (storageTruncated) {
        result.events.push(mk('unknown_artifact_review', { scopeType: 'scan', scopeId: 'storage_listing_truncated', scopeLabel: ARTIFACT_BUCKET, message: 'Storage object listing was truncated at 2000; a full paginated scan is deferred.', runId }));
      }

      // Load active dedupe keys.
      const { data: activeRows } = await admin.from(TABLE).select('id,dedupe_key,occurrence_count').in('status', ACTIVE_STATUSES);
      const activeByKey = new Map<string, any>();
      for (const r of activeRows ?? []) activeByKey.set(r.dedupe_key, r);

      let inserted = 0, updated = 0;
      const toInsert: any[] = [];
      for (const e of result.events) {
        const existing = activeByKey.get(e.dedupeKey);
        if (existing) {
          await admin.from(TABLE).update({
            decision: e.decision, cleanup_action: e.cleanupAction, safety_level: e.safetyLevel,
            message: e.message, evidence: e.evidence, recommended_action: e.recommendedAction,
            estimated_bytes: e.estimatedBytes, last_seen_at: nowIso, occurrence_count: (existing.occurrence_count ?? 1) + 1, run_id: e.runId,
          }).eq('id', existing.id);
          updated++;
        } else {
          toInsert.push({
            retention_rule_id: e.retentionRuleId, domain: e.domain, decision: e.decision, cleanup_action: e.cleanupAction,
            safety_level: e.safetyLevel, status: 'candidate', title: e.title, message: e.message,
            scope_type: e.scopeType, scope_id: e.scopeId, scope_label: e.scopeLabel, dedupe_key: e.dedupeKey,
            storage_bucket: e.storageBucket, storage_object_path: e.storageObjectPath,
            import_id: e.importId, template_id: e.templateId, monitoring_event_id: e.monitoringEventId, golden_run_id: e.goldenRunId,
            evidence: e.evidence, recommended_action: e.recommendedAction, estimated_bytes: e.estimatedBytes,
            object_created_at: e.objectCreatedAt, object_updated_at: e.objectUpdatedAt, source: 'pdf_import_retention', run_id: e.runId,
            first_seen_at: nowIso, last_seen_at: nowIso, occurrence_count: 1,
          });
        }
      }
      // Batch insert new candidates in chunks.
      for (let i = 0; i < toInsert.length; i += 200) {
        const chunk = toInsert.slice(i, i + 200);
        const { error } = await admin.from(TABLE).insert(chunk);
        if (!error) inserted += chunk.length;
      }

      return json({
        ok: true,
        result: {
          runId: result.runId, generatedAt: nowIso, events: result.events,
          retainCount: result.retainCount, reviewCount: result.reviewCount, archiveCandidateCount: result.archiveCandidateCount,
          deleteCandidateCount: result.deleteCandidateCount, blockedCount: result.blockedCount, estimatedRecoverableBytes: result.estimatedRecoverableBytes,
        },
        persistedCount: inserted + updated, insertedCount: inserted, updatedCount: updated,
      });
    }

    if (operation === 'list_events') {
      const statusFilter = (body.status as string) || 'active';
      const decisionFilter = (body.decision as string) || 'all';
      const domainFilter = (body.domain as string) || 'all';
      const limit = Math.min(Math.max(Number(body.limit) || 100, 1), 500);
      let q = admin.from(TABLE).select('*').order('last_seen_at', { ascending: false }).limit(limit);
      if (statusFilter === 'active') q = q.in('status', ACTIVE_STATUSES);
      else if (statusFilter !== 'all') q = q.eq('status', statusFilter);
      if (decisionFilter !== 'all') q = q.eq('decision', decisionFilter);
      if (domainFilter !== 'all') q = q.eq('domain', domainFilter);
      const { data, error } = await q;
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, events: data ?? [] });
    }

    const lifecycle: Record<string, true> = { review_event: true, approve_for_future_cleanup: true, reject_event: true, block_event: true, supersede_event: true };
    if (lifecycle[operation]) {
      const eventId = body.event_id as string;
      if (!eventId) return json({ error: 'event_id required' }, 400);
      const note = typeof body.note === 'string' ? body.note : null;
      const { data: row, error: getErr } = await admin.from(TABLE).select('*').eq('id', eventId).maybeSingle();
      if (getErr) return json({ error: getErr.message }, 500);
      if (!row) return json({ error: 'event not found' }, 404);

      let patch: Record<string, unknown> | null = null;
      if (operation === 'review_event') {
        patch = { status: 'reviewed', reviewed_by: actorId, reviewed_at: nowIso, review_note: note };
      } else if (operation === 'approve_for_future_cleanup') {
        // Developer approval required for developer-level candidates (e.g. delete candidates).
        if (row.safety_level === 'requires_developer_approval' && !isSuperadmin) {
          return createForbiddenResponse('developer_admin (superadmin) approval required for this candidate', cors);
        }
        patch = { status: 'approved_for_future_cleanup', approved_by: actorId, approved_at: nowIso, approval_note: note };
      } else if (operation === 'reject_event') {
        patch = { status: 'rejected', rejected_by: actorId, rejected_at: nowIso, rejection_note: note };
      } else if (operation === 'block_event') {
        patch = { status: 'blocked', blocked_by: actorId, blocked_at: nowIso, block_note: note };
      } else if (operation === 'supersede_event') {
        patch = { status: 'superseded', review_note: note ?? row.review_note };
      }
      if (!patch) return json({ error: 'invalid transition' }, 400);
      const { data: updatedRow, error: updErr } = await admin.from(TABLE).update(patch).eq('id', eventId).select('*').maybeSingle();
      if (updErr) return json({ error: updErr.message }, 500);
      return json({ ok: true, event: updatedRow });
    }

    return json({ error: `unknown operation: ${operation}` }, 400);
  } catch (err) {
    return json({ ...internalError(err, 'pdf-import-retention') }, 500);
  }
});

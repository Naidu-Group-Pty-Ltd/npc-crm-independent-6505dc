// pdf-import-monitoring — Phase 11C durable monitoring + alerting activation.
//
// Detects, classifies, persists, lists, and manages the lifecycle of PDF import
// alert events in public.pdf_import_monitoring_events. This function is
// NON-remediating: it never repairs, retries, reruns, reconciles, mutates
// templates, or calls AI. It stores metadata only — never raw PDF/OCR text,
// screenshots, signed URLs, or private content.
//
// Access: admin or superadmin (via user_roles), plus internal service-role.
//   run_check           -> detect from live DB metrics + upsert + auto-resolve
//   list_events         -> { status?, domain?, severity?, limit? }
//   acknowledge_event   -> { event_id, note? }
//   resolve_event       -> { event_id, note? }
//   suppress_event      -> { event_id, suppress_until?, note? }
//   mark_false_positive -> { event_id, note? }

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
const TABLE = 'pdf_import_monitoring_events';

type Severity = 'info' | 'warning' | 'high' | 'critical';
type Owner =
  | 'operator' | 'qa' | 'manual_review' | 'developer_frontend' | 'developer_backend'
  | 'developer_sidecar' | 'developer_fullstack' | 'security' | 'unknown';

interface RuleMeta {
  domain: string;
  defaultSeverity: Severity;
  owner: Owner;
  releaseBlocking: boolean;
  title: string;
  runbookAnchor: string;
}

// Kept in sync with src/lib/reportTemplate/ingestion/monitoring/monitoringEventRules.ts
const RULES: Record<string, RuleMeta> = {
  import_failure_detected: { domain: 'import_pipeline', defaultSeverity: 'high', owner: 'developer_fullstack', releaseBlocking: true, title: 'PDF import failures detected', runbookAnchor: 'import-failure-detected' },
  import_stuck_in_progress: { domain: 'import_pipeline', defaultSeverity: 'high', owner: 'developer_backend', releaseBlocking: true, title: 'PDF imports stuck in progress', runbookAnchor: 'import-stuck-in-progress' },
  import_error_rate_high: { domain: 'import_pipeline', defaultSeverity: 'high', owner: 'developer_fullstack', releaseBlocking: true, title: 'PDF import error rate is high', runbookAnchor: 'import-error-rate-high' },
  import_duration_regression: { domain: 'import_pipeline', defaultSeverity: 'warning', owner: 'developer_backend', releaseBlocking: false, title: 'PDF import duration regression', runbookAnchor: 'import-duration-regression' },
  sidecar_diagnostics_failed: { domain: 'sidecar_diagnostics', defaultSeverity: 'high', owner: 'developer_sidecar', releaseBlocking: true, title: 'Sidecar diagnostics jobs failed', runbookAnchor: 'sidecar-diagnostics-failed' },
  sidecar_engine_version_missing: { domain: 'sidecar_diagnostics', defaultSeverity: 'warning', owner: 'developer_backend', releaseBlocking: false, title: 'Engine version missing', runbookAnchor: 'sidecar-engine-version-missing' },
  sidecar_unavailable: { domain: 'sidecar_diagnostics', defaultSeverity: 'critical', owner: 'developer_sidecar', releaseBlocking: true, title: 'Sidecar unavailable', runbookAnchor: 'sidecar-unavailable' },
  source_raster_missing: { domain: 'artifact_integrity', defaultSeverity: 'high', owner: 'developer_backend', releaseBlocking: true, title: 'Source rasters missing', runbookAnchor: 'source-raster-missing' },
  artifact_bucket_public_exposure: { domain: 'artifact_integrity', defaultSeverity: 'critical', owner: 'security', releaseBlocking: true, title: 'Artifact bucket publicly exposed', runbookAnchor: 'artifact-bucket-public-exposure' },
  visual_qa_missing: { domain: 'visual_quality', defaultSeverity: 'warning', owner: 'developer_frontend', releaseBlocking: false, title: 'Visual QA missing', runbookAnchor: 'visual-qa-missing' },
  visual_qa_low_similarity: { domain: 'visual_quality', defaultSeverity: 'high', owner: 'qa', releaseBlocking: true, title: 'Visual QA low similarity', runbookAnchor: 'visual-qa-low-similarity' },
  repair_audit_missing: { domain: 'repair', defaultSeverity: 'warning', owner: 'developer_backend', releaseBlocking: false, title: 'Repair audit missing', runbookAnchor: 'repair-audit-missing' },
  repair_failure_rate_high: { domain: 'repair', defaultSeverity: 'high', owner: 'developer_backend', releaseBlocking: true, title: 'Repair failure rate high', runbookAnchor: 'repair-failure-rate-high' },
  reconciliation_manual_backlog: { domain: 'reconciliation', defaultSeverity: 'warning', owner: 'manual_review', releaseBlocking: false, title: 'Reconciliation manual backlog', runbookAnchor: 'reconciliation-manual-backlog' },
  reconciliation_plan_unresolved: { domain: 'reconciliation', defaultSeverity: 'warning', owner: 'manual_review', releaseBlocking: false, title: 'Reconciliation plans unresolved', runbookAnchor: 'reconciliation-plan-unresolved' },
  export_parity_missing: { domain: 'export_parity', defaultSeverity: 'warning', owner: 'operator', releaseBlocking: false, title: 'Export parity missing', runbookAnchor: 'export-parity-missing' },
  export_parity_failed: { domain: 'export_parity', defaultSeverity: 'high', owner: 'developer_frontend', releaseBlocking: true, title: 'Export parity failed', runbookAnchor: 'export-parity-failed' },
  export_parity_manual_required: { domain: 'export_parity', defaultSeverity: 'warning', owner: 'manual_review', releaseBlocking: false, title: 'Export parity manual review required', runbookAnchor: 'export-parity-manual-required' },
  golden_quality_gate_failed: { domain: 'golden_regression', defaultSeverity: 'critical', owner: 'qa', releaseBlocking: true, title: 'Golden quality gate failed', runbookAnchor: 'golden-quality-gate-failed' },
  golden_quality_gate_blocked: { domain: 'golden_regression', defaultSeverity: 'critical', owner: 'operator', releaseBlocking: true, title: 'Golden quality gate blocked', runbookAnchor: 'golden-quality-gate-blocked' },
  golden_baseline_degraded: { domain: 'golden_regression', defaultSeverity: 'warning', owner: 'qa', releaseBlocking: false, title: 'Golden baseline degraded', runbookAnchor: 'golden-baseline-degraded' },
  golden_corpus_coverage_incomplete: { domain: 'golden_regression', defaultSeverity: 'warning', owner: 'qa', releaseBlocking: false, title: 'Golden corpus coverage incomplete', runbookAnchor: 'golden-corpus-coverage-incomplete' },
  release_gate_blocked: { domain: 'release_gates', defaultSeverity: 'critical', owner: 'developer_fullstack', releaseBlocking: true, title: 'Release gate blocked', runbookAnchor: 'release-gate-blocked' },
  release_readiness_regressed: { domain: 'release_gates', defaultSeverity: 'high', owner: 'developer_fullstack', releaseBlocking: true, title: 'Release readiness regressed', runbookAnchor: 'release-readiness-regressed' },
  backend_unknown_operation: { domain: 'backend_contract', defaultSeverity: 'critical', owner: 'developer_backend', releaseBlocking: true, title: 'Backend unknown operation detected', runbookAnchor: 'backend-unknown-operation' },
  backend_contract_drift: { domain: 'backend_contract', defaultSeverity: 'high', owner: 'developer_backend', releaseBlocking: true, title: 'Backend contract drift', runbookAnchor: 'backend-contract-drift' },
  private_artifact_exposure_risk: { domain: 'security_privacy', defaultSeverity: 'critical', owner: 'security', releaseBlocking: true, title: 'Private artifact exposure risk', runbookAnchor: 'private-artifact-exposure-risk' },
  raw_content_persistence_risk: { domain: 'security_privacy', defaultSeverity: 'critical', owner: 'security', releaseBlocking: true, title: 'Raw content persistence risk', runbookAnchor: 'raw-content-persistence-risk' },
  permission_escalation_detected: { domain: 'permissions', defaultSeverity: 'critical', owner: 'security', releaseBlocking: true, title: 'Permission escalation detected', runbookAnchor: 'permission-escalation-detected' },
  unauthorized_write_attempt: { domain: 'permissions', defaultSeverity: 'high', owner: 'security', releaseBlocking: false, title: 'Unauthorized write attempt', runbookAnchor: 'unauthorized-write-attempt' },
  performance_budget_exceeded: { domain: 'performance', defaultSeverity: 'high', owner: 'developer_backend', releaseBlocking: false, title: 'Performance budget exceeded', runbookAnchor: 'performance-budget-exceeded' },
  quality_gate_regression: { domain: 'quality_gates', defaultSeverity: 'high', owner: 'qa', releaseBlocking: true, title: 'Quality gate regression', runbookAnchor: 'quality-gate-regression' },
  operator_control_blocked_bypass: { domain: 'operator_controls', defaultSeverity: 'critical', owner: 'security', releaseBlocking: true, title: 'Blocked operator control bypass', runbookAnchor: 'operator-control-blocked-bypass' },
  monitoring_check_stale: { domain: 'monitoring_self', defaultSeverity: 'warning', owner: 'developer_fullstack', releaseBlocking: false, title: 'Monitoring check is stale', runbookAnchor: 'monitoring-check-stale' },
};

const SEVERITY_RANK: Record<Severity, number> = { info: 0, warning: 1, high: 2, critical: 3 };
const ACTIVE_STATUSES = ['open', 'acknowledged', 'suppressed'];

interface FiredSignal {
  ruleId: string;
  severity?: Severity;
  metricValue: number | boolean | null;
  threshold: number | boolean | null;
  summary: string;
  context: Record<string, string | number | boolean | null>;
}

// ── Live metric collection (safe, aggregate, metadata only) ──
async function collectMetricsAndSignals(admin: any): Promise<FiredSignal[]> {
  const signals: FiredSignal[] = [];
  const now = Date.now();
  const since24h = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const before30m = new Date(now - 30 * 60 * 1000).toISOString();

  const count = async (build: (q: any) => any): Promise<number> => {
    let q = admin.from('pdf_import_jobs').select('id', { count: 'exact', head: true });
    q = build(q);
    const { count: c } = await q;
    return Number(c ?? 0);
  };

  // import_pipeline
  const failedImports24h = await count((q) => q.eq('status', 'failed').gte('created_at', since24h));
  const completedImports24h = await count((q) => q.eq('status', 'succeeded').gte('created_at', since24h));
  const stuckImports = await count((q) => q.eq('status', 'queued').lt('created_at', before30m));
  const missingEngineVersion = await count((q) => q.eq('status', 'succeeded').is('engine_version', null));

  if (failedImports24h >= 1) {
    const severity: Severity = failedImports24h >= 8 ? 'critical' : failedImports24h >= 3 ? 'high' : 'warning';
    signals.push({ ruleId: 'import_failure_detected', severity, metricValue: failedImports24h, threshold: 1, summary: `${failedImports24h} PDF import(s) failed in the last 24h.`, context: { failedImports24h } });
  }
  if (stuckImports >= 1) {
    signals.push({ ruleId: 'import_stuck_in_progress', metricValue: stuckImports, threshold: 1, summary: `${stuckImports} import(s) stuck in a non-terminal state beyond 30m.`, context: { stuckImports } });
  }
  const total = failedImports24h + completedImports24h;
  if (total > 0) {
    const rate = failedImports24h / total;
    if (rate >= 0.1) {
      signals.push({ ruleId: 'import_error_rate_high', severity: rate >= 0.25 ? 'high' : 'warning', metricValue: Number(rate.toFixed(4)), threshold: 0.1, summary: `Import error rate ${Math.round(rate * 100)}% over the last 24h.`, context: { failedImports24h, completedImports24h } });
    }
  }
  if (missingEngineVersion >= 1) {
    signals.push({ ruleId: 'sidecar_engine_version_missing', metricValue: missingEngineVersion, threshold: 1, summary: `${missingEngineVersion} completed import(s) missing engine version.`, context: { missingEngineVersion } });
  }

  // golden_regression
  const goldenCount = async (status: string): Promise<number> => {
    const { count: c } = await admin.from('pdf_import_golden_runs').select('id', { count: 'exact', head: true }).eq('quality_gate_status', status);
    return Number(c ?? 0);
  };
  const goldenFailed = await goldenCount('fail');
  const goldenBlocked = await goldenCount('blocked');
  if (goldenFailed >= 1) {
    signals.push({ ruleId: 'golden_quality_gate_failed', metricValue: goldenFailed, threshold: 1, summary: `${goldenFailed} golden run(s) failed the quality gate.`, context: { goldenFailed } });
  }
  if (goldenBlocked >= 1) {
    signals.push({ ruleId: 'golden_quality_gate_blocked', metricValue: goldenBlocked, threshold: 1, summary: `${goldenBlocked} golden run(s) are blocked.`, context: { goldenBlocked } });
  }

  // security_privacy / artifact_integrity — public artifact bucket exposure
  const { data: buckets } = await admin.storage.listBuckets();
  const publicArtifactBuckets = Array.isArray(buckets)
    ? buckets.filter((b: any) => b?.id === 'template-import-artifacts' && b?.public === true).length
    : 0;
  if (publicArtifactBuckets > 0) {
    signals.push({ ruleId: 'artifact_bucket_public_exposure', severity: 'critical', metricValue: publicArtifactBuckets, threshold: 0, summary: `${publicArtifactBuckets} template-import artifact bucket(s) are public.`, context: { publicArtifactBuckets } });
  }

  return signals;
}

function buildRollup(events: any[]) {
  const active = events.filter((e) => e.status === 'open' || e.status === 'acknowledged');
  let highest: Severity = 'info';
  for (const e of active) if (SEVERITY_RANK[e.severity as Severity] > SEVERITY_RANK[highest]) highest = e.severity;
  const status = active.length === 0
    ? 'healthy'
    : highest === 'critical' ? 'critical_alerts_present'
    : highest === 'high' ? 'high_alerts_present'
    : highest === 'warning' ? 'warnings_present'
    : 'info_present';
  const firstHighest = active.find((e) => e.severity === highest);
  return {
    status,
    highestActiveSeverity: highest,
    primaryOwner: firstHighest?.owner ?? 'operator',
    releaseBlockingActive: active.some((e) => e.release_blocking === true),
    counts: {
      total: events.length,
      active: active.length,
      open: events.filter((e) => e.status === 'open').length,
      acknowledged: events.filter((e) => e.status === 'acknowledged').length,
      resolved: events.filter((e) => e.status === 'resolved').length,
      suppressed: events.filter((e) => e.status === 'suppressed').length,
      falsePositive: events.filter((e) => e.status === 'false_positive').length,
      info: active.filter((e) => e.severity === 'info').length,
      warning: active.filter((e) => e.severity === 'warning').length,
      high: active.filter((e) => e.severity === 'high').length,
      critical: active.filter((e) => e.severity === 'critical').length,
    },
    generatedAt: new Date().toISOString(),
  };
}

function scalarToText(v: number | boolean | null): string | null {
  return v == null ? null : String(v);
}

Deno.serve(async (req) => {
  const cors = createTokenAuthCorsHeaders(req.headers.get('origin'));
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
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
    let actorId: string | null = isService ? null : auth.userId;
    if (!isService) {
      const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', auth.userId);
      const isAdmin = Array.isArray(roles) && roles.some((r: any) => r.role === 'admin' || r.role === 'superadmin');
      if (!isAdmin) return createForbiddenResponse('admin or superadmin required for PDF import monitoring', cors);
    }

    const operation = (body.operation as string) || 'list_events';
    const nowIso = new Date().toISOString();

    // ── run_check: detect + persist + auto-resolve ──
    if (operation === 'run_check') {
      const signals = await collectMetricsAndSignals(admin);
      const firedByKey = new Map<string, FiredSignal>();
      for (const s of signals) firedByKey.set(`${s.ruleId}:global`, s);

      // Load currently active events.
      const { data: activeRows, error: loadErr } = await admin
        .from(TABLE).select('*').in('status', ACTIVE_STATUSES);
      if (loadErr) return json({ error: loadErr.message }, 500);
      const activeByKey = new Map<string, any>();
      for (const row of activeRows ?? []) activeByKey.set(row.event_key, row);

      let inserted = 0;
      let updated = 0;
      let autoResolved = 0;

      // Upsert fired signals.
      for (const [key, s] of firedByKey) {
        const meta = RULES[s.ruleId];
        if (!meta) continue;
        const severity = s.severity ?? meta.defaultSeverity;
        const existing = activeByKey.get(key);
        if (existing) {
          if (existing.status === 'suppressed') {
            await admin.from(TABLE).update({
              last_seen_at: nowIso, occurrence_count: (existing.occurrence_count ?? 1) + 1,
            }).eq('id', existing.id);
          } else {
            await admin.from(TABLE).update({
              severity, summary: s.summary, metric_value: scalarToText(s.metricValue),
              threshold: scalarToText(s.threshold), context: s.context,
              occurrence_count: (existing.occurrence_count ?? 1) + 1, last_seen_at: nowIso,
            }).eq('id', existing.id);
          }
          updated++;
        } else {
          const { error: insErr } = await admin.from(TABLE).insert({
            event_key: key, rule_id: s.ruleId, domain: meta.domain, severity, status: 'open',
            owner: meta.owner, release_blocking: meta.releaseBlocking, title: meta.title,
            summary: s.summary, metric_value: scalarToText(s.metricValue), threshold: scalarToText(s.threshold),
            occurrence_count: 1, first_seen_at: nowIso, last_seen_at: nowIso,
            runbook_anchor: meta.runbookAnchor, context: s.context,
          });
          if (!insErr) inserted++;
        }
      }

      // Auto-resolve open/acknowledged events whose rule no longer fires.
      for (const row of activeRows ?? []) {
        if (firedByKey.has(row.event_key)) continue;
        if (row.status !== 'open' && row.status !== 'acknowledged') continue;
        await admin.from(TABLE).update({
          status: 'resolved', resolved_at: nowIso, resolved_by: null,
          note: row.note ? `${row.note} · auto-resolved` : 'auto-resolved (signal cleared)',
        }).eq('id', row.id);
        autoResolved++;
      }

      const { data: refreshed } = await admin
        .from(TABLE).select('*').in('status', ['open', 'acknowledged']).order('last_seen_at', { ascending: false });
      return json({
        ok: true, events: refreshed ?? [], rollup: buildRollup(refreshed ?? []),
        inserted, updated, auto_resolved: autoResolved,
      });
    }

    // ── list_events ──
    if (operation === 'list_events') {
      const statusFilter = (body.status as string) || 'active';
      const limit = Math.min(Math.max(Number(body.limit) || 100, 1), 500);
      let q = admin.from(TABLE).select('*').order('last_seen_at', { ascending: false }).limit(limit);
      if (statusFilter === 'active') q = q.in('status', ['open', 'acknowledged']);
      else if (statusFilter !== 'all') q = q.eq('status', statusFilter);
      if (body.domain) q = q.eq('domain', body.domain);
      if (body.severity) q = q.eq('severity', body.severity);
      const { data, error } = await q;
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, events: data ?? [], rollup: buildRollup(data ?? []) });
    }

    // ── lifecycle transitions ──
    const lifecycleOps: Record<string, true> = {
      acknowledge_event: true, resolve_event: true, suppress_event: true, mark_false_positive: true,
    };
    if (lifecycleOps[operation]) {
      const eventId = body.event_id as string;
      if (!eventId) return json({ error: 'event_id required' }, 400);
      const note = typeof body.note === 'string' ? body.note : null;

      const { data: row, error: getErr } = await admin.from(TABLE).select('*').eq('id', eventId).maybeSingle();
      if (getErr) return json({ error: getErr.message }, 500);
      if (!row) return json({ error: 'event not found' }, 404);

      let patch: Record<string, unknown> | null = null;
      if (operation === 'acknowledge_event') {
        if (row.status !== 'open') return json({ error: `cannot acknowledge from status ${row.status}` }, 409);
        patch = { status: 'acknowledged', acknowledged_at: nowIso, acknowledged_by: actorId, note: note ?? row.note };
      } else if (operation === 'resolve_event') {
        if (row.status === 'resolved') return json({ error: 'already resolved' }, 409);
        patch = { status: 'resolved', resolved_at: nowIso, resolved_by: actorId, note: note ?? row.note };
      } else if (operation === 'suppress_event') {
        if (row.status === 'resolved' || row.status === 'false_positive') return json({ error: `cannot suppress from status ${row.status}` }, 409);
        const suppressUntil = typeof body.suppress_until === 'string' ? body.suppress_until : null;
        patch = { status: 'suppressed', suppressed_until: suppressUntil, note: note ?? row.note };
      } else if (operation === 'mark_false_positive') {
        if (row.status === 'false_positive') return json({ error: 'already false_positive' }, 409);
        patch = { status: 'false_positive', resolved_at: nowIso, resolved_by: actorId, note: note ?? row.note };
      }
      if (!patch) return json({ error: 'invalid lifecycle transition' }, 400);

      const { data: updatedRow, error: updErr } = await admin.from(TABLE).update(patch).eq('id', eventId).select('*').maybeSingle();
      if (updErr) return json({ error: updErr.message }, 500);
      return json({ ok: true, event: updatedRow });
    }

    return json({ error: `unknown operation: ${operation}` }, 400);
  } catch (err) {
    return json({ ...internalError(err, 'pdf-import-monitoring') }, 500);
  }
});

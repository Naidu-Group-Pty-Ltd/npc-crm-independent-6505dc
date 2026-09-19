// PDF Import Phase 10A — Production Readiness Hardening Checklist.
//
// A fixed catalogue of production-safety checks for the PDF import system. This
// is an audit baseline, not a live scanner: statuses reflect the Phase 10A
// source review (committed code + migrations). Checks that require live database,
// storage, or deployment confirmation are left `unknown` and are resolved with
// the Phase 10A read-only SQL and the manual smoke procedures documented in
// docs/pdf-import/phase-10a-production-hardening-audit.md.
//
// Evidence strings cite files reviewed during Phase 10A; they never contain
// client data, signed URLs, or PII.

import type { PdfImportHardeningCheck } from './pdfImportHardeningAuditTypes';

export const PDF_IMPORT_HARDENING_CHECKLIST: PdfImportHardeningCheck[] = [
  // -------------------------------------------------------------------------
  // Security / Auth
  // -------------------------------------------------------------------------
  {
    id: 'PDF-HARDEN-AUTH-001',
    domain: 'security_auth',
    title: 'Edge Function operations enforce authenticated access',
    description:
      'Every template-import-pdf operation resolves auth via verifyAuthOrNativeUser and returns 401 when it fails, deriving authedUserId with service_role special-cased.',
    severity: 'critical',
    likelihood: 'possible',
    status: 'pass',
    owner: 'developer_backend',
    evidence: [
      'supabase/functions/template-import-pdf/index.ts: verifyAuthOrNativeUser + createUnauthorizedResponse before dispatch',
      'authedUserId = auth.userId && auth.userId !== "service_role" ? auth.userId : null',
    ],
    recommendation:
      'Verify every template-import-pdf operation validates user/service role context; keep the pre-dispatch auth check in place.',
    targetPhase: '10A',
  },
  {
    id: 'PDF-HARDEN-AUTH-002',
    domain: 'security_auth',
    title: 'Write operations enforce import ownership',
    description:
      'append_meta, save_visual_quality, save_visual_repair_audit, save_export_parity and save_golden_run_history compare the import owner to authedUserId and reject with 403 unless the caller owns the import or is service_role.',
    severity: 'critical',
    likelihood: 'possible',
    status: 'pass',
    owner: 'developer_backend',
    evidence: [
      'template-import-pdf/index.ts ownership guards: record.user_id !== authedUserId && auth.userId !== "service_role" -> forbidden',
      'append_meta, save_visual_quality, save_visual_repair_audit, save_export_parity, save_golden_run_history all guarded',
    ],
    recommendation:
      'Keep ownership checks on every write path; add a regression test if a new write operation is introduced.',
    targetPhase: '10A',
  },
  {
    id: 'PDF-HARDEN-AUTH-003',
    domain: 'security_auth',
    title: 'Admin PDF diagnostics pages are protected',
    description:
      'The admin PDF routes (pdf-import-diagnostics, template-import-quality, pdf-golden-regression, pdf-import-engine) are wrapped in ModuleGuard with moduleKey="templates" and are not public.',
    severity: 'high',
    likelihood: 'possible',
    status: 'pass',
    owner: 'developer_frontend',
    evidence: [
      'src/App.tsx: <ModuleGuard moduleKey="templates"> wraps each admin/pdf-* route',
      'ModuleGuard checks hasModuleAccess via usePermissions and blocks otherwise',
    ],
    recommendation:
      'Confirm the module permission is granted only to intended operators; keep new admin routes behind ModuleGuard.',
    targetPhase: '10A',
  },

  // -------------------------------------------------------------------------
  // RLS / Database
  // -------------------------------------------------------------------------
  {
    id: 'PDF-HARDEN-RLS-001',
    domain: 'rls_database',
    title: 'template_imports RLS/ownership model is documented',
    description:
      'template_imports carries a user_id owner column, and all privileged access flows through the service-role edge function which enforces ownership on every read/write.',
    severity: 'high',
    likelihood: 'possible',
    status: 'pass',
    owner: 'developer_backend',
    evidence: [
      'template-import-pdf/index.ts: user_id ownership checks on get_status, get_artifacts, record_review_decision, list_recent_imports',
    ],
    recommendation:
      'Confirm base-table RLS on template_imports with the Phase 10A SQL (section 13/14) and document the policy set.',
    targetPhase: '10A',
  },
  {
    id: 'PDF-HARDEN-RLS-002',
    domain: 'rls_database',
    title: 'report_templates RLS/ownership model is documented',
    description:
      'report_templates ownership boundaries must be confirmed against live RLS policies; not fully verified from the PDF import source review alone.',
    severity: 'high',
    likelihood: 'possible',
    status: 'unknown',
    owner: 'developer_backend',
    evidence: [],
    recommendation:
      'Run the Phase 10A SQL RLS visibility section and document report_templates policies; confirm no broad public write.',
    targetPhase: '10A',
  },
  {
    id: 'PDF-HARDEN-RLS-003',
    domain: 'rls_database',
    title: 'pdf_import_golden_runs access is restricted',
    description:
      'pdf_import_golden_runs has RLS enabled: SELECT is limited to the linked import owner or admin, and writes are service-role only.',
    severity: 'high',
    likelihood: 'possible',
    status: 'pass',
    owner: 'developer_backend',
    evidence: [
      'migrations/20260705000000_create_pdf_import_golden_runs.sql: ENABLE ROW LEVEL SECURITY',
      'SELECT policy via template_imports owner/has_role admin; service_role FOR ALL',
    ],
    recommendation:
      'Confirm the policies remain in place with the Phase 10A SQL section 13/14.',
    targetPhase: '10A',
  },
  {
    id: 'PDF-HARDEN-RLS-004',
    domain: 'rls_database',
    title: 'History rows reference valid imports/templates',
    description:
      'Golden run history rows reference template_imports via a NOT NULL foreign key with ON DELETE CASCADE, preventing orphaned history.',
    severity: 'medium',
    likelihood: 'unlikely',
    status: 'pass',
    owner: 'developer_backend',
    evidence: [
      'migration: import_id uuid NOT NULL REFERENCES public.template_imports(id) ON DELETE CASCADE',
    ],
    recommendation:
      'Confirm no history rows have a missing import reference via the Phase 10A SQL section 8.',
    targetPhase: '10A',
  },

  // -------------------------------------------------------------------------
  // Storage
  // -------------------------------------------------------------------------
  {
    id: 'PDF-HARDEN-STORAGE-001',
    domain: 'storage',
    title: 'template-import-artifacts bucket is not broadly public',
    description:
      'The template-import-artifacts bucket must not be public. This is not set in migrations, so the bucket public flag has to be confirmed against the live project.',
    severity: 'critical',
    likelihood: 'possible',
    status: 'unknown',
    owner: 'developer_backend',
    evidence: [],
    recommendation:
      'Run the Phase 10A SQL section 6 (storage.buckets) and confirm public=false; if public, remediate immediately and document.',
    targetPhase: '10A',
  },
  {
    id: 'PDF-HARDEN-STORAGE-002',
    domain: 'storage',
    title: 'Artifact paths are scoped by import ID',
    description:
      'Artifact object names should be scoped by import ID so one import cannot address another import artifact. Object naming should be confirmed against live storage.',
    severity: 'high',
    likelihood: 'unlikely',
    status: 'unknown',
    owner: 'developer_backend',
    evidence: [],
    recommendation:
      'Confirm artifact paths embed the import ID via the Phase 10A SQL section 5 and code review of the upload paths.',
    targetPhase: '10A',
  },
  {
    id: 'PDF-HARDEN-STORAGE-003',
    domain: 'storage',
    title: 'Signed URLs are time-limited',
    description:
      'Artifact and diagnostics reads use createSignedUrl with a bounded TTL (1 hour), so URLs expire rather than being permanent public links.',
    severity: 'medium',
    likelihood: 'possible',
    status: 'pass',
    owner: 'developer_backend',
    evidence: [
      'template-import-pdf/index.ts: PDF_DIAGNOSTICS_SIGNED_URL_TTL_SECONDS = 60 * 60',
      'createSignedUrl(path, 3600) for visual artifact reads',
    ],
    recommendation:
      'Keep TTLs short; avoid ever returning permanent/public artifact URLs to the browser.',
    targetPhase: '10A',
  },
  {
    id: 'PDF-HARDEN-STORAGE-004',
    domain: 'storage',
    title: 'Storage object presence is observable',
    description:
      'Artifact paths recorded on imports can be reconciled against storage.objects to detect missing or duplicate objects.',
    severity: 'medium',
    likelihood: 'unlikely',
    status: 'pass',
    owner: 'developer_backend',
    evidence: [
      'scripts/regression/pdf-import-phase-10a-hardening-check.sql section 5 joins artifact paths to storage.objects',
    ],
    recommendation:
      'Run the Phase 10A SQL section 5 during pre-release checks and investigate any missing_storage_object rows.',
    targetPhase: '10A',
  },

  // -------------------------------------------------------------------------
  // Edge Functions
  // -------------------------------------------------------------------------
  {
    id: 'PDF-HARDEN-EDGE-001',
    domain: 'edge_functions',
    title: 'Unknown operations return safe errors',
    description:
      'An unrecognised operation returns a 400 JSON error naming the operation, instead of falling through to an unsafe default.',
    severity: 'medium',
    likelihood: 'possible',
    status: 'pass',
    owner: 'developer_backend',
    evidence: [
      'template-import-pdf/index.ts: return json({ error: `unknown operation: ${operation}`, operation }, 400)',
    ],
    recommendation:
      'Keep the explicit unknown-operation guard; never add a permissive default branch.',
    targetPhase: '10A',
  },
  {
    id: 'PDF-HARDEN-EDGE-002',
    domain: 'edge_functions',
    title: 'append_meta cannot bypass ownership',
    description:
      'append_meta loads the import, checks the owner against authedUserId (service_role excepted), and rejects unauthorized callers before merging meta.',
    severity: 'critical',
    likelihood: 'possible',
    status: 'pass',
    owner: 'developer_backend',
    evidence: [
      'template-import-pdf/index.ts append_meta: rec.user_id !== authedUserId && auth.userId !== "service_role" -> forbidden',
    ],
    recommendation:
      'Keep the ownership guard on append_meta; ensure merged meta cannot overwrite ownership fields.',
    targetPhase: '10A',
  },
  {
    id: 'PDF-HARDEN-EDGE-003',
    domain: 'edge_functions',
    title: 'Export parity save validates payload',
    description:
      'save_export_parity performs an ownership check and writes the export parity summary through a controlled meta merge rather than accepting arbitrary rows.',
    severity: 'high',
    likelihood: 'possible',
    status: 'pass',
    owner: 'developer_backend',
    evidence: [
      'template-import-pdf/index.ts save_export_parity: ownership guard + controlled meta write',
    ],
    recommendation:
      'Confirm the persisted export parity summary conforms to the strict ExportParitySummary contract before writing.',
    targetPhase: '10A',
  },
  {
    id: 'PDF-HARDEN-EDGE-004',
    domain: 'edge_functions',
    title: 'Golden history save validates payload',
    description:
      'save_golden_run_history maps the history input to a fixed column set (goldenRunInputToColumns) after an ownership check, so unexpected fields are not persisted.',
    severity: 'high',
    likelihood: 'possible',
    status: 'pass',
    owner: 'developer_backend',
    evidence: [
      'template-import-pdf/index.ts save_golden_run_history: ownership guard + goldenRunInputToColumns(history, importId, authedUserId)',
    ],
    recommendation:
      'Keep the column-mapping approach; reject rather than coerce clearly malformed history payloads.',
    targetPhase: '10A',
  },
  {
    id: 'PDF-HARDEN-EDGE-005',
    domain: 'edge_functions',
    title: "get/list operations do not leak other users' imports",
    description:
      'list_recent_imports, list_golden_run_history, get_golden_run_history and get_latest_golden_run_baselines restrict results to the caller unless they are admin or service_role.',
    severity: 'critical',
    likelihood: 'possible',
    status: 'pass',
    owner: 'developer_backend',
    evidence: [
      'list_recent_imports: query.eq("user_id", authedUserId) unless admin',
      'golden history reads: template_imports!inner(user_id) with restrict = !isAdmin && !service_role',
    ],
    recommendation:
      'Keep the ownership restriction on every read/list path; add tests when a new list operation is added.',
    targetPhase: '10A',
  },

  // -------------------------------------------------------------------------
  // Sidecar
  // -------------------------------------------------------------------------
  {
    id: 'PDF-HARDEN-SIDECAR-001',
    domain: 'sidecar',
    title: 'Sidecar failures are recorded',
    description:
      'PDF parse/sidecar failures are recorded in pdf_import_jobs (status, error_code, error_text) and surfaced via diagnostics.',
    severity: 'high',
    likelihood: 'possible',
    status: 'pass',
    owner: 'developer_sidecar',
    evidence: [
      'pdf_import_jobs has status/error_code/error_text/stage columns queried by the Phase 10A SQL section 11',
    ],
    recommendation:
      'Confirm failed jobs carry actionable error_code/error_text via the Phase 10A SQL sections 11/12.',
    targetPhase: '10A',
  },
  {
    id: 'PDF-HARDEN-SIDECAR-002',
    domain: 'sidecar',
    title: 'Engine version is captured',
    description:
      'Engine version is captured on pdf_import_jobs and on the import manifest summary for traceability.',
    severity: 'medium',
    likelihood: 'possible',
    status: 'pass',
    owner: 'developer_sidecar',
    evidence: [
      'pdf_import_jobs.engine_version column; template_imports.meta->import_manifests_summary->engine_version',
    ],
    recommendation:
      'Track jobs_missing_engine_version via the Phase 10A SQL section 12 and investigate non-zero counts.',
    targetPhase: '10A',
  },
  {
    id: 'PDF-HARDEN-SIDECAR-003',
    domain: 'sidecar',
    title: 'Large/complex PDF limits are documented',
    description:
      'Documented handling and limits for large or complex PDFs (page count, duration, timeouts) are not yet fully captured; needs a written limit/timeout policy.',
    severity: 'medium',
    likelihood: 'possible',
    status: 'unknown',
    owner: 'developer_sidecar',
    evidence: [],
    recommendation:
      'Document sidecar timeouts and size/page limits; use the Phase 10A SQL section 12 duration buckets as the empirical basis. Defer enforcement to Phase 10F.',
    targetPhase: '10F',
  },

  // -------------------------------------------------------------------------
  // Data Privacy
  // -------------------------------------------------------------------------
  {
    id: 'PDF-HARDEN-PRIVACY-001',
    domain: 'data_privacy',
    title: 'Private PDFs are not committed',
    description:
      'Private/client PDFs, rasters and screenshots are gitignored and must never be staged.',
    severity: 'critical',
    likelihood: 'possible',
    status: 'pass',
    owner: 'security',
    evidence: [
      '.gitignore: audit-output/ (local-only PDF import testing artifacts); *.log ignored',
      'Phase 10A local hardening script scans staged files for pdf/png/env/service_role patterns',
    ],
    recommendation:
      'Keep the gitignore rules and run the Phase 10A local hardening check before every commit.',
    targetPhase: '10A',
  },
  {
    id: 'PDF-HARDEN-PRIVACY-002',
    domain: 'data_privacy',
    title: 'audit-output is not committed',
    description:
      'The audit-output directory (local PDF baselines / generated artifacts) is gitignored.',
    severity: 'high',
    likelihood: 'unlikely',
    status: 'pass',
    owner: 'security',
    evidence: ['.gitignore: audit-output/'],
    recommendation:
      'Never add audit-output/ explicitly; keep the ignore rule.',
    targetPhase: '10A',
  },
  {
    id: 'PDF-HARDEN-PRIVACY-003',
    domain: 'data_privacy',
    title: 'Logs avoid raw PDF content and PII',
    description:
      'Backend logging observed is structured metadata (error message/details/hint/code), not raw PDF bytes; a focused review is still recommended to guarantee no PII/document text is logged anywhere.',
    severity: 'high',
    likelihood: 'possible',
    status: 'warning',
    owner: 'developer_backend',
    evidence: [
      'template-import-finalize-worker/index.ts logs structured DB error fields, not raw PDF content',
    ],
    recommendation:
      'Complete a focused log-scrub review across the PDF import functions to confirm no PDF text/PII is logged; record findings in the risk register.',
    targetPhase: '10A',
  },

  // -------------------------------------------------------------------------
  // Operator Console
  // -------------------------------------------------------------------------
  {
    id: 'PDF-HARDEN-OPERATOR-001',
    domain: 'operator_console',
    title: 'Evaluate Only is read-only',
    description:
      'In evaluate_only mode the console never persists: persist, saveHistory and persistExportParity are gated on mode === "evaluate_and_persist".',
    severity: 'high',
    likelihood: 'possible',
    status: 'pass',
    owner: 'developer_frontend',
    evidence: [
      'goldenCorpusConsoleState.ts: persist = mode === "evaluate_and_persist"; saveHistory gated on the same',
    ],
    recommendation:
      'Keep persistence strictly gated on the explicit persist mode.',
    targetPhase: '10A',
  },
  {
    id: 'PDF-HARDEN-OPERATOR-002',
    domain: 'operator_console',
    title: 'Evaluate + Persist requires confirmation',
    description:
      'Persisting requires selecting the explicit evaluate_and_persist mode, and the console warns when the operator decision is still "not reviewed" before persisting.',
    severity: 'high',
    likelihood: 'possible',
    status: 'pass',
    owner: 'developer_frontend',
    evidence: [
      'goldenCorpusConsoleState.ts: warn("operatorDecision", "operator_not_reviewed", ...) when persisting unreviewed',
    ],
    recommendation:
      'Keep the explicit mode + pre-persist warnings; consider a confirm dialog for failed/blocked persists.',
    targetPhase: '10A',
  },
  {
    id: 'PDF-HARDEN-OPERATOR-003',
    domain: 'operator_console',
    title: 'Failed/blocked persisted results are clearly marked',
    description:
      'Persisted golden runs record quality_gate_status and operator_decision so failed/blocked evidence is clearly distinguishable from passes.',
    severity: 'medium',
    likelihood: 'unlikely',
    status: 'pass',
    owner: 'developer_frontend',
    evidence: [
      'pdf_import_golden_runs.quality_gate_status / operator_decision persisted per run',
    ],
    recommendation:
      'Keep status/decision visible in the console and diagnostics.',
    targetPhase: '10A',
  },

  // -------------------------------------------------------------------------
  // Golden Regression
  // -------------------------------------------------------------------------
  {
    id: 'PDF-HARDEN-GOLDEN-001',
    domain: 'golden_regression',
    title: 'Golden regression summaries include required version/status fields',
    description:
      'Persisted golden_regression_summary carries version, runId, corpusId, qualityGateStatus, operatorDecision and persistedAt.',
    severity: 'high',
    likelihood: 'unlikely',
    status: 'pass',
    owner: 'developer_backend',
    evidence: [
      'Phase 10A SQL section 7 validates version/runId/corpusId/qualityGateStatus/operatorDecision/persistedAt',
    ],
    recommendation:
      'Run the Phase 10A SQL section 7 and investigate any fail_missing_* rows.',
    targetPhase: '10A',
  },
  {
    id: 'PDF-HARDEN-GOLDEN-002',
    domain: 'golden_regression',
    title: 'Golden history rows do not store raw files',
    description:
      'The golden run history table stores metadata and scores only, never source PDFs or raster artifacts.',
    severity: 'critical',
    likelihood: 'rare',
    status: 'pass',
    owner: 'developer_backend',
    evidence: [
      'migration comment: "Stores metadata only, never source PDFs or raster artifacts."',
    ],
    recommendation:
      'Keep history strictly metadata; never add a raw-artifact column.',
    targetPhase: '10A',
  },
  {
    id: 'PDF-HARDEN-GOLDEN-003',
    domain: 'golden_regression',
    title: 'Baseline comparison is bounded to same corpus',
    description:
      'Baseline comparison selects the latest prior run for the same corpus_id, so runs are not compared across unrelated corpus items.',
    severity: 'medium',
    likelihood: 'unlikely',
    status: 'pass',
    owner: 'developer_backend',
    evidence: [
      'get_latest_golden_run_baselines / baseline comparison keyed by corpus_id',
    ],
    recommendation:
      'Keep baseline selection scoped by corpus_id.',
    targetPhase: '10A',
  },

  // -------------------------------------------------------------------------
  // Export Parity
  // -------------------------------------------------------------------------
  {
    id: 'PDF-HARDEN-EXPORT-001',
    domain: 'export_parity',
    title:
      'Export parity automation fails safely when export rasterization is unavailable',
    description:
      'When export rasterization evidence is missing, the runner returns manual_required/partial rather than a hallucinated completed result.',
    severity: 'high',
    likelihood: 'possible',
    status: 'pass',
    owner: 'developer_frontend',
    evidence: [
      'exportParity runner returns manual_required when evidence is insufficient (Phase 9D)',
    ],
    recommendation:
      'Keep the safe-fallback semantics; never synthesise a completed status without real evidence.',
    targetPhase: '10A',
  },
  {
    id: 'PDF-HARDEN-EXPORT-002',
    domain: 'export_parity',
    title: 'Manual export parity remains supported',
    description:
      'The manual export parity mode remains available alongside the automated runner.',
    severity: 'medium',
    likelihood: 'unlikely',
    status: 'pass',
    owner: 'operator',
    evidence: ['ExportParitySummary supports mode manual/automated/hybrid'],
    recommendation: 'Keep manual mode as the fallback for low-evidence imports.',
    targetPhase: '10A',
  },
  {
    id: 'PDF-HARDEN-EXPORT-003',
    domain: 'export_parity',
    title: 'Export parity persistence is explicit',
    description:
      'Export parity is only persisted when the operator explicitly enables run + persist; it is not written as a side effect.',
    severity: 'high',
    likelihood: 'unlikely',
    status: 'pass',
    owner: 'developer_frontend',
    evidence: [
      'goldenCorpusConsoleState.ts: persistExportParity = form.runExportParity && form.persistExportParity',
    ],
    recommendation: 'Keep export parity persistence behind an explicit toggle.',
    targetPhase: '10A',
  },

  // -------------------------------------------------------------------------
  // Observability
  // -------------------------------------------------------------------------
  {
    id: 'PDF-HARDEN-OBS-001',
    domain: 'observability',
    title: 'pdf_import_jobs captures import failures',
    description:
      'pdf_import_jobs records stage, status, error_code and error_text so import/parse failures are diagnosable.',
    severity: 'high',
    likelihood: 'possible',
    status: 'pass',
    owner: 'developer_backend',
    evidence: [
      'Phase 10A SQL sections 11/12 read pdf_import_jobs status/stage/error_code/error_text/duration_ms',
    ],
    recommendation:
      'Run the Phase 10A SQL sections 11/12 during pre-release checks.',
    targetPhase: '10A',
  },
  {
    id: 'PDF-HARDEN-OBS-002',
    domain: 'observability',
    title: 'Template Import Quality surfaces action-required state',
    description:
      'The Template Import Quality dashboard surfaces Visual QA / repair / export / golden state so operators can see what needs attention.',
    severity: 'medium',
    likelihood: 'unlikely',
    status: 'pass',
    owner: 'developer_frontend',
    evidence: ['src/pages/admin/TemplateImportQuality.tsx'],
    recommendation:
      'Confirm the dashboard highlights failed/manual states during the manual smoke test.',
    targetPhase: '10A',
  },
  {
    id: 'PDF-HARDEN-OBS-003',
    domain: 'observability',
    title: 'Failure triage maps common failures to recovery actions',
    description:
      'The failure triage playbook/evaluator maps common failure signals to recovery actions and owners.',
    severity: 'medium',
    likelihood: 'unlikely',
    status: 'pass',
    owner: 'qa',
    evidence: [
      'src/lib/reportTemplate/ingestion/failureTriage/ + phase-8f-failure-triage-playbook.md',
    ],
    recommendation: 'Keep triage rules aligned with observed production failures.',
    targetPhase: '10A',
  },

  // -------------------------------------------------------------------------
  // Performance / Cost
  // -------------------------------------------------------------------------
  {
    id: 'PDF-HARDEN-PERF-001',
    domain: 'performance_cost',
    title: 'AI reconciliation is operator-triggered/governed',
    description:
      'AI reconciliation should run only on explicit operator/user action, not automatically on every import; full governance of trigger points needs confirmation.',
    severity: 'high',
    likelihood: 'possible',
    status: 'unknown',
    owner: 'developer_fullstack',
    evidence: [],
    recommendation:
      'Confirm AI reconciliation has no automatic per-import trigger and is governed by an explicit action; document cost controls. Defer tightening to Phase 10D.',
    targetPhase: '10D',
  },
  {
    id: 'PDF-HARDEN-PERF-002',
    domain: 'performance_cost',
    title: 'Export parity automation avoids unnecessary repeated persistence',
    description:
      'Export parity automation persists only when explicitly requested, avoiding duplicate expensive writes.',
    severity: 'medium',
    likelihood: 'unlikely',
    status: 'pass',
    owner: 'developer_frontend',
    evidence: [
      'goldenCorpusConsoleState.ts: persistExportParity requires runExportParity && persistExportParity',
    ],
    recommendation: 'Keep persistence explicit; avoid re-running parity needlessly.',
    targetPhase: '10A',
  },
  {
    id: 'PDF-HARDEN-PERF-003',
    domain: 'performance_cost',
    title: 'History/diagnostics queries are bounded',
    description:
      'History and diagnostics read paths are bounded with LIMIT and backed by indexes on the golden runs table.',
    severity: 'medium',
    likelihood: 'unlikely',
    status: 'pass',
    owner: 'developer_backend',
    evidence: [
      'pdf_import_golden_runs indexes on corpus_id/created_at, quality_gate_status, operator_decision, import_id, template_id',
      'Phase 10A SQL read sections use LIMIT',
    ],
    recommendation: 'Keep LIMIT bounds on all history/diagnostics reads.',
    targetPhase: '10A',
  },

  // -------------------------------------------------------------------------
  // Rollout
  // -------------------------------------------------------------------------
  {
    id: 'PDF-HARDEN-ROLLOUT-001',
    domain: 'rollout',
    title: 'Final regression SQL checks exist',
    description:
      'Read-only final regression/rollout SQL checks exist (Phase 9 final check + Phase 10A hardening check).',
    severity: 'medium',
    likelihood: 'rare',
    status: 'pass',
    owner: 'developer_fullstack',
    evidence: [
      'scripts/regression/pdf-import-phase-9-final-check.sql',
      'scripts/regression/pdf-import-phase-10a-hardening-check.sql',
    ],
    recommendation: 'Run both SQL checks before broad rollout.',
    targetPhase: '10A',
  },
  {
    id: 'PDF-HARDEN-ROLLOUT-002',
    domain: 'rollout',
    title: 'Production blockers are documented before Phase 10B',
    description:
      'Production hardening blockers and warnings are documented in the audit + risk register before Phase 10B import intelligence begins.',
    severity: 'high',
    likelihood: 'unlikely',
    status: 'pass',
    owner: 'developer_fullstack',
    evidence: [
      'docs/pdf-import/phase-10a-production-hardening-audit.md',
      'docs/pdf-import/phase-10a-production-hardening-risk-register.template.md',
    ],
    recommendation:
      'Keep the risk register current; resolve criticals before Phase 10B.',
    targetPhase: '10A',
  },
  {
    id: 'PDF-HARDEN-ROLLOUT-003',
    domain: 'rollout',
    title: 'No private artifacts are staged',
    description:
      'No private PDFs, screenshots, generated PDFs, logs, env files or config backups are staged for commit.',
    severity: 'critical',
    likelihood: 'possible',
    status: 'pass',
    owner: 'security',
    evidence: [
      'Phase 10A commit verified with git status --short; local hardening script scans staged files',
    ],
    recommendation:
      'Run the private-artifact check before every commit; never bypass it.',
    targetPhase: '10A',
  },
];

/** Return a defensive copy of the full checklist. */
export function listPdfImportHardeningChecks(): PdfImportHardeningCheck[] {
  return PDF_IMPORT_HARDENING_CHECKLIST.map((check) => ({
    ...check,
    evidence: [...check.evidence],
  }));
}

/** Look up a single check by id, or null when absent. */
export function getPdfImportHardeningCheckById(
  id: string,
): PdfImportHardeningCheck | null {
  const found = PDF_IMPORT_HARDENING_CHECKLIST.find((check) => check.id === id);
  return found ? { ...found, evidence: [...found.evidence] } : null;
}

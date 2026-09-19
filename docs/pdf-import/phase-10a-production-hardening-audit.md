# PDF Import Phase 10A — Production Readiness Hardening Audit

## Objective

Phase 10A audits the PDF import system for production readiness after Phase 9
completion.

The audit covers security, access control, storage safety, Edge Function
contracts, operator safety, observability, performance risk, cost risk, and
rollout blockers. It establishes a hardening baseline **before** Phase 10B adds
import intelligence. It does not add pipeline behaviour.

## Current System Baseline

The PDF import system under audit comprises:

- Docling-only PDF parse sidecar (Cloud Run).
- Supabase Edge Function import orchestration (`template-import-pdf`).
- Async finalization worker (`template-import-finalize-worker`).
- Template Builder PDF import flow.
- Staged import artifacts with source / generated / diff visual evidence.
- Visual QA and deterministic repair with repair audit persistence.
- Apply Repair / Apply current draft flow.
- AI reconciliation policy/audit.
- Export parity persistence + automated/semi-automated export parity runner.
- Golden corpus registry, runner, quality gates.
- Golden regression summary persistence and golden run history table
  (`public.pdf_import_golden_runs`) with baseline comparison.
- Operator golden regression console.
- Diagnostics dashboard visibility and failure triage playbook/rules/evaluator.
- Phase 9 operational automation layer (orchestrator, history/baselines, release
  gates, monitoring readiness, rollout lock).

## What Phase 10A Does

- Creates a production hardening checklist (40 checks across 12 domains).
- Creates a risk register template.
- Creates read-only SQL hardening validation.
- Creates TypeScript audit checklist definitions and a deterministic evaluator.
- Adds evaluator tests.
- Documents blockers, warnings, and recommended next actions.

## What Phase 10A Does Not Do

- Does not modify production behaviour.
- Does not add self-healing.
- Does not add import profiling.
- Does not add repair patterns.
- Does not change thresholds or quality gate semantics.
- Does not modify the sidecar.
- Does not upload PDFs.
- Does not create migrations unless a critical defect requires immediate action
  (none was found this phase).

## Audit Domains

### Security and Auth — PASS

- Every `template-import-pdf` operation resolves auth via
  `verifyAuthOrNativeUser` and returns 401 on failure before dispatch.
  `authedUserId = auth.userId && auth.userId !== 'service_role' ? auth.userId :
  null`.
- All write operations (`append_meta`, `save_visual_quality`,
  `save_visual_repair_audit`, `save_export_parity`, `save_golden_run_history`)
  compare the import owner to `authedUserId` and reject with 403 unless the
  caller owns the import or is `service_role`.
- Admin PDF routes (`pdf-import-diagnostics`, `template-import-quality`,
  `pdf-golden-regression`, `pdf-import-engine`) are wrapped in
  `<ModuleGuard moduleKey="templates">` (permission-checked, not public).
- The service role key is used only inside the Edge Function; the browser client
  is anonymous under this app's custom-auth flow.

### RLS and Database Access — PASS

- **Live-confirmed:** RLS is enabled on `template_imports`, `report_templates`,
  `pdf_import_jobs`, and `pdf_import_golden_runs` (section 14).
- `pdf_import_golden_runs`: SELECT limited to the linked import owner or admin;
  writes are service-role only (migration
  `20260705000000_create_pdf_import_golden_runs.sql`).
- History rows reference `template_imports(id)` via a NOT NULL foreign key with
  `ON DELETE CASCADE`, so history cannot orphan.
- `report_templates` base-table policy set was not exhaustively reviewed from the
  PDF import source alone — left as an `unknown` check to close with section 13.

### Storage Safety — PASS (with observations)

- **Live-confirmed (section 6):** `template-import-artifacts` (source PDFs,
  rasters, diffs, generated PDFs, export parity artifacts) is **private**
  (`public=false`). `pdf-import-diagnostics` is also **private**.
- Signed URLs are time-limited: `PDF_DIAGNOSTICS_SIGNED_URL_TTL_SECONDS = 3600`
  and `createSignedUrl(path, 3600)` for artifact reads.
- Storage object presence is reconcilable against `storage.objects` (section 5).
- **Observation (risk register PDF-HARDEN-STORAGE-005):** the
  `template-import-assets` and `report-templates` buckets are **public**. These
  are expected to hold template design assets / rendered report outputs rather
  than private source PDFs, but Phase 10A recommends confirming that no private
  source PDFs or private rasters are ever written to `template-import-assets`.
- Artifact object path scoping by import ID was not exhaustively verified from
  SQL alone — left `unknown` to close with a code review of the upload paths.

### Edge Function Contract Safety — PASS

- Unknown operations return `json({ error: 'unknown operation: <op>', operation
  }, 400)` — no permissive default branch.
- `append_meta` loads the import, checks ownership, and merges meta only for the
  owner/service role.
- `save_export_parity` and `save_golden_run_history` perform ownership checks;
  history is written through `goldenRunInputToColumns` (a fixed column map), so
  unexpected fields are not persisted.
- `list_recent_imports`, `list_golden_run_history`, `get_golden_run_history`, and
  `get_latest_golden_run_baselines` restrict results to the caller unless admin or
  service role (`template_imports!inner(user_id)` join with a restrict flag).

### Cloud Run Sidecar Risk — PASS (limits undocumented)

- Sidecar/parse failures are recorded in `pdf_import_jobs`
  (`status`, `stage`, `error_code`, `error_text`, `duration_ms`).
- Engine version is captured on `pdf_import_jobs.engine_version` and on
  `template_imports.meta->import_manifests_summary->engine_version`.
- **Gap:** large/complex PDF limits and sidecar timeouts are not written down.
  Left `unknown`; recommend a documented limit/timeout policy in Phase 10F using
  the section 12 duration buckets as the empirical basis. The sidecar itself is
  out of scope for Phase 10A.

### Data Privacy and Artifact Hygiene — PASS (log-scrub recommended)

- `.gitignore` ignores `audit-output/` (local PDF baselines / private
  PDFs/screenshots) and `*.log`.
- The golden run history table stores metadata only — the migration explicitly
  states "Stores metadata only, never source PDFs or raster artifacts."
- Observed backend logging is structured DB-error metadata (message/details/
  hint/code), not raw PDF bytes.
- **Warning:** a focused log-scrub review across all PDF import functions is
  recommended to guarantee no document text/PII is logged anywhere (risk register
  PDF-HARDEN-PRIVACY-003).

### Operator Console Safety — PASS

- `evaluate_only` never persists: `persist`, `saveHistory`, and
  `persistExportParity` are gated on `mode === 'evaluate_and_persist'`.
- Persisting requires selecting the explicit persist mode, and the console warns
  when the operator decision is still `not_reviewed`.
- Export parity persistence requires `runExportParity && persistExportParity`.
- Persisted golden runs record `quality_gate_status` / `operator_decision`, so
  failed/blocked evidence is clearly marked.

### Golden Regression Integrity — PASS

- `golden_regression_summary` carries `version`, `runId`, `corpusId`,
  `qualityGateStatus`, `operatorDecision`, `persistedAt` (validated by SQL
  section 7).
- One history row per run; history is metadata only.
- Baseline comparison is scoped by `corpus_id`.

### Export Parity Safety — PASS

- When export rasterization evidence is missing, the runner returns
  `manual_required` / partial rather than a hallucinated `completed`.
- Manual export parity remains supported (`mode` manual/automated/hybrid).
- Export parity persistence is explicit and visible in diagnostics.

### Observability and Diagnostics — PASS

- `pdf_import_jobs` captures parser/sidecar stages, status, and errors.
- `template_imports.status` / `error` are meaningful.
- Template Import Quality surfaces Visual QA / repair / export / golden state.
- Failure triage maps common failures to recovery actions and owners.
- Final SQL checks exist (Phase 9 final check + this Phase 10A check).

### Performance and Cost Risk — PASS (reconciliation governance to confirm)

- History/diagnostics reads are bounded with `LIMIT` and backed by indexes on
  `pdf_import_golden_runs` (corpus_id/created_at, quality_gate_status,
  operator_decision, import_id, template_id, run_batch_id, created_at).
- Export parity automation persists only when explicitly requested.
- **Gap:** AI reconciliation trigger governance (that it never runs automatically
  per-import and is always an explicit action) is left `unknown` to confirm; any
  tightening is deferred to Phase 10D.

### Production Rollout Blockers

Classified blockers:

- **critical:** none found.
- **high:** none blocking; deferred hardening actions tracked in the risk
  register (log-scrub review, AI reconciliation governance, `report_templates`
  policy documentation).
- **medium:** public `template-import-assets` bucket confirmation; documented
  sidecar limits; artifact path-scoping confirmation.
- **low/info:** legacy data warnings (see below).

Legacy-data warnings (from SQL section 17, not introduced by any Phase 7–10 work
and not blocking):

- 102 imports failed / carrying an error (legacy).
- 16 imports stale (non-terminal > 30 min, legacy).
- 96 completed imports missing Visual QA (predate the Visual QA phase).
- 31 failed/recoverable PDF jobs; 5 jobs missing engine version.
- 0 completed-without-template, 0 failing golden summaries, 0 failing golden
  history rows → **no production blockers**.

## Risk Scoring

Severity: `critical` / `high` / `medium` / `low` / `info`.
Likelihood: `frequent` / `likely` / `possible` / `unlikely` / `rare`.
Status: `pass` / `warning` / `fail` / `unknown` / `not_applicable`.
Production decision: `ready` / `ready_with_warnings` / `not_ready`.

Score model (see `pdfImportHardeningEvaluator.ts`): start at 100; each `fail`
subtracts the full severity weight (critical 15, high 8, medium 4, low 2,
info 1), each `warning` subtracts half, each `unknown` subtracts a quarter;
`pass` / `not_applicable` subtract nothing; clamp to [0, 100].

## Required Output

Evaluating the Phase 10A checklist (`PDF_IMPORT_HARDENING_CHECKLIST`, 40 checks):

- **Readiness score:** 85 / 100.
- **Counts:** pass 34, warning 1, unknown 5, fail 0, not_applicable 0.
- **Critical failures:** 0. **High failures:** 0.
- **Critical blockers:** none.
- **High-priority hardening actions:**
  1. Complete a log-scrub review of the PDF import functions (PRIVACY-003,
     warning).
  2. Confirm AI reconciliation is never auto-triggered per import (PERF-001,
     unknown → Phase 10D).
  3. Document `report_templates` RLS policies (RLS-002, unknown).
  4. Confirm `template-import-artifacts` remains private and confirm the contents
     policy for the public `template-import-assets` bucket (STORAGE-001 passed
     live; STORAGE-005 observation).
  5. Document sidecar size/timeout limits (SIDECAR-003, unknown → Phase 10F).
  6. Confirm artifact path scoping by import ID (STORAGE-002, unknown).
- **Acceptable warnings:** legacy failed/stale imports and legacy imports missing
  Visual QA; these are pre-existing and non-blocking.
- **Recommended next phase readiness:** proceed to Phase 10B — Import Intelligence
  Profile Layer — after logging the six hardening actions above in the risk
  register with owners.

**Production readiness decision: `ready_with_warnings`.**

## Phase 10A Acceptance Criteria

- [x] audit doc exists
- [x] risk register template exists
- [x] SQL hardening check exists
- [x] TypeScript hardening checklist exists (40 checks, 12 domains)
- [x] evaluator tests pass
- [x] build passes
- [x] no private files committed
- [x] no production behaviour changed

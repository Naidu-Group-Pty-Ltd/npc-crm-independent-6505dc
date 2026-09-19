# PDF Import Phase 11A — Production Rollout Readiness Review

## Objective

Phase 11A starts production rollout governance for the PDF import system. It
reviews whether the Phase 7–10 PDF import engine is ready for controlled
production usage.

## Why This Exists

Phase 10 made the system intelligent, governed, auditable, and operator-safe.
Production rollout, however, requires more than working code: it needs
permissions, monitoring, alerts, runbooks, a rollback strategy, artifact
retention rules, a support process, release governance, operator training, and a
controlled rollout scope. Phase 11A determines what is ready now and what must
happen next.

## What Phase 11A Does

- Creates a rollout readiness review and decision framework.
- Defines rollout decision outcomes and rollout modes.
- Defines 13 readiness domains.
- Creates a risk register template, a readiness report template, and an initial
  rollout scope template.
- Creates read-only SQL readiness validation.
- Creates a deterministic TypeScript readiness checklist + evaluator (72 checks).
- Adds tests.
- Identifies gaps for Phase 11B–11H.

## What Phase 11A Does Not Do

- Does not implement permissions, monitoring, CI/release gates, artifact cleanup,
  full runbooks, or client-safe reports (those are Phase 11B–11G).
- Does not create migrations or new functions.
- Does not deploy Cloud Run/Supabase.
- Does not call AI, mutate templates, or change runtime behaviour.

## Rollout Decision Outcomes

- **rollout_ready** — ready for production rollout (all critical/high pass;
  permissions/monitoring/release/runbooks/retention/client impact all pass; no
  fail/warning/unknown; score ≥ 95).
- **rollout_ready_with_conditions** — ready for limited/admin-controlled rollout
  with documented conditions (no critical blockers; score ≥ 70).
- **rollout_not_ready** — a critical blocker exists (critical fail, safety-critical
  unknown/fail, ≥2 high fails, or score < 70).

## Rollout Modes

`internal_dev_only` · `admin_limited` · `controlled_team_rollout` ·
`broad_production` · `blocked`.

## Readiness Domains

`phase10_lock` · `security_access` · `deployment` · `operator_workflow` ·
`permissions` · `monitoring_alerting` · `release_governance` · `data_privacy` ·
`support_runbooks` · `performance_cost` · `artifact_retention` · `client_impact` ·
`rollout_scope`.

## Minimum Initial Rollout Recommendation

Recommended default after Phase 11A: **`admin_limited`**. Broad production should
wait until Phase 11B (permissions), 11C (monitoring/alerting), 11D (release
gates), 11E (retention), and 11F (runbooks) are complete, or until explicitly
approved.

## Critical Blockers

Phase 10 not locked; build/test/final-SQL failure; auth/RLS/storage exposure;
private-artifact exposure; automatic AI call; automatic template mutation;
operator controls bypassing quality gates; no rollback path; no admin-only control
boundary; no failure diagnostics; Cloud Run sidecar unavailable with no fallback;
unsafe Edge Function write path.

## Acceptable Conditions for Limited Rollout

Historical imports lacking Phase 10 metadata; export parity `manual_required` where
rasterization is unavailable; OCR/scanned imports requiring manual review;
self-healing manual-only actions requiring operator workflow; monitoring alerts not
fully automated yet (with scheduled manual checks); CI release gates not automated
yet (with enforced manual regression checks); retention policy not automated yet
(with monitored storage growth).

## Manual Source Review Findings (this repository)

- **phase10_lock** — PASS. Phase 10H lock docs, completion checklist, final smoke
  test, lock report template, and `pdf-import-phase-10-final-check.sql` all exist;
  the Phase 10 lock decision is recorded as `locked_with_warnings`.
- **security_access** — PASS (with items for 11B). Admin pages are behind protected
  routes; the `template-import-artifacts` storage bucket is **private**
  (`public = false`); RLS is enabled on `template_imports` and
  `pdf_import_golden_runs`; the frontend uses only anon/publishable keys; the only
  Phase 10 metadata write path is `append_meta`. A formal role matrix is deferred
  to Phase 11B.
- **deployment** — WARNING. The `template-import-pdf` function, finalize worker,
  and Cloud Run parse sidecar
  (`https://pdf-parse-service-xxxxxxxx-uc.a.run.app`, australia-southeast1) are
  in use; engine version is recorded on jobs. Formal rollback runbooks are deferred
  to Phase 11F.
- **operator_workflow** — PASS. The Golden Regression console loads; Evaluate Only
  is read-only; Evaluate + Persist requires confirmation; operator controls are
  explicit and audited; manual-only and blocked controls never auto-execute.
- **permissions** — UNKNOWN (Phase 11B). Non-admin/client access is not exposed,
  but a formal role model/permission matrix is not yet defined.
- **monitoring_alerting** — UNKNOWN (Phase 11C). Diagnostics exist
  (`/admin/pdf-import-diagnostics`); automated alerts are not yet defined.
- **release_governance** — WARNING (Phase 11D). Golden regression can be run
  manually; CI/release gates are not yet automated.
- **data_privacy** — PASS. No PDFs, rasters, screenshots, logs, `.env`, or signed
  URLs are committed; metadata stores no raw PDF/OCR text.
- **support_runbooks** — UNKNOWN (Phase 11F). A developer escalation path is
  informal; formal runbooks are not yet authored.
- **performance_cost** — PASS. The Phase 10F advisory audit exists; expensive steps
  require confirmation/manual review; AI is operator-controlled.
- **artifact_retention** — UNKNOWN (Phase 11E). No retention/cleanup policy yet.
- **client_impact** — UNKNOWN (Phase 11G). Client-safe reporting not yet defined.
- **rollout_scope** — PASS (via templates). Initial mode, allowed roles/categories/
  actions are captured in `phase-11a-initial-rollout-scope.template.md`.

Live database-side SQL confirmed: zero automatic-AI completions, zero
manual-only/blocked self-healing completions, zero auto-completed manual operator
controls, and the artifact bucket is private — so no critical safety blocker
exists. The database rollup returns `rollout_ready_with_conditions` /
`admin_limited`.

## Output

- **Rollout decision:** `rollout_ready_with_conditions`
- **Recommended rollout mode:** `admin_limited`
- **Critical blockers:** none
- **Rollout conditions:** define permissions (11B), monitoring/alerting (11C),
  release gates (11D), retention (11E), and runbooks (11F); historical imports lack
  Phase 10 metadata; export parity may be `manual_required`; OCR/high-risk imports
  require manual review.
- **Required next phases:** 11B, 11C, 11D, 11E, 11F, 11G, then 11H.
- **Recommended initial rollout scope:** admin-limited, trusted admins only,
  simple/report/table categories with manual review for OCR/high-risk, metadata
  builds allowed, AI/apply/rerun actions manual-only.

## Acceptance Criteria

- docs exist · risk register exists · report template exists · rollout scope
  template exists · SQL exists · TypeScript checklist/evaluator exists · tests pass
  · build passes · no private artifacts committed.

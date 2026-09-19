# PDF Import Phase 11F — Production Runbooks + SOPs

## Objective

Phase 11F creates the production operating manual for the PDF import system. It
defines how operators, QA users, admins, and developers should safely run,
review, escalate, and communicate PDF import workflows.

## Why This Exists

The PDF import system is now governed by permissions, monitoring, release gates,
and retention policy. Production teams need clear operating procedures. Without
SOPs, operators may misunderstand warning states, blocked actions, manual-only
workflows, export parity limitations, retention candidates, or release gate
failures.

## What Phase 11F Does

- Creates production runbooks (SOPs) under `docs/pdf-import/runbooks/`.
- Creates operator checklists (daily / weekly).
- Creates escalation matrix, operator training checklist, and shift handoff templates.
- Creates a runbook registry, readiness evaluator, and display helper.
- Adds tests and read-only SQL validation.
- Adds optional UI links/panel.

## What Phase 11F Does Not Do

- Does not add runtime behaviour.
- Does not call AI.
- Does not mutate templates.
- Does not delete artifacts or database rows.
- Does not deploy functions or create tables/migrations.
- Does not bypass permissions or replace operator judgement.

## Runbook Audiences

`pdf_viewer` (read-only observer), `pdf_operator` (evaluate + review),
`pdf_qa_operator` (QA review / manual-review flags), `pdf_admin` (persistence,
operator decisions, monitoring/retention actions), `developer_admin` (logs,
storage, deployments, release gates), `business_stakeholder` (client-safe
summaries only).

## Runbook Domains

`orientation`, `daily_operations`, `weekly_operations`, `import_workflow`,
`visual_quality`, `repair`, `adaptive_reconciliation`, `self_healing`,
`export_parity`, `golden_regression`, `monitoring_alerts`, `permissions`,
`retention`, `release_gate`, `incident_response`, `rollback`,
`client_communication`, `escalation`, `training`.

## Required Runbooks

See `runbooks/README.md` for the full index. Critical: operator quick start,
evaluate only, evaluate + persist, monitoring alert response, permission denied,
incident response, rollback + escalation, client communication boundaries. High:
daily operations, weekly QA, visual QA, repair pattern, adaptive reconciliation,
self-healing, export parity, golden regression, retention candidate review,
release gate failure.

## SOP Standard Format

Every operational runbook contains: Purpose · Audience · Required Role /
Capability · When To Use · Preconditions · Procedure · Expected Result · Stop
Conditions · Escalation Path · Evidence To Capture · What Not To Do · Related
Pages / Routes (plus related SQL/alerts where relevant, and client-communication
notes where relevant).

## Final Outcome

By the end of Phase 11F: operators know what to do, admins know what to approve
or block, developers know when to investigate, client-safe boundaries are
documented, and rollout can move toward Phase 11G and 11H.

## Acceptance Criteria

- docs, runbook registry, evaluator, display helper exist.
- tests pass; SQL runs.
- no private artifacts, signed URLs, or raw PDF/OCR content committed.

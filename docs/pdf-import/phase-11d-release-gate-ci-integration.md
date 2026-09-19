# PDF Import Phase 11D — Release Gate / CI Integration

## Objective

Phase 11D creates a release gate for the PDF import production system. The
release gate prevents unsafe changes from shipping. It answers one question:
**can this branch/deployment proceed?**

## Why This Exists

The PDF import system now includes production intelligence, permissions,
monitoring, and operator controls. A regression in any of those layers can
create production risk. The release gate gives the team a repeatable way to
verify PDF import readiness before deployment.

## What Phase 11D Does

- Defines release gate policy.
- Defines release gate checks (63 canonical checks across 16 domains).
- Creates a TypeScript release gate evaluator (scoring + decision).
- Creates file existence checks.
- Creates a private-artifact + unsafe-source safety scanner.
- Creates a report builder (Markdown + JSON).
- Creates a self-contained local/CI CLI script.
- Creates an optional GitHub Actions workflow.
- Creates read-only SQL validation.
- Adds tests.

## What Phase 11D Does Not Do

- Does not mutate production data.
- Does not upload PDFs.
- Does not call AI.
- Does not run imports.
- Does not require production secrets by default.
- Does not deploy Supabase.
- Does not deploy Cloud Run.
- Does not create migrations.
- Does not replace manual QA.
- Does not replace the Phase 11H final rollout lock.

## Gate Modes

### static

Runs local/CI-safe checks only. **Default.**

### live

Runs optional Supabase/Cloud Run checks if secrets are configured (opt-in).

### full

Runs static + live.

Default: **static**.

## Gate Outcomes

- `pass`
- `pass_with_warnings`
- `fail`
- `skipped`

## Blocking Conditions

- build fails
- tests fail
- required source files missing
- required docs missing
- private artifacts staged
- automatic AI execution pattern detected
- automatic template mutation pattern detected
- manual-only auto-execution pattern detected
- permission matrix missing or unsafe
- monitoring modules missing
- golden regression modules missing
- release gate evaluator fails

## Scoring + Decision

The evaluator starts at 100 and subtracts the severity weight for each failing
check (critical 25, high 12, medium 6, low 2, info 0), half the weight for
warnings, a quarter for unknowns, and nothing for skipped. The score is clamped
to `[0, 100]`.

- **fail** — any critical fail, two or more high fails, or score < 75.
- **pass_with_warnings** — no critical fail, score ≥ 75, and some warning /
  unknown / skipped / non-critical fail present.
- **pass** — no fail/warning/unknown and score ≥ 95.
- **skipped** — all checks skipped (or no checks).

## Optional Live Checks

Live checks require secrets and are opt-in (see `phase-11d-ci-setup.md`):

- Supabase SQL readiness check (run `pdf-import-phase-11d-release-gate-check.sql`).
- monitoring `pdf-import-monitoring` Edge Function reachability.
- Cloud Run sidecar `/health` reachability.

Live checks never fail the default static gate when secrets are missing.

## How To Run

Local:

```
npm run pdf-import:release-gate
# or
node scripts/regression/pdf-import-release-gate.mjs --mode=static
```

CI: the optional `.github/workflows/pdf-import-release-gate.yml` runs the static
gate on pull requests and uploads the report artifact.

## Future Consumption

The machine-readable report
(`reports/pdf-import-release-gate/release-gate-report.json`, schema:
`pdf-import-release-gate-report.schema.json`) is stable and can be consumed by a
future Phase 11H final rollout lock.

## Acceptance Criteria

- docs exist.
- config exists.
- CLI exists.
- evaluator exists.
- tests pass.
- build passes.
- release gate script runs.
- optional workflow exists or is documented.
- no private artifacts committed.

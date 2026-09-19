# PDF Import Phase 6 Completion Checklist

## Phase 6 Objective

Phase 6 adds the controlled repair loop on top of the Phase 5 visual QA evidence layer.

Phase 5 measured source-vs-generated visual quality. Phase 6 uses that evidence to classify repair issues, gate safety, run deterministic repair, persist the audit trail, expose repair in the UI, and apply the repaired template back to the live template record.

## Completed Subphases

### 6A — Repair Loop Discovery and Contract Audit

Status: Complete.

Outputs:

- Existing repair modules discovered under visualQuality/repair.
- Existing reconciliation patch layer identified.
- Confirmed that the current repair loop operates on CDIR and uses VisualImportQualityReport.

### 6B — Visual QA Issue Classifier

Status: Complete.

Outputs:

- repair-issue-classifier-v1
- Converts VisualImportQualityReport into structured repair issues.
- Classifies issues by:
  - pixel mismatch
  - layout drift
  - text loss
  - missing element
  - colour mismatch
  - confidence low
  - raster artifact missing
  - fallback/manual-review requirement

### 6C — Repair Eligibility Gate

Status: Complete.

Outputs:

- repair-eligibility-gate-v1
- Decides whether each page is:
  - eligible
  - blocked
  - fallback
  - manual_review
  - no_issues
- Blocks automatic repair when required artifacts are missing or page state is unsafe.

### 6D — Phase 5 to Repair Loop Bridge

Status: Complete.

Outputs:

- repair-loop-bridge-v1
- Bridges Phase 5 review artifacts into the existing repair loop inputs:
  - CDIR
  - expectations
  - rendered rasters
  - source rasters
  - final mode
  - eligible page numbers

### 6E — Deterministic Repair Runner

Status: Complete.

Outputs:

- deterministic-repair-runner-v1
- Runs the bounded repair loop safely.
- Returns:
  - repaired CDIR
  - repaired ReportTemplate
  - repaired ImportReviewDraft
  - final VisualImportQualityReport
  - repair summary
  - pass/patch audit data

### 6F — Repair Orchestration Pipeline

Status: Complete.

Outputs:

- visual-repair-orchestration-pipeline-v1
- One callable pipeline:
  - run Visual QA
  - classify issues
  - evaluate eligibility
  - build bridge input
  - run deterministic repair
  - return repaired draft and summary

### 6G — Repair Audit Persistence

Status: Complete.

Outputs:

- visual-repair-audit-persistence-v1
- Persists:
  - repair-loop.json
  - visual_repair_artifact_path
  - visual_repair_summary
- Adds edge-function operations:
  - save_visual_repair_audit
  - get_visual_repair_audit

### 6H — UI Integration: Run Repair

Status: Complete.

Outputs:

- Import review dialog exposes Run repair.
- Repair summary appears in review UI.
- Repair audit path is displayed.
- Repair audit is saved after the repair pipeline completes.

### 6I — Apply Repaired Template

Status: Complete.

Outputs:

- repaired-template-application-v1
- Adds Apply repair action.
- Snapshots current template into report_template_versions.
- Updates report_templates.schema with repaired template.
- Increments template version.
- Navigates to repaired template editor.

## Required Regression Commands

Run:

    npm run test -- \
      src/lib/reportTemplate/__tests__/visualQualityApplyRepairedTemplate.spec.ts \
      src/lib/reportTemplate/__tests__/visualQualityRepairAuditPersistence.spec.ts \
      src/lib/reportTemplate/__tests__/visualQualityRepairOrchestrationPipeline.spec.ts \
      src/lib/reportTemplate/__tests__/visualQualityDeterministicRepairRunner.spec.ts \
      src/lib/reportTemplate/__tests__/visualQualityRepairBridge.spec.ts \
      src/lib/reportTemplate/__tests__/visualQualityRepairEligibility.spec.ts \
      src/lib/reportTemplate/__tests__/visualQualityRepairIssueClassifier.spec.ts \
      src/lib/reportTemplate/__tests__/importReviewVisualQualityPipeline.spec.ts \
      src/lib/reportTemplate/__tests__/importReviewVisualQuality.spec.ts \
      src/lib/reportTemplate/__tests__/renderDiffPersistence.spec.ts

    npm run build

Optional:

    npm run lint

Run SQL in Supabase SQL Editor:

    scripts/regression/pdf-import-phase-6-check.sql

## Manual UI Smoke Test

1. Import a PDF using Hybrid mode.
2. Click Review quality.
3. Click Run visual QA.
4. Confirm Visual QA summary appears.
5. Click Run repair.
6. Confirm Repair audit summary appears.
7. Confirm repair-loop.json path is shown.
8. Click Apply repair.
9. Confirm template opens in editor.
10. Confirm template version increments.
11. Confirm old schema snapshot exists in report_template_versions.
12. Confirm template_imports.meta.visual_repair_summary is populated.
13. Confirm template_imports.meta.visual_repair_artifact_path points to repair/repair-loop.json.

## Phase 6 Pass Conditions

### Issue Layer

- Visual QA reports are classified into structured repair issues.
- Issue summary counts are available.
- Fallback and manual review conditions are represented clearly.

### Safety Layer

- Pages missing source/generated rasters are blocked.
- Fallback-to-pixel pages are not automatically repaired.
- Manual-review pages are not automatically repaired.
- Clean pages are skipped safely.

### Repair Layer

- Repair loop is bounded.
- Repair loop only runs when eligible.
- Repair loop does not throw into the UI.
- Repair output includes repaired CDIR, repaired template, final report, passes, and summary.

### Persistence Layer

- repair-loop.json is saved.
- visual_repair_artifact_path is attached to template_imports.meta.
- visual_repair_summary is attached to template_imports.meta.
- get_visual_repair_audit can reload the persisted audit.

### UI Layer

- Run repair appears in import review.
- Repair audit summary appears after repair.
- Apply repair appears after repair.
- Apply repair snapshots current template before replacing schema.
- Apply repair increments the template version.

## No Sidecar Rebuild Required

Phase 6 is frontend, visual-quality orchestration, and Supabase edge-function metadata persistence.

The Cloud Run PDF sidecar remains unchanged after Phase 4J.

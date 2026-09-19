# PDF Import Phase 7C — Rendering Baseline

## 1. Objective

Phase 7C captures the current improved rendering quality after the Docling import
pipeline, Visual QA, Repair, and Apply Repair flow. It creates a formal, repeatable
way to measure and record where import fidelity stands **today**, so later fidelity
work (Phase 7D and beyond) can be compared against a known starting point.

This phase does **not** attempt major rendering fixes. It delivers the
documentation, the golden-corpus manifest template, and the read-only SQL needed
to measure quality.

## 2. Why this exists

Rendering quality has visibly improved, but "looks better" is not measurable.
Before further fidelity changes are made, the current state must be measured and
recorded per corpus category. A baseline lets us:

- prove regressions vs. improvements objectively,
- target the next fixes at the categories that actually need them,
- avoid re-litigating "is it better?" from memory.

## 3. Golden corpus categories

Each category is a small, representative PDF exercised end-to-end. Use the
metadata-only manifest at `docs/pdf-import/golden-corpus-manifest.template.json`
to record results (never commit the PDFs themselves).

| Corpus ID | Category | What it validates |
|-----------|----------|-------------------|
| `golden-simple-001` | simple one-page PDF | base import, page geometry, Visual QA, Repair, Apply Repair |
| `golden-design-001` | design-heavy one-page PDF | fonts, spacing, images, backgrounds, layer order |
| `golden-report-001` | multi-page report | multi-page artifact consistency, page-count alignment |
| `golden-table-001` | table-heavy PDF | table placement, text fit, grid/border rendering |
| `golden-image-001` | image-heavy PDF | image placement, crop, scale, background behavior |
| `golden-ocr-001` | scanned/OCR PDF | OCR fallback, manual-review safety, non-overrepair behavior |

## 4. Manual baseline flow

```
Import PDF
→ Hybrid mode
→ Wait for import completion
→ Review quality
→ Run Visual QA
→ Run Repair
→ Confirm repair audit saved
→ Apply Repair
→ Confirm editor opens
→ Compare editor preview against source PDF
→ Run SQL validation
→ Record baseline result
```

## 5. Required metadata per run

Record the following for each corpus run (see the manifest `baseline` block and the
local `golden-result-template.md`):

- corpusId
- category
- importId
- templateId
- sourceFilename
- importedPageCount
- templatePageCount
- engineVersion
- diagnosticsJobId
- diagnosticsPath
- visualQualityScore
- visualQaManualReviewRequired
- repairStatus
- repairFinalScore
- repairScoreDelta
- totalApplied
- patchesAccepted
- patchesRejected
- requiresFallback
- requiresManualReview
- repairAuditPath
- repairAuditObjectExists
- templateVersionAfterApply
- latestSnapshotLabel
- humanEditorDecision
- knownDefects
- notes

## 6. Privacy rules

- Do **not** commit private PDFs.
- Do **not** commit client PDFs.
- Do **not** commit screenshots unless sanitized.
- Use `audit-output/` for local-only private testing artifacts (git-ignored / untracked).
- Commit only docs, source code, tests, SQL, and sanitized templates.

## 7. Pass/fail standards

A baseline run **passes** when:

- import completes,
- a template is created,
- Visual QA runs,
- Repair runs or safely skips,
- the repair audit persists,
- Apply Repair opens the editor,
- template page count matches imported page count.

Manual-review or fallback flags are **warnings**, not automatic failures.

## 8. SQL validation

Run `scripts/regression/pdf-import-phase-7c-rendering-baseline-check.sql` in the
Supabase SQL Editor after a run. It reports, read-only:

1. latest completed imports with Visual QA + Repair metadata,
2. repair-audit storage-object presence,
3. template page-count match (`pass` / `template_page_count_mismatch`),
4. latest template snapshots,
5. latest diagnostics jobs (`pdf_import_jobs`),
6. summary counts.

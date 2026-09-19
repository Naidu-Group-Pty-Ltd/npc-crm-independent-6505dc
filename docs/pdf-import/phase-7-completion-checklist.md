# PDF Import Phase 7 Completion Checklist

## Objective

Phase 7 locks the PDF import quality layer after the Docling-only import pipeline,
Visual QA, repair audit persistence, editor fidelity hardening, AI reconciliation,
and export parity validation.

## Scope Covered

- **Phase 7A** — Browser/live smoke foundation
- **Phase 7B** — Repair audit edge-function contract (`save_visual_repair_audit` /
  `get_visual_repair_audit`)
- **Phase 7C** — Rendering baseline capture (golden corpus + rendering baseline docs/SQL)
- **Phase 7D** — Template editor fidelity hardening (page geometry, layer ordering,
  font normalization)
- **Phase 7E** — AI reconciliation integration (policy, audit, UI, metadata)
- **Phase 7F** — Export parity validation (types, manual builder, persistence,
  diagnostics surface)
- **Phase 7G** — Final regression lock (this document + final SQL + final smoke test)

## System Flow Locked

```
PDF Import
→ Docling parse
→ staged artifacts
→ async finalization
→ Template Builder editor
→ Review Quality
→ Visual QA
→ Repair
→ AI reconciliation if needed
→ Apply repaired/reconciled template
→ Export parity
→ Diagnostics and SQL validation
```

## Required Artifacts

### `template_imports.meta`

- `import_manifests_summary`
- `visual_quality_artifact_path`
- `visual_quality_summary`
- `visual_repair_artifact_path`
- `visual_repair_summary`
- `ai_reconciliation_summary` — when AI reconciliation was run
- `export_parity_artifact_path` — when export parity was recorded/run
- `export_parity_summary` — when export parity was recorded/run

### Storage bucket

`template-import-artifacts`

Expected artifact paths:

- `{importId}/visual-quality.json`
- `{importId}/repair/repair-loop.json`
- `{importId}/export-parity/export-parity.json`

### Diagnostics

`pdf_import_jobs` should show recent Docling jobs where available.

## Final Validation Checklist

- [ ] Import completes.
- [ ] Template row is created.
- [ ] Template page count matches import page count.
- [ ] Template opens in editor.
- [ ] Review Quality opens.
- [ ] Visual QA runs.
- [ ] `visual-quality.json` persists.
- [ ] `visual_quality_summary` persists.
- [ ] Repair runs or safely skips.
- [ ] `repair-loop.json` persists.
- [ ] `visual_repair_summary` persists.
- [ ] Apply repaired/reconciled template works.
- [ ] Template version increments after apply.
- [ ] `report_template_versions` snapshot exists.
- [ ] AI reconciliation recommendation appears when applicable.
- [ ] AI reconciliation metadata persists when run.
- [ ] Visual QA can be rerun after reconciliation.
- [ ] Export parity can be recorded or run.
- [ ] `export-parity.json` persists when parity is saved.
- [ ] `export_parity_summary` persists.
- [ ] Template Import Quality shows visual QA / repair / export parity state.
- [ ] PDF import diagnostics show recent job data.
- [ ] Final Phase 7 SQL runs successfully.
- [ ] npm tests pass.
- [ ] npm run build passes.
- [ ] No private artifacts are committed.

## Lock Decision

### Locked

Use when:
- Tests pass.
- Build passes.
- Manual browser flow passes.
- SQL confirms required metadata and artifacts.
- No blocking issues remain.

### Locked with warnings

Use when:
- Core import / Visual QA / Repair / Apply flow works.
- Some optional paths are manual-only.
- Export parity is manual-only but documented.
- Some imports require manual review by design.
- No data integrity or contract issues remain.

### Not locked

Use when:
- Run Visual QA fails.
- Run Repair fails due to backend operation mismatch.
- Repair audit does not persist.
- Apply Repair cannot update template.
- Export parity persistence fails when used.
- Build fails.
- Final SQL shows missing required artifacts for a fresh test import.

## Known Acceptable Warnings

- `manualReviewRequired = true` can be acceptable for OCR/scanned or design-heavy PDFs.
- Repair status `skipped` can be acceptable when no eligible repairs exist.
- Export parity `manual_required` can be acceptable if automated export comparison is
  not yet available (Phase 7F ships the manual-capture MVP; automation is documented as
  a future additive step).
- AI reconciliation `not run` can be acceptable when policy says `not_needed`.

## Phase 8 Readiness

- Phase 7 final SQL exists (`scripts/regression/pdf-import-phase-7-final-check.sql`).
- At least one successful end-to-end test import is validated (via the final smoke test).
- Golden corpus manifest exists (`docs/pdf-import/golden-corpus-manifest.template.json`).
- Quality metrics can be captured.
- Export parity can be recorded or run.
- Diagnostics can show import quality state.

## Final Notes

Phase 7 should not be considered locked from code alone. It requires a browser smoke test
(`docs/pdf-import/phase-7-final-smoke-test.md`) plus Supabase SQL validation
(`scripts/regression/pdf-import-phase-7-final-check.sql`) run against a **fresh** import
that has been carried through the full stack.

The static half of the lock — code coherence, contracts, tests, and build — is verified in
this branch. The dynamic half — a fresh end-to-end import producing the expected artifacts
and metadata — must be confirmed by an operator with browser access to Template Builder and
the Supabase SQL Editor before flipping the decision to fully **Locked**.

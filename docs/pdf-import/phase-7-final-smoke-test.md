# PDF Import Phase 7 Final Smoke Test

## Purpose

Validate the full Phase 7 stack from PDF import to export parity.

## Pre-conditions

- Latest `main` branch pulled.
- `npm run build` passes.
- Supabase functions are deployed if changed.
- User has access to Template Builder.
- Test PDF is safe to upload.
- Private outputs are not committed.

## Recommended Test PDFs

Use at least one:

- Simple one-page PDF
- Design-heavy one-page PDF
- Multi-page report PDF

If only one can be tested, use a simple one-page PDF first.

## Browser Test Flow

1. Open Template Builder.
2. Click Import PDF.
3. Choose Hybrid mode.
4. Upload test PDF.
5. Wait for import completion.
6. Confirm template was created.
7. Click Review Quality.
8. Confirm review artifacts load.
9. Run Visual QA.
10. Confirm Visual QA score appears.
11. Confirm Visual QA saved toast appears.
12. Run Repair.
13. Confirm repair audit saved.
14. Confirm repair summary appears.
15. If AI reconciliation recommendation appears:
    - read recommendation
    - run AI reconciliation if optional/recommended/manual_review
    - confirm reconciliation completes
    - rerun Visual QA
16. Apply repaired/reconciled template.
17. Confirm Template Builder editor opens.
18. Confirm editor visual quality:
    - page size
    - source raster/background alignment
    - text overlay alignment
    - image placement
    - layer ordering
    - table placement if applicable
19. Record or run export parity.
20. Open Template Import Quality.
21. Confirm row shows Visual QA / Repair / Export parity status.
22. Open PDF Import Diagnostics.
23. Confirm latest Docling job appears where available.
24. Run final SQL validation.

## Expected Results

- Import status `completed`.
- Template ID exists.
- Visual QA artifact exists.
- Repair audit artifact exists.
- Apply Repair opens editor.
- Template version increments.
- Snapshot exists.
- Export parity status is visible if parity was saved.
- SQL confirms artifacts.

## Failure Handling

If import fails:
- Check `pdf_import_jobs`.
- Check `template_imports.error`.
- Check Supabase function logs.
- Do not continue to Visual QA.

If Visual QA fails:
- Check source raster availability.
- Check `get_artifacts` output.
- Check `renderArtifactManifest` problems.

If Repair fails:
- Check `save_visual_repair_audit` operation.
- Check `repair-loop.json` persistence.
- Check `visual_repair_summary`.

If Apply Repair fails:
- Check template `locked_for_review`.
- Check `manage-templates` function.
- Check expected version conflict.

If Export Parity fails:
- Check `save_export_parity` operation.
- Check `export-parity.json` persistence.
- Check `export_parity_summary`.

## Required Evidence to Record

- `import_id`
- `template_id`
- source filename
- page count
- visual QA score
- repair status
- repair final score
- AI reconciliation status if run
- export parity status if saved
- editor visual decision
- SQL result summary

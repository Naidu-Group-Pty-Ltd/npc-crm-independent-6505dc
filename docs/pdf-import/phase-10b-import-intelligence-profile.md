# PDF Import Phase 10B — Import Intelligence Profile Layer

## Objective

Phase 10B creates a deterministic Import Intelligence Profile for PDF imports.

The profile classifies the document type, complexity, risk level, and recommended
downstream handling strategy — without calling AI, without changing the import
pipeline by default, and without storing raw PDF text.

## Why This Exists

The PDF import system already has strong validation, repair, export parity,
golden regression, diagnostics, and a production hardening audit. But it still
treats every PDF similarly.

A one-page clean document, a scanned OCR file, a table-heavy report, and a
design-heavy brochure require different handling. The Import Intelligence Profile
gives the system a structured understanding of what it is processing, which later
phases (10C repair patterns, 10D adaptive reconciliation, 10E self-healing) can
consume.

## What Phase 10B Does

- Defines profile categories, risk levels, and strategy recommendations.
- Defines deterministic signal extraction from existing metadata/summaries.
- Defines deterministic classification rules.
- Builds a profile from an import snapshot / metadata.
- Persists the profile into `template_imports.meta.import_intelligence_profile`
  via the existing `append_meta` operation.
- Adds tests, SQL validation, and diagnostic/operator display.
- Prepares for Phase 10C/10D/10E.

## What Phase 10B Does Not Do

- Does not call AI.
- Does not alter import behaviour by default.
- Does not change quality gates, repair logic, or export parity semantics.
- Does not create a database table or a migration.
- Does not modify the sidecar.
- Does not store raw PDF text or private extracted content.
- Does not automate retries.

## Profile Categories

Each category has common signals, a risk profile, and recommended strategies.

- **simple_document** — low complexity, one/few pages, mostly text, low
  table/image density, low manual-review risk. QA recommended; repair allow; AI
  not_needed; export recommended; operator proceed.
- **design_heavy** — strong branding, background blocks, complex layout, images,
  spacing sensitivity. QA required; repair allow_with_review; AI optional/
  recommended by score; export required; operator review_before_apply.
- **multi_page_report** — multiple pages, repeated sections, headers/footers,
  multi-page consistency risk. QA required; repair allow_with_review; AI optional;
  export required; operator review_before_apply.
- **table_heavy** — high table/grid/row/column density, numerical layout & text
  fit risk. QA required; repair allow_with_review; AI recommended when QA/repair
  scores are low; export required; operator review_before_apply.
- **image_heavy** — many/large images, backgrounds, logos, crop risk. QA required;
  repair allow_with_review; AI optional; export required; operator
  review_before_apply.
- **scanned_ocr** — likely scanned/OCR, low editable structure confidence, source
  raster preservation important. QA required; repair manual_only; AI
  manual_review; export manual_required; operator manual_review_required.
- **mixed_complex** — multiple complexity signals high (tables + images + design +
  multi-page). QA required; repair allow_with_review; AI recommended; export
  required; operator manual_review_required or review_before_apply by risk.
- **high_risk** — multiple risk factors indicate automation is unsafe. QA
  required; repair manual_only/blocked; AI manual_review/blocked; export
  manual_required; operator block_until_review.
- **unknown** — insufficient evidence to classify confidently. QA required; repair
  allow_with_review; AI optional; export recommended; operator review_before_apply.

## Signals

### Page signals
- page count, multi-page flag, page-count risk.

### Text signals
- text density estimate (counts only, never raw text), editable text availability,
  OCR likelihood.

### Table signals
- table count estimate, table density, table layout risk.

### Image signals
- image/picture count estimate, image density, image crop risk.

### Design signals
- background/layer complexity, visual QA drift, design/manual-review flags.

### QA signals
- Visual QA score, manual review required, repair status/fallback, export parity
  status/scores.

### History signals
- golden regression failures, baseline degradation, repeated warnings/failures.

## Scoring Model

All scores are 0..1 (or null when there is no evidence):

- complexityScore — weighted combination of page/table/image/design/OCR/visual
  QA/repair/export sub-risks.
- ocrRiskScore, tableRiskScore, imageRiskScore, designRiskScore.
- automationRiskScore — how unsafe automated structure handling is.
- manualReviewLikelihood.
- confidence — evidence coverage (0.2 minimum for a known import; up to ~0.98).

## Classification Rules (deterministic)

- **high_risk** if automationRiskScore ≥ 0.85, or golden quality gate fail/blocked
  with failures, or repair failed with low visual QA.
- **unknown** (early) if confidence < 0.35.
- **mixed_complex** if two or more of table/image/design/OCR risk ≥ 0.65 and
  complexityScore ≥ 0.65.
- **scanned_ocr** if ocrRiskScore ≥ 0.75 and no other risk dominates (or OCR high
  with low text density).
- **table_heavy / image_heavy / design_heavy** if that single risk ≥ 0.65 and
  dominates.
- **multi_page_report** if pageCount ≥ 3, complexity in 0.35..0.75, no dominant
  category.
- **simple_document** if pageCount ≤ 2, complexity < 0.35, automation < 0.35, no
  manual review, no fallback.
- **unknown** otherwise.

Risk level is resolved from the scores (critical/high/medium/low/unknown) and
escalated to critical when the golden quality gate is fail/blocked.

## Persistence Target

`template_imports.meta.import_intelligence_profile` via the existing secure
`template-import-pdf` `append_meta` operation. No new table, migration, or backend
operation. The profile is metadata only — it never stores raw document text.

## Profile Usage in Future Phases

- **Phase 10C** — Repair Pattern Library uses the profile to choose repair
  patterns.
- **Phase 10D** — Adaptive Reconciliation uses the profile to decide whether AI is
  useful, optional, blocked, or manual-review-only.
- **Phase 10E** — Self-Healing uses the profile to decide safe retry behaviour.
- **Phase 10F** — Performance optimisation uses the profile to skip unnecessary
  expensive steps.
- **Phase 10G** — Operator controls display the profile and allow override.

## Acceptance Criteria

- profile types exist
- signal extraction exists (deterministic, no raw text)
- classifier exists (deterministic, evidence-based)
- profile builder exists
- persistence helper exists (append_meta)
- display helper exists
- tests pass
- SQL exists
- orchestrator can optionally build/persist the profile
- operator console can build/persist the profile
- UI can display the profile summary
- build passes
- no private artifacts committed

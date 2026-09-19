# PDF Extraction V3 · E8 — Deterministic Repair & Verified Candidate Selection

> **Status:** code complete. **Scope:** code-only, fully backward compatible, no
> deploy. No Google Cloud / Cloud Run / Docker / image push / infra; no Supabase
> migration or Edge Function deploy; no external provider; no automatic AI. Builds
> on merged E0–E7. Preserves `pdf-page-output-policy-v1` and the E6 region
> contracts; E7 stays authoritative for acceptance.

## 1. Problem statement

The V1 repair loop predates E3–E7 and is unsafe for final acceptance: it operates
on **CDIR** (not the staged ReportTemplate + E6 composition), re-scores through the
V1 visual diff, and accepts on `afterScore > beforeScore` — so a candidate that
raises a weighted score while a chart is still missing, a value is in the wrong
cell, punctuation is fused, text is clipped, or source pixels are duplicated can
be accepted. Its deterministic solver appends **invisible** missing-token text
(`fontSize: 0.5`) and **blank placeholder** layers, which improve model-level text
coverage without restoring visible fidelity and can leak into exported PDF text.
Rebuilding the template from CDIR after repair also risks losing E3/E4/E5/E6/
page-policy/operator/crop metadata.

## 2. Core repair rule

A candidate is acceptable **only** when: the targeted defects are resolved (or
replaced by a strictly safer fallback representation) **AND** no new hard defect is
introduced **AND** critical coverage stays complete **AND** E7 permits the final
decision **AND** the actual output was re-rendered and re-measured. Score
improvement is useful, never sufficient. **SOURCE FIDELITY OUTRANKS EDITABILITY.**

## 3. Non-goals

E8 never invents chart geometry/values, rewrites financial copy, guesses
punctuation or table-cell association, merges/splits tables semantically, selects
a provider by name, changes any E3/E4/E5/E7 threshold, reimplements E6 ownership,
appends invisible text or blank placeholders, uses `locked`/opacity-zero/off-page
as suppression, bypasses the E7 hard-defect veto, uses AI, or persists signed URLs.

## 4. Runtime-repair prerequisite (proven)

E8 performs the real loop: **candidate → render through the E6 final plan →
capture actual browser evidence → run E7 → accept/reject.** The injectable
`RenderAndEvaluateRepairCandidate` adapter (`runtimeAdapter.ts`) renders a
candidate, hydrates crop/font assets, captures actual DOM evidence + the final
raster, invokes E7 and returns a `VisualPageQualityReportV2`. A real-Chromium e2e
(`tests-e2e/pdfRepairCandidateEvaluation.e2e.ts`) proves the full loop: a candidate
rendered through the E6 plan (suppressed overlay absent, final crop painted, plan
hash stamped) is captured from the real composed DOM and evaluated by the pure E7
gate. Unit tests inject a deterministic adapter so the cascade is testable without
a browser. Model/CDIR-only scoring is never used.

## 5. Contract versions

| Contract | Version |
|---|---|
| Deterministic repair plan | `deterministic-repair-plan-v2` |
| Deterministic repair operation | `deterministic-repair-operation-v2` |
| Repair candidate | `repair-candidate-v1` |
| Repair candidate evaluation | `repair-candidate-evaluation-v1` |
| Repair attempt audit | `repair-attempt-audit-v1` |
| Repair cascade | `repair-cascade-v2` |
| Repair selection policy | `repair-selection-policy-v1` |

Pure modules under `ingestion/visualQuality/repair/v2/`. All identities are
deterministic FNV over structural fields only — no timestamps, signed/Blob/object
URLs or DOM handles.

## 6. Legacy repair safety

The V1 solver (`doclingSolver.ts`) is explicitly banner-marked **legacy V1 only**;
the E8/V2 path does not import it. E8 has its own operation union + a
forbidden-operation guard (`FORBIDDEN_OPERATION_KINDS`) that rejects
`replace_text` / `append_text_layer` / `set_bounds` and every free-form/unknown
kind, and the immutable applier's structural check rejects sub-readable font sizes
and opacity-zero suppression. Tests assert E8 never emits any forbidden op. V1
reports remain readable but carry different versions and can never be treated as
E8-complete (E8 validators reject non-E8 versions). No hidden-text or placeholder
branch participates in E8.

## 7. Defect classification

`classifyDefects.ts` maps every E7 hard-defect code to a repairability class; an
**unknown critical code is never `safe-deterministic`** — it is `page-fallback`
(valid raster) or `nonrepairable`. Summary: geometry/text-fit (`text_clipped`,
`element_off_page`, `page_dimension_mismatch`, `severe_overlap`,
`unreadable_contrast`, …) → `safe-deterministic`; composition duplicates
(`crop_and_native_both_visible`, `renderer_plan_mismatch`, `hidden_semantic_visible`,
`editor_reference_visible_in_final`, …) → `safe-deterministic` (E6 suppression);
asset issues (`region_crop_asset_missing/invalid`, `rendered_raster_missing`) →
`evidence-retry`; table defects → `candidate-switch`; typography punctuation/token
defects → `candidate-switch`; missing/blank chart/picture/logo + `local_blank_region`
+ `foreground_occupancy_loss` → `region-fallback`; `source_region_unscored` /
`composition_unscored` / `unresolved_region_crop_overlap` → `page-fallback`;
missing source/page raster + invalid quality evidence → `nonrepairable`.

## 8. Safe operation catalogue

Geometry (`set-overlay-bounds`, `set-page-size`); text-fit (`set-text-font-size`,
`-line-height`, `-letter-spacing`, `-word-spacing`, `-padding`, `-white-space`);
stacking (`set-overlay-z-index`); image/crop (`set-image-fit`, `set-image-bounds`);
table (`set-table-column-widths`, `set-table-row-heights`, `select-table-candidate`);
typography (`select-typography-resolution`); composition (`suppress-overlay`,
`restore-overlay-from-plan`, `apply-region-render-plan`, `set-region-output-strategy`);
page policy (`set-page-output-strategy`). Every op carries version, id, kind, page
id, target id, expected target hash, source-evidence refs, before/after, bounds,
rationale code.

## 9. Forbidden operations

`replace_text`, `append_text`, `append_text_layer`, `delete_text`, `set_bounds`,
`json_patch`, `set_path`, `set_css`, `set_html`, `set_url`, `add_coverage_layer`,
`set_opacity_zero`, `set_text_content` — and any unknown kind. Rejected by the
guard before any mutation.

## 10. Source-evidence preconditions

Every op proves why it is safe from immutable evidence (Source Scene Graph V2,
exact source bbox, source typography run, source table topology, E4 candidate
integrity report, E5 font resolution, E6 region policy/ownership, source crop hash,
source page raster, actual E7 DOM geometry/defect). Examples: `set-overlay-bounds`
requires an exact source bbox + on-page result; `set-text-font-size` requires an
E5/source-typography evidence + bounded reduction; `select-table-candidate`
requires a candidate with a valid integrity report, zero hard defects and complete
numeric-cell association; `set-region-output-strategy → source-crop` requires a
durable non-blank crop; `set-page-output-strategy → raster-only` requires a durable
non-blank page raster with matching dimensions. A missing precondition makes the op
invalid — never best-effort.

## 11. Operation limits

Position shift ≤ max(12pt, 10% of source dimension); size change ≤ 20%; font
reduction ≤ 12.5% and never below a 6px readable minimum; ≤ 2 fitting attempts; ≤ 6
operations per candidate. Larger corrections fall back to a source crop. Table ops
never drop rows/columns/cell text; image ops preserve aspect ratio; z-order only
with owner/paint-order evidence.

## 12. Template-first application

`operationApply.ts` operates on the staged ReportTemplate + its E6 composition —
never rebuilds from CDIR. It deep-clones, statically validates every op
(forbidden-op guard + preconditions + optional stale-target-hash), applies **all
or none** on the clone, structurally re-validates (finite numbers, no negative
dims, no sub-readable font, no opacity-zero), and returns the new template + hash +
changed target hashes. A single failing op discards the whole candidate with no
mutation. E3/E4/E5/E6 metadata, page policy, operator overrides and crop references
are preserved.

## 13. Candidate generation

`candidateGeneration.ts` transforms explicit source-evidence-backed repair inputs
(assembled from E7 defects + E3/E4/E5/E6 evidence) into a bounded, deduplicated,
deterministic candidate set — never combinatorial. **Tier 1** low-risk native
single-op candidates (source bbox, line-height/tracking, bounded font fit,
source-backed z-order/image-fit, E6 suppression); **Tier 2** verified switches
(zero-defect E4 table candidate, verified E5 resolution); **Tier 3** mixed region
fallback (exact source crops via E6); **Tier 4** page raster — Tiers 3–4 only in
pass 2. Budgets: ≤ 8 candidates/pass, ≤ 16 absolute, ≤ 6 ops/candidate. Deduped by
candidate id before rendering.

## 14. Text-fit repair

Restore exact source bbox → source line-height → tracking/word-spacing → bounded
font reduction → padding → source-text crop. Every step preserves exact visible
text + Unicode; never removes a character, replaces a dash/×/−, shortens a value,
ellipsizes, hides overflow or appends invisible text. Passes only when E7 confirms
exact critical tokens/punctuation, zero clipping/off-page, line-count satisfied, no
new overlap and (where required) export parity.

## 15. Geometry & z-order repair

Uses actual E7 geometry + immutable source geometry. Ambiguous ownership → op
invalid → fallback. Z-order repaired only with E6 owner / Source Scene zOrderHint /
paint-order evidence — never a global "text above image" rule. E7 must confirm
on-page, no clipping, no new collision, improved bbox agreement, single region
representation.

## 16. E6 suppression repair

Composition defects are repaired by **reapplying the E6 plan**: reapply
`suppressedOverlayIds`, remove editor-reference crops from final, suppress nested
crops owned by an outer crop, suppress hidden-semantic visuals (semantic metadata
retained). Reversible in the editor; never opacity-zero / zero-size / off-page /
`locked`. No new ownership interpretation.

## 17. Chart / picture fallback

E3 authoritative. Allowed: hydrate/retry a trusted chart crop, apply the chart
source-crop policy, repair crop bbox/fit, apply E6 child suppression, use page
raster. Forbidden: redraw/rebuild axes/legends/bars, infer values, select detached
labels as the chart. A missing/unsafe chart resolves to exact crop → page raster →
block.

## 18. Table candidate selection

E4 authoritative. Only candidates matching the same source region, valid under
`table-candidate-contract-v1`, with valid integrity, zero hard defects, complete
numeric-cell association, full row/column coverage and a visible fit are eligible.
Lexicographic order: zero hard defects → numeric association → row/column coverage
→ no clipping → E4 integrity → E7 actual score → editability → cost → id. None
passing → exact table crop → page raster → block. Never moves text between cells or
synthesizes generic headers.

## 19. Typography candidate selection

E5 authoritative. Uses exact source font / approved installed font / complete
embedded subset / measured metric-compatible substitute / source-text crop. Never
a name-similarity candidate; never alters raw Unicode to make a font fit. Native
typography only when E7 confirms actual fit; otherwise source-text crop.

## 20. Region & page policy repair

Region transitions use E6 (`native`/`native-with-source-reference` → `source-crop`;
failed crop asset → page fallback; blocked region → page fallback with a valid
raster). `source-crop → native` is never automatic unless a verified candidate
independently passed E7 with zero hard defects. Region changes regenerate the E6
ownership/render-plan/hash/suppression and re-render + rerun E7. Page raster uses
the existing `pdf-page-output-policy-v1` (no second implementation).

## 21. Actual candidate rendering & E7 re-evaluation

The cascade delegates rendering + capture + E7 to the injected adapter. The
selected candidate is evaluated **twice** — as a trial candidate and as the applied
final state — and the render-plan hash + E7 decision + hard-defect count must
match; a mismatch (`applied_state_mismatch`) rolls back and tries the next safe
candidate or blocks.

## 22. Defect delta

Deterministic fingerprints from code + scope + page/region/overlay/run ids (never
raw reason/value/timestamp). Per candidate: resolved / retained / introduced. A
defect that merely changes target is not "resolved". `text_clipped` on overlay A is
not resolved because `text_clipped` on overlay B appears.

## 23. Candidate selection

`candidateSelection.ts` — lexicographic tuple: (1) E7 permitted, (2) zero introduced
hard defects, (3) target defects resolved, (4) complete critical coverage, (5)
**output safety tier**, (6) fewer hard defects, (7) E7 score, (8) min critical
region, (9) parity, (10) region fidelity, (11) editability, (12) operation risk,
(13) fewer ops, (14) lower cost, (15) candidate id. Safety tier: verified native /
verified alternative = 4, verified mixed = 3, verified page raster = 2, blocked = 0.
**A safe mixed/raster candidate never ranks below a higher-scoring unsafe native.**

## 24. Monotonicity guarantee

A selected repair may not regress critical fidelity on **actual E7 evidence** — no
new hard defect, no lower critical token/punctuation recall, table integrity, chart
coverage, composition completeness, asset availability or foreground recall, no new
clipping/off-page/severe-overlap/parity failure. A small documented tolerance for
noncritical metrics applies only when moving to a strictly safer fallback strategy.

## 25. Two-pass cascade

Hard cap **2 passes per page**. Pass 1: low-risk native geometry/text-fit/z-order/
suppression + verified switches. Pass 2: mixed region fallback + remaining verified
switch + page raster. No third pass; pass count is page-scoped, not per-defect, and
is not reset by a candidate switch. Stops early on E7 acceptance, no valid/resolving
candidate, a repeated candidate set, or budget exceeded.

## 26. Rollback

An immutable baseline snapshot is kept; each candidate starts from the pass's
selected state. Rejected candidates leave no mutation (application is on a clone).
The selected candidate is applied atomically and re-verified; a trial/final mismatch
rolls back and falls back or blocks. Repair memory (`repairMemory.ts`) records
attempted/rejected/selected hashes, never retries an identical candidate against an
identical baseline, and stops on an A→B→A oscillation.

## 27. Multi-page & shared-resource safety

Repair is page-scoped. An operation touching a shared resource (font face, token,
master-page block, reusable component, shared image) requires re-rendering + rerun
E7 on every affected page and is rejected on any new hard defect. E8's operation
catalogue targets page-local overlays/pages; shared-resource mutation is out of
scope for the automatic cascade (documented; prefer page-local repair or fallback).

## 28. Export verification

The finally selected candidate runs E6 export preflight → real export → re-raster →
E7 export evidence → browser/export comparison. Every trial gets browser E7; export
evaluation runs for the provisional winner and for any font/table-geometry/page-raster
candidate. Export failure rejects the provisional winner and the next candidate is
tried. Temporary export artifacts are removed.

## 29. Audit & persistence

One `repair-attempt-audit-v1` per attempted candidate (plan/candidate ids, pass, op
ids, target defect fingerprints, source evidence hashes, baseline/candidate template
+ plan hashes, before/after scores + strategies, resolved/retained/introduced
defects, coverage, E7 decision, status, rejection codes, elapsed, cost). A bounded
`repair-summary-v2` (counts + codes + hashes only) lives in existing JSON metadata —
no signed URLs, no ImageData, no source text, no financial values, no migration.

## 30. Performance & budgets

≤ 2 passes/page; ≤ 8 candidates/pass; ≤ 16 absolute; ≤ 6 ops/candidate; documented
render/export/artifact caps; ≤ 2 export trials/page. Budget exceeded records
`repair_budget_exceeded` and selects a safe fallback — never unsafe native. Additive
namespaced timings do not change Operational Metrics V1.

## 31. Tests

- **Pure Vitest (28):** versions/identities (deterministic, URL/timestamp-free);
  validators (version/signed-URL/forbidden op); defect classification (every mapped
  class + unknown-never-safe + strategy tier); operation preconditions + bounds
  (geometry on-page/shift/size, font reduction/minimum, z-order evidence, table
  candidate zero-defect, page raster durable); forbidden-op guard covers every V1 op;
  immutable atomic apply (input untouched, E6 meta preserved, one-bad-op rejects all,
  sub-readable font rejected); candidate generation (tiers/dedupe/bounded/deterministic,
  fallback only in pass 2); evaluation (targeted resolved accepts, retained-hard/new-
  hard/incomplete-coverage/plan-mismatch reject, score-only insufficient); selection
  (safe raster beats higher-scoring unsafe native, verified native > raster, id
  tie-break); cascade (clean unchanged, missing-chart → pass-2 raster, block without
  fallback, oscillation).
- **57/100 regression (2):** an unsafe native candidate keeping the missing chart is
  rejected; the failure-class page ends **safe mixed/raster, never accept-native**.
- **Real-Chromium e2e (1):** render candidate → capture actual DOM evidence → run E7
  → coherent V2 report (suppressed overlay absent, crop painted, plan hash matched,
  no crop+native duplicate).
- All E0/E3/E4/E5/E6/E7 suites remain green.

## 32. Acceptance thresholds

**Native:** target hard defects resolved, introduced/retained hard defects = 0,
critical coverage complete, E7 score ≥ native threshold, all affected regions scored,
DOM evidence complete, export parity where required. **Mixed:** exact crops valid, no
duplicate native representation, E7 mixed accepted, every final crop ready. **Page
raster:** valid loaded non-blank raster, correct dims, no native/region layers in
final, export parity. **Completion:** passes ≤ 2, selected candidate reapplied +
reverified (trial/final identical), audit complete, no signed URL, no unsafe text
mutation, no external provider/AI.

## 33. Private-report acceptance checklist

Do not commit the private report or hard-code private values/page numbers; run only
in an authorized local/staging pass. Confirm per section: no unnecessary repair when
already safe; missing/blank charts → crop/raster (never native); tables use a verified
E4 candidate only when numeric association passes, else independent crops; no generic-
header invention; year/value associations never changed by guess; ranges/punctuation
unchanged; no invisible/placeholder repair; fit failures → crop. Document-level: ≤ 2
passes, every selected candidate E7-verified, introduced hard defects = 0, critical
coverage 100%, wrong-cell = 0, clipping = 0 for accepted output, missing charts = 0,
duplicate pixels = 0, unscored critical pages = 0, browser/export parity passes,
unresolved pages use page raster or block.

## 34. Deployment scope (NOT performed)

Later controlled work wires the real browser render+capture+export adapter into the
runtime repair path (the pure adapter interface + Chromium proof ship here), and
routes V2 pages to E8 in the import/finalization flow. No migration (summary is
additive JSON). No Edge Function or sidecar deploy. No cache-fingerprint change here
(E10 handoff).

## 35. Security review

No arbitrary JSON patch / object path / CSS / URL; no signed/Blob/object URL
persisted (validators reject); no source text or financial value in audit; no private
raster/PDF/crop/font committed; all target ids + evidence refs validated + durable +
traversal-free; operation count bounded; numbers finite; operator identity
server-trusted; temporary artifacts removed; no external provider; no automatic AI.

## 36. Known limitations

The concrete browser render+capture+export adapter that feeds the cascade at import
time is runtime-gated — E8 ships the injectable interface + a deterministic test
adapter + the Chromium proof of the real loop, plus the pure cascade (fully tested).
Shared-resource multi-page repair is documented as out-of-scope for the automatic
cascade (page-local + fallback preferred). The V1 loop remains for legacy flows,
banner-marked and unreferenced by E8. 8 pre-existing tsc errors on `main` are
unrelated and untouched — E8 adds zero new tsc errors.

## 37. E9 / E10 / E11 / E12 handoff

- **E9 (providers):** candidate selection stays provider-neutral; provider candidates
  enter E8 only after normalization + source-evidence validation + audit + E7.
- **E10 (routing/cache):** the fingerprint must include `deterministic-repair-plan-v2`,
  `deterministic-repair-operation-v2`, `repair-candidate-v1`,
  `repair-candidate-evaluation-v1`, `repair-cascade-v2`, `repair-selection-policy-v1`,
  the E7/E6 versions, the operation-policy version, candidate budgets and the max
  pass count.
- **E11 (UI):** expose the repair audit + candidate comparison; do not rebuild repair
  logic in the UI.
- **E12 (release gates):** formalize ≤ 2 passes, zero introduced hard defects, zero
  unsafe text mutation, every selected repair reverified, explicit fallback, complete
  audit.

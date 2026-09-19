# PDF Extraction V3 · E4 — Complex Table Candidate Arbitration & Preservation

> **Status:** code complete. **Scope:** code-only, fully backward compatible, no
> deploy. No Google Cloud / Cloud Run / Docker build / image push / production
> infra / release-script change; no Supabase migration or Edge Function deploy;
> no external provider / remote VLM. Builds on E0 (containment), E1 (Source Scene
> Graph V2), E2/J1 (Docling vNext runtime) and E3 (Chart Preservation), all merged.

## 1. Problem statement

The current reconstruction path is unsafe for complex financial/analytical
tables. Observed failures: independent tables flattened into one; values placed
in the wrong generated row; source headers replaced by `Column 1..N`; rows
present in the text layer but clipped from output; multi-row headers collapsed;
merged cells losing topology; numbers associated with the wrong label/cell;
fixed row/header heights and padding causing overflow; adjacent tables merged
because they are spatially close; a candidate accepted merely because most words
exist (without proving row/column count, cell association, numeric placement,
visible fit or header integrity); polished-but-wrong generic headers; dark text
on dark backgrounds; later rows omitted from the visible table.

These are **semantic and financial-data integrity defects**, not visual polish.

**Governing rule:** *source fidelity and correct cell association outrank
editability.* A locked exact source crop is acceptable; a visually editable but
semantically wrong financial table is never acceptable. A weighted score may
never override a hard table-integrity defect.

## 2. Non-goals

E4 does not infer what a cell "probably means", repair a number from surrounding
prose, calculate missing values, merge separate source tables, split a table on
semantic guesses, redraw tables from OCR without topology, convert charts into
tables, replace E3 chart preservation or E0 page fallback, implement a provider
ensemble/Document AI, alter production routing, or force every table to be
editable.

## 3. Contract versions

| Contract | Version | Module |
|---|---|---|
| Table candidate | `table-candidate-contract-v1` | `pdf-parse-service/table_candidates.py`, `_shared/tableArbitration.pure.ts` |
| Source table evidence | `source-table-evidence-v1` | `table_candidates.py` |
| Table integrity report | `table-integrity-report-v1` | `table_integrity.py` |
| Table arbitration | `table-arbitration-v1` | `table_integrity.py` |
| Table preservation plan | `table-preservation-v1` | `table_integrity.py` |

`source-table-topology-v2` (E1) is unchanged. All new fields are additive.

## 4. Architecture

```
source table region (E1)
   → source table evidence bundle (crop + topology + spans + vector grid + numeric/punct placements)
   → candidate collection (primary Docling; alternates budgeted/gated)
   → candidate normalization + validation
   → integrity report per candidate (hard defects + metrics)
   → deterministic arbitration (strongest SAFE candidate | source crop | E0 fallback | blocked)
   → table preservation plan (render mode + suppression)
   → native TableOverlay OR exact source crop
```

The Python producer (sidecar) is authoritative and persists the candidates,
arbitration and preservation plan; the canonical TypeScript module validates and
consumes them, and derives the mapper header policy + renderer suppression. Both
runtimes share the FNV-1a hash so candidate/cell IDs are **byte-identical**
(verified by a cross-runtime parity test).

## 5. Source table evidence

`build_source_table_evidence` assembles the immutable `source-table-evidence-v1`
bundle: the E1 source crop (final visual authority), the `source-table-topology-v2`
(with per-cell bbox/spans/header flags), the original-PDF source spans within the
table bbox, deterministic vector-grid evidence (horizontal/vertical rule counts,
aligned boundaries, `ruled`/`partial`/`borderless`), and each source numeric /
punctuation token with its source span bbox. **Source truth and candidates stay
separate** — a candidate is compared against the bundle and can never rewrite it.
When cell bboxes or associations are unavailable the evidence is marked
incomplete, association is `null`, and native verification fails closed.

## 6. Candidate providers, generation policy & budgets

Providers: `docling-primary` (built from the E1 topology — the current
production output as a *candidate*), `docling-accurate-cell-matching`,
`docling-accurate-no-cell-matching`, `docling-fast` (the profiles E2 already
defines in `accurate_table_candidates(...)`), `pymupdf-grid` (conservative,
line+span evidence only), and `legacy`.

**Bounded-candidate policy.** The primary parse generates only the primary
candidate (no extra conversions). Alternate vNext conversions are a later,
page-bounded, budgeted step gated behind the E2/J1 runtime adapters — never three
full-document conversions. Budgets (in `table_candidates.py`):
`MAX_TABLE_CANDIDATES_PER_TABLE`, `MAX_CELLS_PER_CANDIDATE`,
`MAX_ROWS/COLS_PER_CANDIDATE`, `MAX_CANDIDATE_JSON_BYTES`. Exceeding a budget is
recorded (`candidate_*_exceed_budget`), never a silent unverified native table.

## 7. Deterministic identities

`candidate_id = tblcand-<fnv(sourceRegionId)>-<providerAbbrev>-<fnv(canonicalKey)>`
where the canonical key folds source region id, provider, **provider profile
(runtime/table-mode/cell-matching/converter-key/model)**, normalized bbox and the
canonical topology hash. Changing a provider profile changes the ID; the same
candidate produced in a monolithic parse, a rebased chunk-local page, or a cache
replay keeps the same ID (source region id + normalized bbox are
chunk-independent). Cell IDs derive from candidate id + row + col + span. No
UUID/timestamp/random/signed-URL/DB-id ever participates.

## 8. Integrity report & hard defects

`evaluate_table_integrity` produces `state` (`verified`/`degraded`/`rejected`/
`unverifiable`), a `score` (only when zero hard defects — never used to override
a defect), the `hardDefects` list, and bounded metrics (`null` = genuinely
unavailable, `0` = measured zero; no NaN/Infinity; inputs never mutated).

Hard-veto defect codes (a candidate may not become verified-native when any
occur): `source_table_crop_missing`, `source_table_evidence_incomplete`,
`candidate_missing`, `candidate_invalid`, `candidate_empty`,
`generic_header_substitution`, `source_header_missing`, `header_structure_mismatch`,
`row_count_mismatch`, `column_count_mismatch`, `cell_span_invalid`,
`cell_span_mismatch`, `source_numeric_token_missing`,
`source_numeric_token_duplicated`, `numeric_token_wrong_cell`,
`punctuation_token_missing`, `adjacent_source_tables_merged`,
`single_source_table_split`, `candidate_bbox_mismatch`, `cell_bbox_outside_table`,
`table_outside_page`, `candidate_overflow`, `candidate_row_clipped`,
`candidate_column_clipped`, `candidate_text_collision`,
`candidate_unreadable_contrast`, `candidate_unscored`, `candidate_budget_exceeded`,
`provider_disagreement_unresolved`.

### Example — a weighted score cannot rescue a hard defect (redacted)

```json
{
  "version": "table-integrity-report-v1",
  "sourceRegionId": "src-p0007-tabl-0002-<redacted>",
  "candidateId": "tblcand-...-dpri-...",
  "state": "rejected",
  "score": null,
  "hardDefects": [{ "code": "source_numeric_token_missing" }],
  "metrics": {
    "sourceRowCount": 2, "candidateRowCount": 2, "rowCountAgreement": 1.0,
    "headerTokenRecall": 1.0, "numericTokenRecall": 0.0,
    "numericCellAssociationAccuracy": 0.0, "genericHeaderCount": 0, "candidateOverflowCount": 0
  }
}
```

Row/header agreement is perfect, yet the missing source value forces `rejected`
with `score: null` → arbitration uses the source crop.

## 9. Numeric & cell-association integrity (highest priority)

Each source numeric token is mapped to its source cell by bbox containment, and
to the candidate cell that carries the same value. `numericCellAssociationAccuracy`
is the fraction whose source cell equals the candidate cell. A value missing from
the candidate → `source_numeric_token_missing`; present in the wrong cell →
`numeric_token_wrong_cell`; duplicated into unrelated cells →
`source_numeric_token_duplicated`. Punctuation (currency, percentage, decimal,
range separator, date, measurement) is preserved as source evidence and never
normalized away. When association cannot be proven for a **financial** table,
accuracy is `null` and the candidate cannot become verified-native — E4 never
guesses.

## 10. Adjacent-merge & split detection

`detect_adjacent_merge` flags `adjacent_source_tables_merged` when one candidate
materially overlaps ≥2 independent source table regions (never "repaired" by a
semantic split — the candidate is rejected and each region is arbitrated with its
own crop). `detect_source_split` flags `single_source_table_split` when one
source region yields multiple same-provider fragments; a deterministic merge is
allowed only for an exact non-overlapping row partition with identical column
topology and exact numeric association, otherwise the source crop is used.

## 11. Arbitration

`arbitrate_table_candidates` selects the strongest **safe** candidate (zero hard
defects, complete required evidence, and — for financial tables — association =
1.0). Ranking: integrity score → numeric-association accuracy → header recall →
row agreement → span agreement → bbox IoU → **provider priority (last)** →
candidate id. States: `native_verified` | `source_crop` | `containment_fallback`
(no crop, page raster exists) | `blocked` (no crop, no raster). It never claims
source-crop preservation without a crop.

## 12. Preservation plan & suppression

`build_table_preservation_plan` maps each table region to a render mode:
`verified-native-table` (render native, keep the crop for reference, suppress
duplicate child text/vector overlays), `table-source-crop` (render the exact crop
as one locked visual object, suppress the native table + child text + grid
vectors + nested chart, require review), `containment-fallback` (defer to E0),
`blocked` (manual review, never a false "safe" claim). The renderer-facing
`resolveTableSuppression` hides candidate overlays whose centre sits inside a
rendered table crop and are not page-sized; adjacent prose, page headings and a
chart **beside** the table are never suppressed.

## 13. Native rendering & the `Column N` fix

`deriveNativeHeaderPolicy` (consumed by `mapDoclingToPagePlan`) **stops
synthesizing `Column 1..N`**: labels come from the source header row only (a
blank label stays blank), `showHeader` follows the source (a header-less table
shows no header), and a source that literally reads `Column N` is surfaced as a
risk flag. The overlay carries `sourceTableRegionId`, `fitPolicy` and a bounded
`tablePreservation` audit (flags/codes only). Full source-derived column widths /
row heights / multi-row-header rendering require renderer changes deferred to the
E5/renderer handoff (documented below) — E4 does not add layout fields that only
one renderer honors.

## 14. E0 & E3 interoperability

`tableContainmentRequirement` maps arbitration state → E0 requirement
(`permit_score_based` / `protected_visual` / `page_fallback` / `manual_review`);
invalid/absent E4 evidence returns `null` so **E4 can never weaken E0**. E0 safe
defaults stay false; existing generic-header/table containment checks remain.
E3 chart preservation is independent: adjacent chart+table crops both render; a
nested chart inside a source-cropped table is suppressed once (outer table wins);
chart and table metrics stay in separate contracts.

## 15. Page Artifact Contract V3 extensions (additive)

Per page: `table_region_count`, `table_candidates_path`, `table_arbitration_path`,
`table_candidate_contract_version`, `table_arbitration_version`,
`table_preservation_version`, and the `table_preservation` plan. Document totals:
`total_table_region_count`, `total_native_verified_table_count`,
`total_source_crop_table_count`, `total_blocked_table_count`. Artifact tree:
`pages/page-NNN/table-candidates.json` + `table-arbitration.json` (private durable
paths; no signed URLs). `tables.json` is unchanged.

## 16. Lazy signed delivery (prepared, not deployed)

The authenticated `get_artifacts` contract can be extended to sign selected
`table_candidates` / `table_arbitration` / `table_crop` / `table_integrity`
artifacts for selected pages/region-ids, derived from trusted V3 manifests,
ownership-checked, capped and TTL-bounded, never logged or persisted. E4 prepares
this; it does **not** deploy Edge Functions.

## 17. Chunk / cache parity

Candidate/cell/arbitration IDs and crop hashes are chunk-independent (source
region id + normalized bbox), so monolithic, chunked, recovered-chunk and
cache-replay runs produce identical arbitration decisions. Parent-global paths
carry no chunk-local references (E1/E2 rebasing already handles region crops).
An incomplete E4 table package never marks a page complete and never weakens E0.
Cache replay must reproduce candidates + integrity + arbitration + crops +
selected references + plans + metrics; a partial copy is not complete; pre-E4
V2/V3 caches remain legacy and cannot fabricate verified-native state.

## 18. Performance & budgets

The primary parse adds only the pure primary-candidate arbitration (no extra
conversions), so table-heavy 25/80-page jobs incur no extra document
conversions. Alternate conversions are page-bounded and budgeted. Additive E4
timings (`table_candidate_generation_ms`, `table_integrity_ms`,
`table_arbitration_ms`, `alternate_conversion_page_count`, candidate bytes) are
namespaced and do not change Operational Metrics V1 semantics.

## 19. Security & privacy

No source table text in logs; no full financial table in errors; no signed URL
persisted; no external provider; no request-selected provider/model; candidate
paths stay under the trusted job prefix (traversal/external-URL rejected); no
client PDF/crop committed; problems are bounded codes/counts only; candidate JSON
stays private; no source numeric values in telemetry; no automatic AI.

## 20. Tests

- **Python (53):** contract/IDs/mutation, evidence bounding, primary + PyMuPDF
  grid generation (ruled→candidate, borderless/decorative/straddle→none),
  integrity (row/col/header/generic/missing/wrong-cell/duplicated/bbox/overflow/
  contrast), score-cannot-override-defect, adjacent-merge, split, arbitration
  (native/crop/containment/blocked/tie-break/provider-last), preservation +
  nested-chart suppression, E0/E3 interop, security.
- **TypeScript (26):** cross-runtime ID parity, validators, header policy (no
  `Column N`), suppression, document report, E0 handoff, template bridge.
- All 66 E1 + 33 E3 + E0 suites remain green (217 pure Python + full TS specs).

## 21. Acceptance thresholds (native approval)

A native table is approved only when: hard-defect count = 0; source row/column
coverage = 100%; critical numeric-token recall = 100%; wrong-cell associations =
0; required header recall = 100%; invalid spans = 0; clipped rows/columns = 0;
overflow = 0; candidate inside source bbox; renderers agree; source crop retained
for reference. Otherwise → source crop. These thresholds are never weakened to
increase editability.

## 22. Private-report operator acceptance checklist

Do not commit the private report or hard-code page numbers/source text. Per the
known failure classes, an operator should confirm on the live private report:

- **Property/cost/turnkey pages:** independent tables stay independent (no single
  merged candidate); financial values stay on their source rows; each region has
  its own crop + arbitration; unsafe candidates use independent crops.
- **Infrastructure pages:** meaningful headers retained; no visible `Column N`;
  no dark-on-dark text; all source rows visible; employment vs infrastructure
  tables independent.
- **Comparable-sales / rental pages:** every comparable + subject row present; no
  clipped rows; address/config/land/price/date/notes associations correct;
  comparable-sales and rental-assumptions tables separate; E3 chart preserved.
- **Financial-projection pages:** headers retained; Entry / Year 1/2/3/5/7/10
  distinct; value/equity/rent associations correct; no row splitting/reordering;
  E3 chart preserved.
- **Document-level:** no generic headers where source headers exist; wrong-cell
  numeric associations = 0; critical numeric recall = 100%; clipped/dropped rows
  = 0; merged adjacent tables = 0; every unsafe table uses an exact crop or E0
  fallback; no crop/native duplicate rendering; preview and export agree; cache
  replay makes the same decisions.

## 23. Deployment scope (NOT performed here)

Later controlled deployment would require: building/pushing the sidecar image
(the new pure modules `table_candidates.py` + `table_integrity.py` are copied by
the explicit runtime-module list; no Dockerfile behavior change otherwise);
optionally deploying the `get_artifacts` signing extension. No migration is
required (all E4 artifacts are Storage JSON under the job prefix). No cache
fingerprint change was made; a future component list is handed to E10.

## 24. Rollback

E4 is additive and gated: absent/invalid E4 evidence degrades to E0 behavior.
Reverting the mapper header change restores the previous (defective) `Column N`
labels; reverting the sidecar table pass drops the artifacts without affecting
E0/E1/E3.

## 25. Future handoffs

- **E5 — Typography fidelity:** exact fonts, tracking, glyph widths, punctuation
  fit and per-cell typography for verified native tables (E4 preserves text +
  numeric tokens; it does not yet reproduce per-cell typography).
- **E6 — General region output policy:** `verified-native-table` /
  `table-source-crop` / `containment-fallback` map into the generic region
  strategy; E3 and E4 stay independent until then (do not merge prematurely).
- **E7 — Quality Gate V2:** consume the hard-defect codes and numeric-association
  metrics as hard inputs; fold the table metrics into the quality model.
- **E9 — Provider ensemble:** the `TableCandidateProvider` shape leaves room for
  future Document AI candidates (not implemented or called).
- **E10 — Routing & cache:** the future cache fingerprint must include
  `table-candidate-contract-v1`, `table-integrity-report-v1`,
  `table-arbitration-v1`, `table-preservation-v1` and the candidate provider/
  profile set.

## 26. Known limitations (not hidden)

- Alternate vNext/PyMuPDF candidates are implemented as a budgeted, runtime-gated
  path and unit-tested with the pure builders, but the primary parse currently
  emits only the primary candidate; multi-conversion candidate generation across
  a live Docling runtime is a follow-up (no conversions run in this code-only
  package).
- Source-derived column widths / per-row heights / multi-row-header **rendering**
  are deferred to the renderer/E5 handoff; the mapper fix delivers the header
  (`Column N`) and `showHeader` correctness that every renderer already honors.
- Overflow/contrast vetoes are conservative deterministic estimates from source
  geometry/colors; exact glyph-metric fitting is E5.

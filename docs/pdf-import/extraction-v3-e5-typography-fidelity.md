# PDF Extraction V3 · E5 — Typography, Glyph, Unicode & Font Fidelity

> **Status:** code complete. **Scope:** code-only, fully backward compatible, no
> deploy. No Google Cloud / Cloud Run / Docker build / image push / production
> infra / release-script change; no Supabase migration or Edge Function deploy;
> no external font/OCR/AI provider. Builds on E0 (containment), E1 (Source Scene
> Graph V2), E2/J1 (Docling vNext runtime), E3 (Chart Preservation) and E4 (Table
> Arbitration), all merged.

## 1. Problem statement

The pipeline preserves broad prose but can still change or destroy the visual +
semantic meaning of typography: en dashes → hyphens or vanishing from ranges
(`10–15 years` → `1015 years`, `$910,000–$920,000` → `$910,000$920,000`); minus →
hyphen (`−$25,000` → `-$25,000`); `8×8` → `8x8`; NBSP collapsed; `712m²` → `712m2`;
`dual-occupancy` → `dualoccupancy`; font substitution changing wrapping/line
count/baseline; branded wordmarks reconstructed with the wrong font/weight/
tracking; single-line source wrapping (or multi-line reflowing); text clipped/
hidden/off-page/low-contrast; numeric weights collapsed to normal/bold; subset
font names treated as different fonts; missing ToUnicode → `GLYPH<n>` placeholders
stripped without recovering the source characters; embedded fonts unused; web-font
substitutes chosen by name similarity not metrics; preview passing while export
clips/substitutes.

For financial/legal/analytical documents, **punctuation and glyph identity are
content integrity**, not decorative polish.

**Governing rule:** *source content and source glyph identity outrank
editability.* A locked exact source crop is acceptable; a visually editable text
run with altered financial meaning is not. A weighted score never overrides a
hard typography defect.

## 2. Non-goals

E5 does not: infer a font from visual resemblance; use OCR to overwrite a
trustworthy source run; rewrite/truncate/shorten copy or numbers to fit; remove
punctuation to fit; convert a text logo to editable text when exact reproduction
is impossible; expose extracted fonts publicly or claim a font licence; turn
every source line into an image; flatten simple verified prose; alter production
routing; recreate E3/E4; implement Document AI / external font ID.

## 3. Contract versions

| Contract | Version | Module |
|---|---|---|
| Source typography evidence | `source-typography-evidence-v1` | `pdf-parse-service/source_typography.py` |
| Source font identity | `source-font-identity-v1` | `source_typography.py` |
| Typography run | `typography-run-contract-v1` | `source_typography.py` |
| Font asset manifest | `font-asset-manifest-v1` | `font_assets.py` |
| Typography fidelity report | `typography-fidelity-report-v1` | `_shared/typographyFidelity.pure.ts` |
| Typography preservation plan | `typography-preservation-v1` | `typographyFidelity.pure.ts` |
| Font resolution policy | `font-resolution-policy-v2` | `typographyFidelity.pure.ts` |

The Python producers build the immutable evidence; the canonical TypeScript
module evaluates, resolves, arbitrates and consumes it. Deterministic run/font
IDs are **byte-identical** across runtimes (verified by parity tests).

## 4. Raw Unicode policy

Raw source text is preserved **exactly**. NFC is stored in a **separate**
`normalizedNfc` field and a `searchNormalized` (NFKC + folded dashes/spaces)
field coexists for search only — **neither becomes the visible text**. The
extended punctuation lexicon (`extract_punctuation_tokens_e5`) distinguishes
hyphen / en-dash / em-dash / minus / multiplication / arrows / bullet / middle-
dot / NBSP / narrow-NBSP / figure/thin/punctuation space / soft-hyphen /
typographic quotes+apostrophe / ellipsis / degree / prime / section-sign /
trademark / registered / copyright / superscripts. A normal space (U+0020) is
never treated as punctuation. Critical kinds (range separators, currency-adjacent
signs, superscripts, NBSP, degree, section) are flagged `critical: true`.

## 5. Glyph evidence & unmapped glyphs

Per-code-point `SourceGlyphEvidenceV1` keeps glyph identity and Unicode mapping
**separate**; character geometry is `null` when the provider does not supply it
(never fabricated). `GLYPH<n>` placeholders + replacement/null chars are counted
(`count_unmapped_glyphs`) and flag `unmapped_source_glyph` — the glyph is **never
deleted, never assigned guessed Unicode**, and the run is marked incomplete →
resolution falls to a source-text crop.

## 6. Font identity & assets

`source-font-identity-v1` preserves the **raw** PDF font name; the subset prefix
(`ABCDEF+`) is stripped only into a separate `normalizedFamily` for matching, and
`isSubset`/`subsetPrefix`/weight/width/italic/oblique/monospace/serif/variableAxes/
`sourceObjectRef` are retained. `font_assets.py` validates a font **program**
defensively and non-executing: magic bytes → format, size caps (64 B–8 MB), sfnt
table-directory sanity (table count, offset bounds), required `glyf`/`CFF `+`cmap`
tables. Malformed/oversized/unsupported → rejected. The private
`font-asset-manifest-v1` records SHA-256, MIME/format, glyph coverage, embedding
policy (`private-job-only`) and **licence state (`unknown` by default — technical
embeddability is not a licence)**. Font bytes never enter template JSON, never
become a data/signed URL, are never committed or exposed as a user download.

## 7. Font resolution (font-resolution-policy-v2)

Deterministic precedence in `resolveFontV2`: **(1)** exact embedded font (valid +
policy-permitted + covers every run glyph) → **(2)** exact approved installed font
→ **(3)** complete embedded subset (covers every glyph the run needs — a subset is
never a complete family) → **(4)** measured metric-compatible substitute →
**(5)** source-text crop → **(6)** unavailable. **Family-name similarity ALONE
never wins** — a metric-compatible substitute requires 100% glyph coverage *and*
measured metrics (total-advance ratio within tolerance, no line-count regression)
from the actual candidate font engine. A `policy_disallowed` asset falls back
visually.

### Generated example (redacted)
```
resolveFontV2("Hello", { approvedCandidates: [{ family: "ArialLike",
  coversCodePoints: [...], metrics: { totalAdvanceRatio: null } }] })
→ { state: "source-crop", ... }        // unmeasured candidate cannot win
resolveFontV2("Hello", { approvedCandidates: [{ family: "Metric",
  coversCodePoints: [...], metrics: { totalAdvanceRatio: 1.02, lineCountMatch: true } }] })
→ { state: "metric-compatible", selectedFamily: "Metric", ... }
```

## 8. Punctuation & numeric integrity (financial-safety core)

`evaluateTypographyFidelity` compares the candidate run's text against the source
run and vetoes on hard defects. Critical punctuation must be present exactly;
**a numeric range whose separator vanished so the endpoints fuse** (`10–15` →
`1015`, `$910,000–$920,000` → concatenated) fails with `range_separator_missing`;
`8×8`→`8x8` fails `multiplication_sign_changed`; `−`→`-` fails `minus_sign_changed`;
a dropped currency/percentage symbol fails `currency_symbol_missing`/
`percentage_symbol_missing`; a missing/duplicated source number fails
`critical_numeric_token_missing`/`_duplicated`; a dropped NBSP fails
`nonbreaking_space_changed`. Ranges are matched by expanding to their two endpoint
numbers, so exact ranges pass while fused ranges fail.

## 9. Line & baseline preservation

Imported PDFs are **fixed-layout**: the candidate line count must equal the source
line count (`source_line_count_changed`), baseline drift beyond tolerance fails
(`baseline_drift`), and a source single-line run may use `nowrap` only after a
measured fit — `nowrap` is never permission to clip.

## 10. Native fitting (deterministic, bounded)

Order: exact source asset → exact approved font → metric-compatible → bounded
tracking correction → bounded font-size correction → bounded bbox adjustment
(within the source region, no collision) → source-text crop → E0. Every pass
remeasures line count / width / height / clipping / collisions / baseline /
punctuation / numeric tokens; **max two passes**, then fall back. Never delete
characters, replace punctuation, remove spaces, truncate, ellipsize, hide
overflow, reduce opacity, drop below a readable minimum, expand outside the
region, or change financial content.

## 11. Fidelity report & hard defects

`typography-fidelity-report-v1` records `state` (verified/degraded/rejected/
unverifiable), a `score` (only with zero hard defects — never overrides a defect),
`hardDefects` and bounded metrics (`null` = unmeasured, `0` = measured zero; no
NaN/Infinity; inputs never mutated). The 40 `TypographyDefectCode` values cover
text/codepoint/glyph, critical punctuation + numeric + range/currency/percentage/
multiplication/minus/NBSP, font asset (missing/invalid/policy/subset/coverage/
metric/weight/style/variation), line/baseline/bbox, overflow/clipped/off-page/
collision/contrast, writing-mode, renderer-parity, export-embedding, unscored and
source-text-crop-missing. **Hard-veto rules:** a run may not become verified
native text when any critical code point/numeric/punctuation changes, a glyph is
unmapped or coverage incomplete, text is clipped/off-page/colliding, the
fixed-layout line count changes, a range separator is lost, export ≠ preview, the
exact font cannot embed and metric compatibility fails, the writing mode is
unsupported, or the run was unscored.

## 12. Preservation plan & modes

`arbitrateTypographyPreservation` → `verified-native-text` (zero hard defects +
resolved exact/subset/metric font; crop kept for reference) · `source-text-crop`
(native unsafe → render exact crop, suppress the native overlay, require review) ·
`containment-fallback` (no crop, page raster exists → E0) · `blocked` (no crop, no
raster). It never claims crop preservation without a crop.

## 13. Source-text crops

Rendered only for runs that need them (branded wordmark, unmapped-glyph run,
unsupported vertical/RTL, unavailable critical font, un-reproducible critical
punctuation, failed native fit) — never ordinary verified prose. Rules (mirroring
E3/E4 crops): from the original PDF, ≥300 DPI, lossless PNG, deterministic
padding, durable private path (`{jobId}/pages/page-NNN/typography/{sourceRunId}.png`),
SHA-256, blank-crop detection, no signed/data URL persisted. Runs may share one
crop only for one contiguous logical visual unit.

## 14. Suppression & E3/E4 precedence

`resolveTextSuppression` hides candidate overlays behind a rendered source-text
crop; but **E4 table crops and E3 chart crops OWN the text inside them** — an E5
run whose bbox sits inside a chart/table crop is *skipped* (no duplicate crop, no
suppression) so each source pixel renders once. Adjacent prose / captions /
footnotes outside the crop, and text in an adjacent table/chart, are never
suppressed. Semantic text is retained for search/accessibility, visually
suppressed (no export duplication).

## 15. Renderer parity matrix

| Field | Editor | Preview | Print | Export | Fallback if export ignores |
|---|---|---|---|---|---|
| Raw Unicode / punctuation | ✓ | ✓ | ✓ | ✓ | n/a (always preserved) |
| `fontWeightNumeric` | ✓ | ✓ | ✓ | ✓/safe | crop |
| Per-run family/size/weight (`runs`) | ✓ | ✓ | ✓ | ✓ where supported | crop |
| `letterSpacing` / `lineHeight` | ✓ | ✓ | ✓ | ✓ | crop |
| `fontVariationSettings` (axes) | ✓ | ✓ | ~ | static instance or crop | crop |
| Embedded custom font bytes | ✓ (Blob) | ✓ | ~ | embed or crop | crop |

A field may not be used for *verified native output* when the export renderer
ignores it — the run resolves to a source-text crop instead of silent
degradation (`export_font_embedding_failed` / `renderer_parity_failed`). **E5
ships the pure fidelity + parity contract; the concrete export-embedding measure
is a runtime-gated adapter (see Known limitations).**

## 16. Page Artifact Contract V3 extensions (additive)

Per page: `typography_run_count`, `unmapped_glyph_count`, `typography_path`,
`source_typography_evidence_version`. Document totals:
`total_typography_run_count`, `total_unmapped_glyph_count`,
`source_typography_evidence_version`, `font_asset_manifest_version`. Artifact:
`pages/page-NNN/source-typography.json` (private); future `fonts/font-manifest.json`
+ `{fontAssetId}.<private-format>` and `pages/page-NNN/typography/{sourceRunId}.png`.
No existing artifact removed; no signed URL persisted. Additive optional
`TextOverlay` schema fields: `sourceTypographyRunIds`, `fontAssetId`,
`fontResolutionState`, `baselineShift`, `wordSpacing`, `typographyPreservation`
(bounded audit).

## 17. E0 / E3 / E4 interoperability

`typographyContainmentRequirement` maps run mode → E0 requirement
(`permit_score_based`/`protected_visual`/`page_fallback`/`manual_review`);
invalid/absent E5 evidence → `null` so **E5 never weakens E0**. E3 chart + E4
table preservation are untouched and take precedence for nested text; invalid E5
evidence cannot validate an unsafe E4 table, and invalid table evidence cannot
invalidate an unrelated prose run. The contracts stay separate (E6 generalizes
later).

## 18. Chunk / cache parity

Run + font-asset IDs are chunk/cache-independent (parent-global page + normalized
bbox + span IDs + font object ref), so monolithic / chunk / recovered-chunk /
cache-replay produce identical typography decisions and hashes. Parent-global
artifacts carry no chunk-local paths. An incomplete typography package never
marks a page complete and never weakens E0. Cache replay reproduces the evidence,
manifests, private assets, reports, plans and crops; pre-E5 caches stay legacy and
cannot fabricate verified typography.

## 19. Performance & limits

Bounded: `MAX_TYPOGRAPHY_RUNS_PER_PAGE`, `MAX_GLYPHS_PER_RUN`, `MAX_RUN_TEXT_LEN`,
`MAX_FONT_BYTES`, `MAX_TABLE_COUNT`, `MAX_GLYPH_COUNT`. Exceeding a limit records a
structured problem, marks evidence incomplete, and falls back — never silent
truncation of critical text. Additive namespaced E5 timings do not change
Operational Metrics V1 semantics.

## 20. Security & font-asset review

No font binary committed/shared/public; no data/signed font URL persisted; no
arbitrary font URL or model accepted from a request; durable font paths validated
under the job prefix (traversal/external-URL rejected); font parser input bounded,
malformed fonts rejected, programs never executed; no raw source paragraph or
financial value in logs/telemetry; problems are bounded codes/counts; licence
state never fabricated (`unknown` stays unknown); no external font/OCR/AI/VLM;
Blob/object URLs revoked by the loader.

## 21. Tests

- **Python (38):** contract/IDs (chunk-independent, signed-URL-invariant), raw-vs-
  NFC + search-normalized separation, punctuation integrity (en/em-dash, minus,
  ×, arrows, NBSP, narrow-NBSP, superscript, degree; normal space not classified;
  hyphen≠dash), glyph evidence + unmapped-glyph (no guessed Unicode), font
  identity (subset prefix retained + normalized, weight/width/italic/axes/ref),
  font-asset validation (magic/size/table/coverage/subset gate), critical-content
  classification, security.
- **TypeScript (34):** cross-runtime ID parity, the full punctuation/numeric
  financial-safety matrix (`10–15`→`1015`, `$910,000–$920,000`, `8×8`→`8x8`,
  `−`→`-`, `%`, `$`, missing numeric, NBSP), score-cannot-override-defect, glyph
  coverage, measured fit (overflow/clipped/line-count/parity/contrast), font
  resolution v2 (exact/subset/incomplete/metric/family-name-alone-fails/tolerance),
  preservation arbitration, suppression + E3/E4 precedence, document report + E0
  handoff, template bridge.
- All 66 E1 + 33 E3 + 53 E4 + E0 suites remain green (255 pure Python total).

## 22. Acceptance thresholds (native approval)

hard-defect count = 0; critical code-point / numeric-token / punctuation recall =
100%; glyph coverage = 100%; clipped/off-page glyphs = 0; overflow width/height =
0; material collisions = 0; source line-count agreement = 100%; line-break
agreement meets the fixed-layout threshold; font metric difference within
documented bounds; baseline drift within bounds; preview/export parity passes;
selected font asset valid + policy-permitted. Otherwise → source-text crop or E0.

## 23. Private-report operator acceptance checklist

Do not commit the private report or hard-code its text/page numbers. Per the
failure classes, an operator confirms on the live private report: cover/brand
wordmark exact (native, E3 logo crop, or E5 crop — no generic italic passed as
exact; mixed colours + tracking preserved); prose headings/hierarchy + source
line structure within tolerance, no overlaps/clipped lines/joined words/
punctuation loss; range-heavy pages keep `10–15 years` + currency ranges exact
with en/em distinctions and no concatenation; chart pages keep E3 crops
authoritative with no duplicate axis/legend text; table pages keep E4
preservation authoritative with exact cell text/punctuation and no duplicate E5
text; financial-projection pages keep currency/percent/Year associations exact;
legal/disclaimer pages complete with no clipped lines and export = preview; and
document-level: critical Unicode/numeric/punctuation recall = 100%, unmapped
visible glyphs = 0, clipped glyphs = 0, overflow = 0, material collisions = 0,
preview/export parity failures = 0, no E3/E4/E5 duplicate rendering, cache replay
identical.

## 24. Deployment scope (NOT performed)

Later controlled deploy would: build/push the sidecar image (the new pure modules
`source_typography.py` + `font_assets.py` are copied by the explicit
runtime-module list; no Dockerfile behaviour change otherwise); deploy the
`get_artifacts` signing extension for typography/font artifacts; enable the
runtime-gated export-parity + font-extraction adapters. **No migration** (all E5
artifacts are Storage JSON/PNG under the job prefix). No cache-fingerprint change
(the E10 component list is handed off below).

## 25. Rollback

E5 is additive and gated: absent/invalid E5 evidence degrades to E0. Reverting the
sidecar typography pass drops the artifacts without affecting E0/E1/E3/E4;
reverting the schema fields leaves existing templates valid (all optional).

## 26. Future handoffs

- **E6 — General Region Output Policy:** `verified-native-text` / `source-text-crop`
  / `containment-fallback` / `blocked` map into the generic region strategy; E3/E4/E5
  stay independent until then.
- **E7 — Quality Gate V2:** consume the hard-defect codes + critical recall metrics
  as global page/document quality inputs.
- **E9 — Provider ensemble:** the provider-neutral source typography inputs leave
  room for future providers (no remote font/OCR provider implemented or called).
- **E10 — Routing & cache:** the cache fingerprint must include
  `source-typography-evidence-v1`, `font-asset-manifest-v1`,
  `typography-fidelity-report-v1`, `typography-preservation-v1`,
  `font-resolution-policy-v2`, the approved-font-catalogue version and any font
  conversion tool/version.

## 27. Known limitations (not hidden)

- **Character-level glyph geometry** (per-glyph bbox/advance) is recorded as `null`
  when the provider does not supply it — the sidecar wires span-level evidence
  today; a fontTools/PyMuPDF character pass is a follow-up (marked unavailable,
  never claimed as glyph-perfect).
- **Font-binary private upload + real WOFF2 conversion + fontTools coverage** and
  the **actual browser export-parity measurement** are provided as tested pure
  APIs + runtime-gated adapters; they are not run in this code-only package (like
  E4's alternate conversions). The mapper preserves raw punctuation + numeric
  weight today; full run-level typography threading into every renderer for
  *verified native* output is gated behind the parity adapter.
- `fontFaceBuilder` still emits embedded fonts as `data:` URLs (pre-E5 behaviour,
  left unchanged to keep E5 isolated); the private font-asset manifest is the
  additive replacement path, migrated when the signing Edge Function ships.
- 6 pre-existing tsc errors on `main` (`stepUp.ts` missing dependency + 5 latent
  `chartPreservation.pure.ts`) are unrelated to E5 and left untouched.

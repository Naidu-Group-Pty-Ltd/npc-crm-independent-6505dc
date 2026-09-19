# PDF Extraction V3 · E6 — Unified Region Output Policy & Composition

> **Status:** code complete. **Scope:** code-only, fully backward compatible, no
> deploy. No Google Cloud / Cloud Run / Docker build / image push / production
> infra / release-script change; no Supabase migration or Edge Function deploy;
> no external OCR/AI/font/VLM provider. Builds on E0 (containment), E1 (Source
> Scene Graph V2), E2/J1 (Docling vNext runtime), E3 (Chart Preservation), E4
> (Table Arbitration) and E5 (Typography Fidelity) — all merged. E6 is a **pure
> TypeScript composition layer**: it composes existing decisions, so there is no
> new Python module and no `app.py` change.

## 1. Problem statement

E3/E4/E5 each preserve one region *class* well, but their decisions live in
independent bridges that are **not yet composed into a single render plan**.
Without a unifying layer a page can render the same source pixel twice or drop a
critical region entirely: a chart nested inside a table produces both the table
crop **and** the chart crop; a source-crop region keeps its native text overlay
so the raster **and** the reflowed text both paint (the "locked overlays still
render" defect the master plan calls out for pages); an operator "force native"
silently overrides a page raster-only final policy; an export begins while a
required crop asset is missing; two overlapping final crops with no ownership
relationship fight for the same pixels. Each renderer (editor, preview, print,
export, visual-QA) independently re-deriving "who owns this pixel" is exactly how
those drift.

**Governing rule:** *source fidelity outranks editability, and a weighted score
never overrides a composition hard defect.* A locked exact source crop is
acceptable; a visually editable region duplicated on top of its own crop is not.

**Core invariant:** for every source region the visible source-representation
count ∈ {0, 1}; for every **required critical region** in accepted final output
it is exactly **1**. No source pixel renders twice; no critical region renders
zero times.

## 2. Non-goals

E6 does not: re-score or reinterpret an E3/E4/E5 hard defect; improve extraction
or re-run detection; replace E0 containment or the page-level policy
(`pdf-page-output-policy-v1` stays authoritative for page-wide raster — region
policy composes *beneath* it); rewrite renderers in this package (it ships the
pure contract + adapters + integration bridge that renderers will consume behind
the runtime-gated wiring); persist signed URLs; treat `overlay.locked` as a
visibility signal or opacity-zero as canonical suppression; guess an overlay's
region by name or text content; add a migration; deploy anything.

## 3. Contract versions

| Contract | Version | Module |
|---|---|---|
| Region output policy | `pdf-region-output-policy-v1` | `_shared/regionOutputPolicy.pure.ts` |
| Region render plan | `pdf-region-render-plan-v1` | `regionOutputPolicy.pure.ts` |
| Region ownership graph | `pdf-region-ownership-v1` | `regionOutputPolicy.pure.ts` |
| Region composition report | `pdf-region-composition-report-v1` | `regionOutputPolicy.pure.ts` |
| Region operator override | `pdf-region-operator-override-v1` | `regionOutputPolicy.pure.ts` |

The single **canonical** implementation lives in
`supabase/functions/_shared/regionOutputPolicy.pure.ts`; the frontend entry point
`src/lib/reportTemplate/pdfImport/regionOutputPolicy.pure.ts` re-exports it so the
editor, the Edge Functions and Vitest consume one contract with no handwritten
duplication. Deterministic hashes are byte-identical across runtimes (FNV-1a-32,
shared with E1). No signed URLs, DOM, network or I/O; inputs are never mutated.

## 4. Region output policy (`pdf-region-output-policy-v1`)

Every source region resolves to one `PdfImportRegionPolicyV1` carrying four
**separated** concerns (mirroring the page-policy separation E5/C5 established):

- `strategy` ∈ `native` · `source-crop` · `native-with-source-reference` ·
  `hidden-semantic` — how the region's pixels are produced.
- `resolutionState` ∈ `resolved` · `page-fallback` · `blocked` — whether a safe
  region decision exists at all.
- `nativeLayerPolicy` ∈ `editable` · `locked` · `hidden` — what the native layer
  does; a source-crop region hides its native layer (never merely "locks" it).
- `sourceCropRole` ∈ `none` · `editor-reference` · `final-output` — whether a
  crop is the visible output or an editor-only reference.
- `semanticLayerPolicy` ∈ `visible-native` · `hidden-metadata` ·
  `accessibility-only` — retains semantic text for search/accessibility while
  visually suppressed (no export duplication).

`sourceCropRef` carries only a **durable** artifact path (never a signed/data
URL), sha256, bbox, mime, dpi. `selectedEvidence` records which contract
(`e3-chart`/`e4-table`/`e5-typography`/`source-scene`/`legacy`/`operator`) decided
the region, its decision id and version — E6 **adapts**, it never re-derives.
`validateRegionPolicy` defensively rejects a persisted signed URL
(`signed_url_persisted`), an unknown strategy, and a `final-output` source-crop
with no path (`region_source_crop_missing`).

## 5. E3/E4/E5 adapters (never re-score, never downgrade a defect)

Each adapter maps an existing preservation plan to a region policy, copying hard
defects **verbatim**:

- **E3** `adaptChartPlanToRegionPolicy`: `chart-crop` → `source-crop` /
  `final-output` / native `hidden`; `containment-fallback` → `page-fallback` (no
  false crop). Charts are always critical.
- **E4** `adaptTablePlanToRegionPolicy`: `verified-native-table` →
  `native-with-source-reference` (crop kept as `editor-reference`);
  `table-source-crop` → `source-crop` / `final-output`; `blocked` → `blocked` +
  manual review; else `page-fallback`. `hardDefectCodes` preserved exactly.
- **E5** `adaptTypographyPlanToRegionPolicy` (per source run):
  `verified-native-text` → `native-with-source-reference`; `source-text-crop` →
  `source-crop`; `blocked` → `blocked`. Critical **only** when the run resolves to
  a crop/blocked state — ordinary verified prose stays non-critical so a page need
  not fall back for it.

A `source-crop`/`final-output` decision whose crop path is absent records
`region_source_crop_missing` and stays a crop decision (never silently promoted
to native).

## 6. Generic region policy (fail-closed default)

`genericRegionPolicy` covers regions with no E3/E4/E5 plan (picture, logo,
vector-cluster, unknown-visual, plus text/background): plain text/background →
`native`, non-critical; a critical visual with a valid crop → `source-crop`; a
native image that **is** the exact source (`nativeImageIsExactSource`) →
`native-with-source-reference` (no duplicate crop); a critical visual with **no**
usable crop → `page-fallback` + `region_source_crop_missing` (never a blank
native region).

## 7. Ownership graph (`pdf-region-ownership-v1`)

`buildRegionOwnershipGraph` derives, deterministically, which region owns each
pixel. **Explicit scene-graph relationships outrank inferred bbox containment;**
bbox fallback picks the *smallest strictly-containing* region as parent only when
no explicit parent exists. A region is **suppressed** when it has a
`source-crop`/`final-output` **ancestor** (the outermost crop owns everything
nested inside it — a chart inside a table crop is suppressed). Self-parent, a
missing owner, and cycles are **hard composition defects** recorded as
`region_ownership_cycle` / `region_owner_missing` — never broken arbitrarily; the
graph reports `complete: false` and the render plan degrades to page fallback.
Nodes are emitted in a stable region-id order with `visibleOwnerRegionId`,
`bbox`, `zOrderHint` and `sourceContract`.

## 8. Render plan (`pdf-region-render-plan-v1`)

`resolvePdfRegionRenderPlan` produces **ONE** deterministic plan every surface
consumes. Precedence:

1. **Page raster-only** (`pdf-page-output-policy-v1` says the page is a full
   raster) → the page raster is the *only* visible representation: every region
   crop and every overlay is suppressed; a missing raster is `page_raster_missing`.
   A region decision can never escape a page raster-only final policy.
2. Else, per region: a `source-crop`/`final-output` region renders its crop
   (locked, no native overlay); a `native`/`native-with-source-reference` region
   renders its native layer; a region with a source-crop ancestor is suppressed;
   `hidden-semantic` never renders (kept for accessibility only).
3. **Editor-reference crops** appear only when `includeEditorReferences` is set —
   never in final output. The final-output plan hash is **identical** with or
   without the editor option.
4. Two `final-output` crops that overlap materially with **no** ownership relation
   fail closed → `unresolved_region_crop_overlap` + page fallback (adjacent
   non-overlapping crops render independently).
5. An overlay mapped to a suppressed or cropped region is suppressed; unmapped
   prose overlays render normally.

The plan carries `renderFullPageRaster`, `renderNativeOverlayIds`,
`renderRegionCrops` (durable paths, z-ordered, `locked: true`),
`editorReferenceCrops`, `suppressedOverlayIds`, `suppressedRegionIds`,
`hiddenSemanticRegionIds`, `accessibilityRegionIds`, `requiresPageFallback`,
`blocked`, `manualReviewRequired`, `hardDefectCodes`. The **core invariant** is
enforced in-plan: a resolved critical region that is neither rendered nor
suppressed-by-owner records `source_region_not_rendered`; a crop whose native
overlay also renders records `crop_and_native_both_visible`.

## 9. Composition hard defects

~40 `RegionCompositionDefectCode` values cover policy validity
(`region_policy_missing/invalid`, `unknown_region_strategy`), crop integrity
(`region_source_crop_missing/invalid`, `region_crop_asset_unavailable/expired/
hash_mismatch`, `region_crop_bbox_invalid`, `region_crop_outside_page`), the
invariant (`duplicate_source_pixels`, `source_region_not_rendered`,
`crop_and_native_both_visible`, `nested_crop_both_visible`,
`unresolved_region_crop_overlap`, `unresolved_critical_region`), ownership
(`region_ownership_cycle`, `region_owner_missing`, `region_parent_mismatch`,
`region_page_mismatch`, `duplicate_region_id`), suppression
(`suppression_target_missing/conflict`, `hidden_semantic_visible`,
`editor_reference_visible_in_final`), page-policy conflict
(`page_policy_region_policy_conflict`, `page_raster_missing`), blank output
(`final_output_blank_region/page`), parity/export/override
(`renderer_parity_failed`, `export_preflight_failed`,
`operator_override_invalid/unauthorized/unacknowledged`), the security invariant
(`signed_url_persisted`) and `composition_unscored`.

## 10. Operator overrides (`pdf-region-operator-override-v1`)

`validateOperatorOverride` + `applyOperatorOverride` gate manual intervention.
`authorized` and `trustedActorId` come from the **server context, never the
client body**. Precedence: a valid page-raster override > a valid region
final-output override > automatic. A region override can **never** override a
page raster-only final policy. `force-native` at `final-output` scope with
**unacknowledged** hard defects is rejected (`operator_override_unacknowledged`);
`force-source-crop` with no crop is rejected; an orphaned override (region id
changed) is rejected. Editor-only actions (`preview-native-reconstruction`,
`show-source-reference`) never change the final policy. Applying a valid override
stamps `decision.decidedBy: 'operator'` with the override id + timestamp for
audit.

## 11. Export preflight (fail-closed)

`buildExportPreflight` proves an export can proceed **before** it starts: a page
is ready only when every final crop asset is `ready`, the selected page raster is
ready, no region is blocked, and there is no unresolved overlap. A `missing` /
`expired` crop → `region_crop_asset_unavailable`; an `invalid` crop →
`region_crop_asset_invalid`. Any not-ready page → `ok: false` +
`export_preflight_failed`. It never emits a signed URL and never mutates inputs.

## 12. Composition report (`pdf-region-composition-report-v1`)

`buildRegionCompositionReport` aggregates bounded document counts for diagnostics:
region/native/source-crop/native-reference/hidden-semantic/page-fallback/blocked
counts, suppressed overlay + nested-crop counts, duplicate-source-pixel /
missing-visible / unresolved-overlap counts, crop-asset-availability and
composition-completeness ratios (`null` when undefined, `round4`, no NaN/Infinity),
mixed vs full-raster vs manual-review page counts, operator-override count,
hard-defect count and a `renderStrategyCounts` map. Counts only — no source text,
crop maps, font bytes or signed URLs.

## 13. Policy & plan hashing (deterministic, no timestamps/URLs)

`hashRegionPolicyInput` and `hashRenderPlan` produce stable `rpolh-`/`rplanh-`
FNV hashes over strategy/state/crop-sha/contract/defects/ownership only — never
over timestamps or URLs, so the hash is identical across monolithic / chunked /
recovered / cache-replayed runs and across surfaces (the editor-reference set is
excluded unless explicitly included), giving a stable cache/diff key.

## 14. Integration bridge

`regionOutputPolicyIntegration.ts` is the renderer-neutral facade:
`buildPageRegionPolicies` adapts every evidence source (chart/table/typography/
generic) into one region-policy list; `resolveHydratedPageComposition` runs
policies → ownership → render plan and returns the plan, its hash, the **durable**
crop paths a caller must hydrate, and the editor-reference region ids;
`mapOverlaysToRegions` maps template overlays to source regions in precedence
(explicit `sourceRegionId` → single explicit `sourceTypographyRunIds` → bounded
bbox centre match, ambiguous → `null`, never guessed). A **separate**
`HydratedRegionCropAssetV1` layer maps durable paths to ephemeral signed URLs at
runtime that are revoked by the caller and **never** enter template JSON.

## 15. Schema extension (additive, optional)

`page.meta.pdfImportRegionOutput` (version-literal `pdf-region-output-policy-v1`)
adds a bounded per-page region-composition summary + `manifestPath` +
`automaticPolicyHash` + `activeOverrideIds` + `complete` + `problems`. Every field
is optional; `page.meta` stays `.passthrough()`, so existing templates validate
unchanged. It never inlines source text, full crop maps, font bytes or signed
URLs; the page-level `pdfImport` policy remains authoritative for page-wide
raster.

## 16. E0 / E3 / E4 / E5 interoperability

E6 **composes** the specialized decisions and never weakens them: a `page-fallback`
region defers to E0 containment; E3 chart crops and E4 table crops **own** nested
text (an E5 run inside them is suppressed, not duplicated); adjacent prose,
captions and footnotes outside a crop are never suppressed; invalid E6 policy
degrades to page fallback rather than fabricating a native region. The 143 pure
E0+E3+E4+E5+E6 interop specs remain green together.

## 17. Chunk / cache parity

Region policies and hashes derive only from parent-global region ids, strategies,
crop shas, defects and ownership — no chunk-local paths or timestamps — so
monolithic / chunk / recovered-chunk / cache-replay produce identical composition
decisions and hashes. An incomplete composition never marks a page complete and
never weakens E0; pre-E6 templates stay legacy and cannot fabricate a verified
composition.

## 18. Security

No signed/data URL in any policy, plan, report or the schema summary (rejected as
`signed_url_persisted`); durable crop paths validated (absolute path / scheme /
`data:` / `..` traversal rejected); operator `authorized`+`actorId` taken only
from the trusted server context; overrides fail closed on unauthorized /
unacknowledged / orphaned input; report/summary carry bounded counts + codes, no
source text or financial values; ephemeral hydration URLs are runtime-only and
revoked by the caller.

## 19. Tests

**TypeScript (40, all green):** version constants; signed-URL + unknown-strategy
rejection; E3/E4/E5 adapters (crop/native/blocked, defect preservation,
missing-crop guard); generic policy (picture-with-crop, critical-no-crop
fallback, native-source-equivalent, plain text non-critical); ownership graph
(nested table→chart suppression, cycle, self-parent, adjacent independence,
explicit-outranks-bbox); render-plan precedence (raster-only suppresses all,
raster-missing, outermost-crop-renders/nested-suppressed, adjacent-both-render,
overlap→fail-closed, editor-reference-only-with-option + hash parity,
durable-paths-only, deterministic hash); suppression composition; export preflight
(ready + fail-closed on missing); operator overrides (unauthorized,
unacknowledged, no-crop, orphan, page-raster-wins, valid-apply); integration
bridge (buildPageRegionPolicies, resolveHydratedPageComposition, mapOverlays
ambiguity→null, composition report); and the **core invariant** (a critical
region with a crop renders exactly once, native overlay suppressed, no
`crop_and_native_both_visible`). All 143 E0+E3+E4+E5+E6 pure interop specs pass
together.

## 20. Acceptance thresholds (accepted composition)

per source region visible-representation count ∈ {0,1}; per required critical
region in accepted final output = 1; duplicate source pixels = 0;
crop-and-native-both-visible = 0; nested-crop-both-visible = 0; unresolved crop
overlaps = 0; unrendered critical regions = 0; ownership cycles / self-parent /
missing-owner = 0; every final crop asset ready at export; page raster-only final
policy never overridden by a region; no persisted signed URL. Otherwise → page
fallback (E0) or blocked + manual review.

## 21. Private-report operator acceptance checklist

Do not commit the private report or hard-code its text/page numbers. On the live
private report an operator confirms: no page renders a raster **and** duplicated
native text; a chart nested in a table shows the table crop once with no duplicate
chart; adjacent chart + table on one page both render once; every critical
picture/logo/vector without a crop falls back to the page raster (never blank);
`force native` on a page raster-only page is refused; export refuses to start when
a required crop asset is missing; verified-native tables/text stay editable with
the source crop available only as an editor reference; and document-level:
duplicate-source-pixel count = 0, missing-visible-region count = 0,
unresolved-overlap count = 0, composition hard-defect count = 0 on accepted pages,
cache replay identical.

## 22. Deployment scope (NOT performed)

A later controlled deploy would wire the render plan into the concrete renderers
(HTML / jsPDF / PPTX / QA-capture / image-preloader) behind the runtime-gated
composition adapter, and the hydration layer into `get_artifacts` signing. **No
migration** (the region summary is additive template JSON; crops reuse the E3/E4/E5
private artifact paths). No cache-fingerprint change here (the E10 component list
is handed off below). No Edge Function or sidecar change.

## 23. Rollback

E6 is additive and gated: absent/invalid `pdfImportRegionOutput` leaves templates
valid (all fields optional) and rendering unchanged; the pure module is dormant
until the renderer wiring ships. Reverting the schema field leaves existing
templates valid; reverting the module drops the composition layer without
touching E0/E1/E3/E4/E5.

## 24. Future handoffs

- **E7 — Quality Gate V2:** consume `hardDefectCount` + the composition-completeness
  ratio + `source_region_not_rendered` / `duplicate_source_pixels` as global
  page/document quality inputs.
- **Renderer wiring:** HTML/jsPDF/PPTX/QA-capture consume `PdfRegionRenderPlanV1`
  through the runtime-gated composition adapter (the anti-duplication guarantee
  becomes enforced at paint time).
- **E10 — Routing & cache:** the cache fingerprint must include
  `pdf-region-output-policy-v1`, `pdf-region-render-plan-v1`,
  `pdf-region-ownership-v1` and the approved-override-catalogue version.

## 25. Known limitations (not hidden)

- **Renderer wiring is not in this package.** E6 ships the pure composition
  contract + adapters + integration bridge + schema; the concrete suppression at
  paint time (HTML/jsPDF/PPTX/QA-capture) and the `get_artifacts` hydration
  signing are runtime-gated adapters, delivered like E4's alternate conversions
  and E5's export-parity adapter. The invariant is fully proven at the plan level
  and enforced the moment a renderer consumes the plan.
- **bbox containment fallback** uses a 1px tolerance and a >0.25 minimum-area
  overlap threshold for the material-overlap conflict; explicit scene-graph
  relationships (E1) are preferred and unaffected by these bounds.
- 8 pre-existing tsc errors on `main` (`stepUp.ts` missing dependency, 5 latent
  `chartPreservation.pure.ts`, 2 in `src/components/reports/`) are unrelated to E6
  and left untouched — E6 adds **zero** new tsc errors.

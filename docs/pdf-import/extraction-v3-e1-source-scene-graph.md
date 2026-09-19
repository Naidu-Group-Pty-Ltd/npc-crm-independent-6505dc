# E1 — Source Scene Graph V2 & Page Artifact Contract V3

**PDF Extraction V3 · Package E1 — the authoritative source-region evidence layer.**

## Purpose

E1 builds **one immutable, provider-neutral, versioned source representation** of
every relevant visual and semantic region of a PDF page — the **Source Scene
Graph V2**. Downstream packages answer deterministically: what source regions
exist, where they are (top-left PDF points), whether each critical visual region
has an exact source crop, what text / numeric / punctuation / table / chart
evidence each carries, and which provider produced it.

E1 does **not** decide native-vs-raster output (that is E0/E6), does not repair
charts or tables (E3/E4), and does not invent any value. It creates the evidence
that E3 (Chart Preservation), E4 (Table Arbitration), E5 (Typography/Unicode),
E6 (region output), E7 (Quality Gate V2), E9 (multi-engine) and E10 (Plan V3)
consume.

## Source ↔ candidate separation

The scene graph is derived **only** from the immutable source (Docling document +
PyMuPDF evidence + the original PDF render). It never reads the candidate
`ReportTemplate`, CDIR reconstruction, the visual-quality score, a page-output
decision, an operator override, or a signed URL. Source truth and candidate
output stay strictly separate.

## Contract versions

| Version | Meaning |
|---|---|
| `source-scene-graph-v2` | document + page scene contract |
| `source-region-v2` | per-region contract |
| `pdf-page-artifact-contract-v3` | per-page artifact manifest (additive over V2) |
| `source-table-topology-v2` | table cell/topology evidence |
| `source-chart-metadata-v2` | chart evidence (conservative) |
| `source-foreground-summary-v1` | bounded occupancy evidence |
| `provider-region-evidence-v1` | provider provenance per region |

The existing `pdf-page-artifact-contract-v2` / `per-page-docling-v1` remain valid
and usable; V3 is **additive** and never reinterprets them.

## Where it lives (one canonical implementation, no drift)

| Concern | Module |
|---|---|
| Sidecar producer (pure, no model init on import) | `pdf-parse-service/source_scene_graph.py` |
| Canonical TS types + FNV-1a ID + normalisation + validator | `supabase/functions/_shared/sourceSceneGraphV2.pure.ts` |
| Canonical V3 manifest validator | `supabase/functions/_shared/pageArtifactContractV3.pure.ts` |
| Frontend entry points (thin re-exports) | `src/lib/reportTemplate/pdfImport/sourceSceneGraphV2.pure.ts`, `pageArtifactContractV3.pure.ts` |
| E0 evidence preference | `src/lib/reportTemplate/pdfImport/criticalVisualContainmentAdapters.ts` |
| Lazy per-page loader | `src/lib/reportTemplate/pdfImport/sourceScenePageLoader.ts` |
| Sidecar assembly + upload | `pdf-parse-service/app.py` (`_build_and_upload_source_scene_artifacts`) |
| Parent-global chunk copy | `supabase/functions/pdf-parse-chunk-callback/index.ts` |
| Lazy signed delivery | `supabase/functions/template-import-pdf/index.ts` (`get_artifacts`) |

The Python producer and the TypeScript consumer agree **ID-for-ID**: a portable
FNV-1a-32 hash (pinned by `test_source_scene_graph.py::test_fnv_known_value` and
`sourceSceneGraphV2.pure.spec.ts`) guarantees both runtimes derive byte-identical
region IDs.

## Coordinate system

All persisted coordinates are **PDF points, top-left origin, x→right, y→down**.
`normalize_bbox` (Python) / `normalizeBBox` (TS) convert Docling `TOPLEFT` and
`BOTTOMLEFT` bboxes and PyMuPDF rects into that space, clamp to the page (an
overshoot is recorded as `bbox_exceeds_page_clamped`), and reject fully off-page
or zero-area rects. Rotation is explicit (`geometry.rotation ∈ {0,90,180,270}`).

## Deterministic region identity

```
src-p{page:04d}-{abbrev}-{ordinal:04d}-{fnv8}
```

The canonical hash key is `"{globalPage}|{type}|{x}|{y}|{w}|{h}|{ordinal}"` where
the bbox is rounded to **0.01 pt** and `ordinal` is the deterministic
per-(page,type) index after a canonical sort (`y, x, height, width, type`). The
key uses the **parent-global** page number and **never** a Docling `self_ref`
(which is document-position-dependent and would differ between a monolithic parse
and a chunk), a timestamp, upload order, signed URL, DB id or random value. The
same source page therefore yields identical region IDs whether parsed
monolithically or as a chunk-local page later rebased.

## Region types & evidence

`text · table · chart · picture · logo · vector-cluster · background · unknown-visual`

* **Tables** — one region each (never merged), with `source-table-topology-v2`:
  zero-based rows/cols, header flags, merged-cell spans kept inside bounds,
  merged text on the anchor cell only, numeric tokens on the correct source cell,
  deterministic cell order.
* **Pictures / charts / logos** — a picture is a **chart** only on explicit
  classifier evidence or a strong analytical caption/title **corroborated** by
  numeric labels (one weak keyword never classifies). A chart is `crop_only`
  under the current engine — expected and honest; series extraction arrives in
  E3. Logos are classified conservatively.
* **Vector clusters** — only a bounded cluster of ≥14 paths with nearby numeric
  labels and no covering picture/chart crop. Borders and rules are never flagged.
* **Text** — block-level regions referencing span evidence; not duplicated into
  a huge inline payload.
* **Spans** (`pages/page-NNN/source-spans.json`) — raw + NFC Unicode (punctuation
  preserved, never lossy), font, size, weight/italic, colour, reading order,
  numeric + punctuation tokens, and whether the raw text contained a glyph
  placeholder. Immutable source evidence — never the sanitised candidate display
  text. Glyph advances are recorded as null when the engine does not provide them
  (never fabricated).
* **Numeric tokens** preserve the source representation only (currency, range,
  percentage, measurement/unit) — never a calculated or inferred value.
* **Foreground** (`source-foreground-summary-v1`) — bounded ratio, non-white
  bounds, a small tile-occupancy grid and edge density; never a raw bitmap.

## Source crops

Every critical visual region (`table · chart · picture · logo · vector-cluster`)
gets an **exact source crop rendered from the original PDF** (not the
reconstruction) at `DOCLING_SOURCE_SCENE_CROP_DPI` (default 300), with a
deterministic 2 pt padding clamped to the page. Crops are RGB PNG, hashed with
**SHA-256** over the exact uploaded bytes, and stored at a durable, path-safe
object path derived from the region ID:

```
{jobId}/pages/page-NNN/regions/{regionId}.png
```

A zero-area crop is rejected; an implausibly blank critical crop is flagged
(`crop_appears_blank`) and the region is not `complete`. A crop path is **never**
a data: or signed https URL — those are rejected by `is_safe_artifact_path`. Crop
DPI is dedicated to critical regions; the full-page raster keeps its current DPI.

## Artifact tree (additive over V2)

```
{jobId}/
  source-scene.json            # compact document scene (page scenes + regionIds)
  pages-manifest.json          # V2 fields + V3: regions/spans/foreground paths,
                               #   region_crop_paths, counts, contract version
  pages/page-001/
    docling.json blocks.json ocr.json tables.json pictures.json vectors.json summary.json   # V2 (unchanged)
    source.png                 # (page raster, existing)
    source-spans.json          # E1
    regions.json               # E1
    foreground.json            # E1
    regions/
      src-p0001-chrt-0001-<fnv8>.png   # E1 exact source crops
```

Nothing V2 is renamed or removed.

## Page Artifact Contract V3 — preferred vs partial

A parent manifest is validated by `validatePageArtifactContractV3`. It becomes
the **preferred** authoritative source only when it is a complete, self-consistent
V3: contract version present, continuous + unique page coverage, every page has a
`regions_path`, unique region IDs, every critical region has a crop, and every
durable path lives under the job prefix. A partial or inconsistent V3 is retained
for diagnostics but **never preferred** — the reader falls back to V2 / E0-safe
behaviour. States: `valid_v3 · legacy_v2 · unknown_version · invalid_v3`.

## Monolithic / chunk parity

Region IDs are parent-global and chunk-independent by construction (see above; a
monolithic page 21 and a chunk-local page 1 rebased to 21 produce identical IDs —
proven by `test_7_chunk_local_numbering_does_not_affect_parent_ids`). During chunk
finalization (`pdf-parse-chunk-callback`) the per-page V3 artifacts are copied to
parent-global paths, region crops are re-homed to `{jobId}/pages/page-NNN/regions/`
and `regions.json` is rewritten so no internal `sourceCrop.path` points at a
soon-deleted chunk-local path. The merged manifest is promoted to V3 only when
every chunk produced a scene graph.

## Cache replay

The parse cache reuses parse artifacts. A **V2-only** cache entry validates as
`legacy_v2` and is never fabricated into V3 — the reader uses V2 + E0 fallback. A
fresh parse produces V3. Because the frontend always re-maps and re-runs the gate
+ E0 containment at finalization, a pre-E1 cache entry can never be returned as a
completed V3 import without the V3 tree actually existing.

## Lazy signed delivery

`get_artifacts` signs V3 artifacts **lazily** — only the requested
`pageNumbers` / `regionIds` / `kinds` (`scene · regions · source_spans ·
foreground · source · region_crop`) — and **only** paths present in the trusted
manifest, capped at 300 objects per call. A client-supplied path is never signed;
signed URLs are short-lived and never persisted. Legacy V2 imports return an empty
map + a `legacy` state. The frontend loads one page at a time via
`sourceScenePageLoader` — an 80-page import never eagerly loads every page/crop.

## E0 integration (containment never weakened)

`chooseSourceCriticalEvidence` prefers a **valid** V3 scene that actually carries
regions; a missing, invalid, unknown-version or region-less V3 falls back to the
legacy Docling adapter. `invalid_v3 → native allowed` is impossible — an invalid
V3 uses legacy evidence / safe fallback / manual review. E0's safe defaults
(`complex/chart/unverifiedTable native = false`), hard-defect vetoes, durable
raster guarantee, fail-closed-for-native behaviour and diagnostics are unchanged.

## E2 integration contract

E2 (Docling vNext) runs in a separate branch and must emit, per page, provider-
neutral evidence the V3 contract can consume **without depending on
Docling-version-specific field names or Pydantic classes**:

* page geometry (width/height points, rotation);
* text items with raw Unicode + bbox + font hints + reading order;
* tables with rows/cols/cells (offsets, spans, header flags, cell text/bbox);
* pictures with bbox + optional classification + caption + optional image uri;
* chart extraction metadata when available (else `crop_only`);
* vector drawings with bbox + path counts;
* provider references, confidence, engine/model versions.

Feed that into `build_page_regions` / `build_source_spans` via a provider adapter.
`pageArtifactContractV3.pure.spec.ts` includes a generated **Docling vNext /
Document-AI** fixture proving a different engine's manifest still validates as V3.
E2 code must **not** be merged into the E1 branch.

## Security & privacy

All V3 artifacts are private. No signed URL is persisted in any template, scene,
manifest, DB row or import meta; no raw source text, crop bytes or base64 image
data appears in logs or persisted manifests; no external URL is accepted as a
durable path. Signed delivery is authenticated and scope-checked, and every signed
path is derived from stored trusted metadata, not from the client. `problems`
carry IDs / counts / codes / bounded messages only.

## Limits (bounded manifests)

`MAX_REGIONS_PER_PAGE=400`, `MAX_SPANS_PER_PAGE=6000`, `MAX_CROPS_PER_PAGE=160`,
`MAX_TILE_GRID=16`, signed-object cap 300/call. Hitting a limit records a
structured problem and marks the scene incomplete (E0 still protects the page) —
critical regions are never silently truncated, and the document scene never
inlines all source text.

## Operator private-report acceptance checklist

Do **not** commit the client PDF or any source crop. Run the private 13-page
report through the normal application and confirm:

* Page 5 — property / cost / turnkey structures are **separate** table regions
  with distinct IDs and crops; values stay with their source cells; not merged.
* Pages 7–10 — every major chart is a chart/critical-picture region with a crop;
  chart labels relate as children/labels but do not replace the chart.
* Page 9 — the comparable-sales table is one complete source table region (all
  rows in topology); the rental chart is a separate chart region + crop.
* Page 11 — the projection table topology has the correct rows/cols; later-year
  rows are present in source evidence.
* Page 12 — source spans cover the whole data-sources section; candidate output
  does not alter source evidence.
* Document — 13 V3 page entries, coverage 1–13, no duplicate region IDs, all
  crop-required regions have crops, parent V3 manifest complete, E0 still
  protects final output, and **no signed URL persists** in any manifest/template.

This is an artifact-contract acceptance test — E1 does not make charts/tables
natively editable.

## Deployment scope (NOT deployed in E1)

Later deploys (out of scope here): the sidecar container image (must `COPY
source_scene_graph.py` — enforced in the Dockerfile with a build-time
`import source_scene_graph`), and the `pdf-parse-chunk-callback` +
`template-import-pdf` Edge Functions. No migration is required.

## Rollback

Set `DOCLING_ENABLE_SOURCE_SCENE_GRAPH=false` on the sidecar to disable the V3
pass — the pipeline becomes byte-identical to pre-E1 (manifests stay V2, E0 uses
legacy evidence). Or revert the E1 commit. No migration, no destructive change.

## Migration decision

**No migration.** V3 rides entirely on existing JSON manifests + storage +
`result_payload`; `template_imports.meta` and `pdf_import_jobs.result_payload`
already carry the manifest pointers. No new column is required.

# Lane Policy V2 (`extractor-lane-policy-v2`) — PDF-import sidecar

G1 replaced the sidecar's partially-implicit extraction-lane behaviour with a
single, explicit, versioned policy that is applied **identically** by every
parse path (synchronous `/parse`, async monolithic `/parse`, `/parse-chunk`),
reported by `/capabilities`, and used as the converter cache key.

The pure policy lives in [`lane_policy.py`](./lane_policy.py) (no Docling import,
unit-tested in [`test_lane_policy.py`](./test_lane_policy.py)). `app.py` builds a
`GlobalCapabilities` from its environment and calls `resolve_execution_policy`
from each parse path via the `_resolve_policy` helper, so two paths can never
resolve the same lane differently.

## Concepts

* **Lane intent** — what a lane *wants*. `INHERIT` means "use the globally
  configured default" (used by the backwards-compatible `unplanned` lane).
* **Global capability ceiling** — a lane can **never enable** a feature the
  process has globally disabled: `effective = intent AND global_capability`.
* **`EffectiveLanePolicy`** — the normalized, frozen result for one request.
* **`ConverterProfile`** — the subset of the policy that changes Docling's
  `PdfPipelineOptions`. It is the **complete converter cache key**.

## Lane matrix (effective with all global capabilities enabled)

| lane | force_mode | force_raster | raster_dpi | do_ocr | force_full_page_ocr | do_table_structure | table_mode | picture_desc | picture_class | formula | code | doctags | markdown | fitz | gen_pics | memory |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `unplanned` | – | no | – | yes | yes* | yes | ACCURATE | default | default | default | default | yes | yes | default | yes | standard |
| `fast_native` | – | no | – | **no** | no | yes | **FAST** | no | no | no | no | **no** | **no** | yes | yes | fast |
| `accurate_table` | – | yes | 144 | yes | no | yes | ACCURATE | no | no | **yes** | no | yes | yes | yes | yes | standard |
| `ocr_scanned` | – | yes | 144 | yes | **yes** | yes | ACCURATE | no | no | no | no | yes | yes | no | yes | heavy |
| `design_heavy` | – | yes | **200** | yes | no | yes | ACCURATE | **yes** | **yes** | yes | no | yes | yes | yes | yes | heavy |
| `pixel_raster_only` | **pixel_perfect** | yes | 200 | no | no | **no** | FAST | no | no | no | no | no | no | no | **no** | raster_only |

\* `unplanned` inherits the global force-full-page-OCR default. "default" cells
inherit the corresponding global capability.

## Precedence

1. **Forced lane requirements are authoritative** — `ocr_scanned` forces
   full-page OCR; `pixel_raster_only` forces pixel-perfect / raster-only.
2. A request may **disable** an optional output/enrichment the lane allows
   (`enable_picture_description=false`, `include_doctags=false`,
   `include_markdown=false`).
3. A request may **not enable** a feature the lane forbids — e.g.
   `enable_picture_description=true` does **not** enable it in `fast_native`.
4. **Global capability flags are a hard ceiling** — a lane cannot enable a
   globally-disabled feature. This wins even over rule 1 (no OCR globally → no
   forced full-page OCR).
5. Unknown lane values normalize to `unplanned` (`lane_known=false`).
6. Hyphen/underscore + case spellings normalize consistently.
7. Policy objects are frozen; `LANE_PROFILES` is never mutated.

**Raster DPI** resolves as: explicit request → lane floor → process default
(`DOCLING_RASTER_DPI`) → mode fallback (200 for pixel, else 144). The lane's DPI
is a **minimum**, so a weaker dispatcher default can never override a stronger
lane policy.

## Converter cache key (`ConverterProfile`)

Every Docling-`PdfPipelineOptions`-affecting field is in the key:
`do_ocr`, `force_full_page_ocr`, `do_table_structure`, `table_mode`,
`use_picture_description`, `do_picture_classification`, `formula_enrichment`,
`code_enrichment`, `generate_picture_images`, `images_scale`.

Non-converter policy fields (`include_doctags`, `include_markdown`,
`use_fitz_layers`, raster/mode/memory) are **excluded** so the cache stays
bounded to the small set of real pipeline variants — but they are carried in the
`EffectiveLanePolicy` and applied in post-processing. Two profiles that differ in
any converter field never share a converter; identical profiles reuse one.

## Prewarm

Startup prewarm builds/invokes the **`unplanned`** (default) converter profile
only — it does not prewarm every heavy variant. Prewarm failure is non-fatal and
`/healthz` readiness does not depend on it.

## Capabilities

`/capabilities` reports `lane_policy_version`, `global_capabilities` (the
ceilings), `lanes_effective` (each lane's post-ceiling policy) vs `lanes_intent`
(raw), `converter_profile_fields`, and the currently-built `converter_variants`
with their per-option `support` map (whether a best-effort `_safe_set` took
effect — a feature is never reported active when Docling rejected it). No
environment-variable values, tokens, secrets, or signed URLs are exposed.

## Compatibility / configuration

* Backwards compatible: a missing/unknown lane resolves to `unplanned`, whose
  effective policy equals the previous global-default behaviour.
* No new environment variables are introduced; existing `DOCLING_*` /
  `ENABLE_*` env flags now act as the global capability ceilings + defaults.
* No CPU/memory recommendation change — the per-lane `memory_profile` is a label
  for operators/diagnostics; it does not change Cloud Run sizing.
* The dispatcher's `LANE_POLICY_VERSION` mirror is bumped to
  `extractor-lane-policy-v2` so the C1 cache fingerprint never reuses a
  v1-semantics artifact for a v2 request. **Deploy the sidecar + dispatcher
  together** (G3).

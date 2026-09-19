# E2 — Docling vNext Compatibility

**PDF Extraction V3 · Package E2 — isolated Docling vNext sidecar candidate.**

A code-only + local-build compatibility program: a fully isolated Docling vNext
candidate that can *eventually* be deployed beside the current production sidecar
(via a later E10 routing/cache cutover) **without changing the current production
runtime**. Nothing here is deployed; no production dependency, Dockerfile, cache
fingerprint, migration or Edge Function changes.

## Starting baseline (production, unchanged)

Python 3.11 · `docling==2.14.0`, `docling-core==2.82.0`, `docling-ibm-models==3.13.3`,
`docling-parse==3.4.0`, `pypdfium2==4.30.0`, `PyMuPDF==1.24.14`, EasyOCR · Lane
Policy V2 · Operational Metrics V1 · one-worker Uvicorn · build-time model
predownload · explicit runtime-module copy + compile/import checks. Entrypoint
`app:app`, runtime profile `legacy`. `../requirements.txt` and `../Dockerfile`
remain reproducible.

## Official version research (PyPI, verified at execution)

- **Latest stable: Docling 2.113.0** (verified via `pypi.org/pypi/docling/json`;
  `requires-python >=3.10,<4.0`). Previous stable: 2.112.0.
- 2.113.0 is a **thin meta-package** delegating to `docling-slim[standard]==2.113.0`
  with extras: `easyocr`, `rapidocr`, `onnxruntime`, `vlm`, `remote-serving`,
  `tesserocr`, `ocrmac`, `asr`, `htmlrender`, `xbrl`.
- `docling-slim[standard]` requires `docling-core>=2.86,<3`, `docling-parse>=7,<8`,
  `docling-ibm-models>=3.13,<4`, `pypdfium2>=4.30(!=4.30.1),<6`, `torch>=2.2.2,<3`,
  `transformers>=4.42,<6`, plus numpy/pillow/beautifulsoup4/accelerate/…
- **Breaking changes since 2.14** (see `vnext/capability-baseline.json`):
  meta-package split; `docling-parse` major bump 3.4.0 → 7.8.1; picture
  classification moved from `PictureItem.classification` into
  `PictureItem.annotations` (`PictureClassificationData`); chart output is
  first-class typed picture annotations (`PictureBarChartData`/…); model-download
  API must be re-verified. **Backward-compatible:** the document schema field
  names E1/E0 depend on (`TableCell.start_row_offset_idx`, `col_span`,
  `column_header`, `ProvenanceItem`, `self_ref`, `image`) are all still present in
  the installed `docling-core==2.87.1` (verified by live introspection).

## Selected version

- **Docling 2.113.0**, **Python 3.11** (production parity; also within docling's
  `<3.13` support). Reason: latest official stable, installs reproducibly (`uv lock`
  resolved 173 packages), document schema stays backward-compatible, no unreviewed
  remote code required. No fallback candidate was needed.

## Dependency profile & lock

Isolated under `pdf-parse-service/vnext/` (`pyproject.toml` + `uv.lock`, **173
packages, hashed**, `uv.lock` sha256 in `capability-baseline.json`). Key locked
versions: docling 2.113.0 / docling-core 2.87.1 / docling-parse 7.8.1 /
docling-ibm-models 3.13.3 / pypdfium2 5.12.1 / PyMuPDF 1.24.14 / torch 2.13.0 /
transformers 5.8.1 / easyocr 1.7.2. Groups: default/standard (CPU EasyOCR),
`rapidocr`, `vlm` (local only), dev. **Production `requirements.txt` untouched.**

## Runtime architecture

`DOCLING_RUNTIME_PROFILE` = `legacy` (default, absent) | `vnext`. A provider-neutral
`DoclingRuntime` protocol (`docling_runtime_protocol.py`) with two implementations:

- `docling_runtime_legacy.py` — identity/capabilities for prod 2.14 (conversion
  stays in `app.py`).
- `docling_runtime_vnext.py` — vNext converter build + convert + document export.
  **docling is imported lazily**, so every pure module imports in CI without torch.

`select_docling_runtime` chooses by env only — never a request field. A failed
vNext init **raises** (`require_docling`); it never silently runs legacy while
reporting vNext. The candidate entrypoint `app_vnext.py` reuses the production
auth middleware, request models, callback/storage/per-page-artifact helpers and
Operational Metrics V1, and routes conversion through the vNext runtime.

## Build targets

`Dockerfile.vnext`: `vnext-cpu-standard` (default), `vnext-cpu-threaded`,
`vnext-vlm` (local Transformers/GraniteDocling, **no vLLM, no remote serving**).
Deterministic `uv sync --locked` from the committed lock (no runtime resolver),
build-time model download (build fails if a required model is missing), explicit
runtime-module `COPY` list + `py_compile` + `import` checks (prevents the prior
"module not packaged" regression), non-root user, health via `/`.

## Capability registry

`docling_capabilities.py` distinguishes **apiPresent / configured / modelConfigured
/ modelReady / effective** per feature. `introspect_installed()` reads the installed
package's Pydantic `model_fields` (the authority, not docs). A feature is
`effective` only when apiPresent ∧ configured ∧ modelReady — `chart_extraction=true`
/ `formula_capable=true` are never claimed when the model does not load. `/capabilities`
adds a namespaced `docling_vnext` section; production fields are never removed.

Redacted example:
```json
{ "docling_vnext": { "version": "docling-vnext-capabilities-v1", "runtime_profile": "vnext",
  "features": { "chart_extraction": { "apiPresent": true, "configured": true,
    "modelReady": false, "effective": false, "requiredExtras": ["vlm"] } } } }
```

## Lane mapping (Lane Policy V2 intent preserved)

`resolve_vnext_converter_profile(effective_lane_policy, capabilities, options)` maps
each lane onto vNext options, gated by a hard capability ceiling (a feature only
turns on when the build allows it **and** the model is ready):
`fast_native` (OCR off, fast tables, backend text) · `accurate_table` (accurate
tables + two cell-matching candidates for E4) · `ocr_scanned` (full-page OCR +
accurate tables) · `design_heavy` (picture images/classification, charts when
model-ready, chart2csv, page images) · `pixel_raster_only` (minimal; source raster
authoritative) · `unplanned` (conservative; cheap prewarm). Lane resolution stays
in `lane_policy.py`.

## Converter profile & cache

`VNextConverterProfile` is frozen/hashable/JSON-safe with every converter-affecting
field (pipeline family, device, OCR engine/langs/full-page, table mode + cell
matching, picture/chart/formula/code toggles + models, image generation + scale,
backend text, threaded batch/queue knobs, VLM knobs, security invariants).
`converter_key` is a SHA-256 over the canonical profile — proven by 47 field
tests to change on every converter-affecting field and stay stable otherwise.

## Table & chart evidence (E4/E3 hand-off, not decided here)

Table: `accurate_cell_matching_on` / `accurate_cell_matching_off` / `fast_table`
candidates are exposed with distinct converter keys — **E2 chooses no winner**;
cell associations/spans/header flags stay inspectable. Chart: typed picture
annotations normalized as provider evidence (`crop_only` under the current models);
a chart-extraction failure never removes the source picture/crop; chart CSV is
never treated as authoritative financial truth.

## Source fidelity & E0

Source PDF crops (E1) remain authoritative; vNext provider images are evidence
only. A richer vNext result may improve extraction evidence but may **not** bypass
`critical-visual-containment-v1`, page-output policy, visual-quality decisions,
source-raster fallback, or manual-review requirements.

## Security

`enable_remote_services=false`, `allow_external_plugins=false`,
`trust_remote_code=false` on every build and every lane — carried on the profile
identity and unraisable by a parse request (a request cannot choose a remote URL,
model ID, plugin path, or trust_remote_code). Verified by the E2 security tests.
No token/PDF/source-text/model-path is logged or returned to the client.

## What was executed vs. not (honest status)

| Step | Status |
|---|---|
| PyPI version + dependency research | **executed** (real metadata) |
| `uv lock` (173 pkgs, hashed) | **executed** — reproducible |
| `docling-core==2.87.1` schema introspection | **executed** (isolated venv) |
| Pure adapter/profile/capability/security tests (75) | **executed** — all pass |
| Fixture generation + PDF validity (pypdfium2) | **executed** — 20 valid PDFs |
| `uv sync` full graph (torch etc.) + live conversion | **NOT executed** in this planning env (multi-GB, no GPU) — run in the vnext image |
| `docker build` of `Dockerfile.vnext` | **NOT executed** in this session — build in CI/operator env |
| Baseline-vs-vNext conversion comparison | **NOT executed** (requires the vnext image); harness ready |
| Cold-start / memory / 25–80-page perf | **NOT executed** (requires the image) |

Nothing is claimed to have passed that did not run.

## Known regressions / degradations to contain

- `docling-parse 3.4.0 → 7.8.1` is a major upstream bump — validate parsing parity
  on the fixtures in the vnext image before any canary.
- Picture classification / chart annotations changed shape — handled by the
  adapter's back-fill; verify against a real conversion.
- Chart/formula/VLM models are `modelReady:false` until the image downloads them.

## Deployment scope (later; **not applied**)

Not applied — for a later Google Cloud canary (E10 gate): CPU-standard candidate
(e.g. 2 vCPU / 8 GiB), optional threaded profile for large jobs, optional GPU/vLLM
profile, model storage sizing, expected startup. E2 exposes engine/model identity
for E10's cache-fingerprint + routing work; the production cache fingerprint is
**not** changed here.

## Rollback

The candidate is isolated: to abandon it, delete `vnext/`, `Dockerfile.vnext`,
`app_vnext.py` and the `docling_runtime_*`/`docling_vnext_*`/`docling_capabilities`
modules, or simply never build `Dockerfile.vnext`. Production is unaffected because
`DOCLING_RUNTIME_PROFILE` defaults to `legacy` and the production image never
references any vNext file.

## Stop conditions checked (none triggered)

E0 present; latest stable installs reproducibly; no unreviewed remote code
required; document/callback/metrics contracts stay backward-compatible; no page/
chunk numbering change; no private-API dependency; runtime profile explicit with
no silent fallback; capability truth-levels distinct; source crop authoritative;
no remote provider; E0 not weakened; no cache-version change; no migration; no
client PDF/secret committed; every runtime module packaged explicitly; engine/
model profile always identified.

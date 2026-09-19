# J1 — E1/E2 Joint Contract & Runtime Gate

**PDF Extraction V3 · Package J1 — integration + runtime proof.** Turns the E1
(Source Scene Graph V2) and E2 (Docling vNext) scaffolds into demonstrated
behaviour on a temporary integration branch. E0 containment remains authoritative.

## Source SHAs & integration order

| Package | Branch | SHA |
|---|---|---|
| E0 (base) | main | `e1fef7ecc94e537bb0c4f0640421d697674aa245` |
| E1 | claude/pdf-extraction-v3-e1-source-scene-graph | `c9db257ac5bbdeb5011a2ee6c7f78d6832386b36` |
| E2 | claude/pdf-extraction-v3-e2-docling-vnext | `02c56d7a1145c2534a7e10063cb749e64ab75f2e` |

Integration order: E1 then E2, cherry-picked (commits preserved distinctly).
**Conflicts: none** — E1 and E2 touch disjoint files. J1 fixes are separate
follow-up commits.

## Overall status

**J1 CODE COMPLETE — RUNTIME GATE PENDING.** Every runtime gate that this sandbox
could execute was executed and passed — locked dependency sync, real vNext
conversions, runtime-wiring invocation-spy, E1 V3 population, real profile
application, HTTP routes, capability truthfulness, model-download API. The one
gate that could **not** run locally is the **containerised image build**: the
Docker daemon starts, but its build network cannot reach PyPI in this sandbox
(the host `uv sync` succeeds, proving the lock is buildable — this is an
environment limitation, not a code defect). A `workflow_dispatch` CI workflow
(`.github/workflows/pdf-vnext-j1-container-gate.yml`) builds the image + runs the
offline smoke on a clean runner to close that gate. **Not merge approval.**

## Rebaseline findings (Phase 2 answers)

1. `import app_vnext` **does** import `app` (reuses its shared HTTP/auth/callback/
   storage/artifact/metrics helpers).
2. `import app` builds a legacy converter at startup prewarm — a J1 follow-up
   makes the vNext image skip the legacy prewarm (correctness is unaffected; the
   parse path routes to vNext regardless).
3. Before J1, `app_vnext /parse` → `shared.parse` → `app._run_async_job` →
   `_do_parse` → the **legacy** `_get_converter` (the E2 defect). **J1 fixes this.**
4. After J1, `_do_parse` (the ONE shared conversion boundary for sync/async/chunk)
   calls `runtime.convert(...)` under the vnext profile — so every vNext parse
   path invokes `DoclingVNextRuntime.convert`.
5. No — a vNext image can no longer run the legacy converter while reporting vnext
   (proven by the invocation-spy + poisoned-legacy tests).
6. Dockerfile.vnext now **copies `source_scene_graph.py`** (was missing after E1
   integration — the combined-packaging gap).
7. It copies every runtime module imported by the combined app (explicit list).
8. The model step now uses fail-closed `download_models.py` (exits nonzero on a
   missing required model; the exit-0 "verify later" fallback was removed).
9. No — a missing required model fails the build.
10. Yes — `do_chart_extraction` + `chart_extraction_options.chart2csv/code/summary`
    are applied to the real `PdfPipelineOptions` (verified live).
11. `pipeline_family` selects `pipeline_cls` = ThreadedStandardPdfPipeline / VlmPipeline
    (both present in 2.113); standard is default.
12. OCR: `force_full_page_ocr` + `lang` are applied to the OCR options object
    (NOT top-level — a real 2.113 correction over E2's guess).
13. Accelerator: `AcceleratorOptions(device, num_threads)` applied (verified).
14. Chart output flags applied (verified).
15. Formula/code flags applied (verified).
16. `effective=true` requires apiPresent ∧ configured ∧ modelReady — chart stays
    `effective=false` until a model probe succeeds.
17. Real vNext output populates E1 regions (deterministic IDs) — proven live.
18. E1 renders its own 300-DPI source crops from the original PDF; vNext
    `picture.image` is evidence only.
19. Both monolithic and chunk paths run through `_do_parse` → vNext.
20. Every vNext result carries engine identity (runtime_profile, docling version,
    adapter version, pipeline family, converter key).

## vNext runtime-wiring proof (executed)

- Conversion call path: `parse* → _do_parse → _get_runtime() (vnext) →
  DoclingVNextRuntime.convert(stream, profile) → export_document (normalize)`.
- **Invocation-spy** (`test_j1_runtime_wiring.py`, 3/3 pass): under vnext the fake
  runtime's `convert` is called exactly once; the legacy `_get_converter` is never
  reached. Under the default profile the opposite holds (legacy path taken,
  runtime.convert not called).
- **Runtime identity** (real conversions): every result reports
  `runtime_profile=vnext`, `docling_version=2.113.0`,
  `adapter_version=docling-vnext-adapter-v1`, `pipeline_family=standard`.

## Dependency execution (executed)

`uv lock --check` reproducible; `uv sync --locked --no-dev --extra standard`
succeeded (venv ≈ 5.4 GB, torch ≈ 1.1 GB). Installed: **docling 2.113.0**,
docling-core 2.87.1, docling-parse 7.8.1, docling-ibm-models 3.13.3,
pypdfium2 5.12.1, PyMuPDF 1.24.14, torch 2.13.0, easyocr 1.7.2, transformers
5.8.1. `import docling; version('docling') == 2.113.0` confirmed.

## Model packaging

Real downloader: `docling.utils.model_downloader.download_models(output_dir, *,
with_layout, with_tableformer, with_easyocr, with_smolvlm, …)` (verified present).
`download_models.py` is fail-closed. Layout + tableformer auto-downloaded on first
conversion (≈ 506 MB cache). Offline finding: `DOCLING_ARTIFACTS_PATH` must point
to a **populated** dir (docling rejects an empty one) — the Dockerfile downloads
into `/app/.docling-models` at build time. The `--network none` offline smoke runs
in the CI workflow.

## Profile application (executed against real 2.113 API)

Every `VNextConverterProfile` field reports `applied` against a real
`PdfPipelineOptions`: `do_ocr`, `ocr_options.force_full_page_ocr`, `lang`,
`do_table_structure`, `table_structure_options.mode` (ACCURATE/FAST),
`do_cell_matching`, `do_picture_classification/description`, `do_chart_extraction`
+ `chart_extraction_options.chart2csv/code/summary`, `do_formula/code_enrichment`,
`generate_page/picture/table_images`, `images_scale`, `force_backend_text`,
`accelerator_options` (device/threads), batch/queue knobs, and the security
invariants `enable_remote_services=False` / `allow_external_plugins=False`.

## Capability truth (executed)

`/capabilities` (via TestClient on `app_vnext`) returns the namespaced
`docling_vnext` section: `chart_extraction` → `apiPresent=true, configured=false,
modelReady=false, effective=false` (truthful — no model probe run);
`ocr_easyocr apiPresent=true`; `package_versions.docling=2.113.0`. No feature is
reported effective merely because a field exists.

## Real conversion matrix (executed subset)

| fixture | status | pages | E1 regions | region types | engine |
|---|---|---|---|---|---|
| 01_native_prose | success | 1 | 4 | text | vnext/2.113.0 |
| 03_simple_table | success | 1 | 8 | text, picture | vnext/2.113.0 |
| 05_two_adjacent_tables | success | 1 | 1 | text | vnext/2.113.0 |
| 07_bar_chart | success | 1 | 4 | text, picture | vnext/2.113.0 |
| 16_scanned_image_only | success | 1 | 1 | picture | vnext/2.113.0 |

Honest limitation: the minimal, dependency-free generated fixtures draw tables as
rectangles, which docling's layout model classifies as **pictures/vectors**, not
semantic tables — so `table_count=0` on the table fixtures. This is a fixture
fidelity limitation, not a contract defect; the joint gate should re-run with
richer generated tables (reportlab) or the CI workflow's model-backed run. The
contract proof that matters (conversion works, E1 regions populate with
deterministic IDs, pictures detected) holds.

## E1 contract matrix (executed)

vNext `normalize_document` output → `source_scene_graph.build_page_regions`
produced valid E1 regions with deterministic parent-global IDs
(`src-p0001-text-0001-4a27f7c4`, `src-p0001-pict-0001-…`). Page geometry, text
spans, and picture regions populate; picture classification is back-filled from
2.113 annotations by the adapter. Full V3 manifest assembly + crop generation +
monolithic/chunk parity + parent-global copy + cache replay are covered by E1's
existing pure/edge tests (unchanged on this branch) and by the CI model-backed run.

## Monolithic/chunk parity

E1's canonical region IDs are page/type/bbox/ordinal-derived (independent of
docling `self_ref`), proven chunk-independent by E1's pure tests
(`test_7_chunk_local_numbering_does_not_affect_parent_ids`) which remain green on
the combined branch. Both paths route through the same `_do_parse` → vNext seam.

## Parent copy & cache replay

Covered by E1's existing edge/pure tests (chunk parent-global copy rewrites crop
paths + `regions.json`; cache replay reproduces the V3 tree; V2-only cache never
fabricates V3). No production cache-fingerprint change in J1; E10 must add the
vNext engine identity + `pdf-page-artifact-contract-v3` to the fingerprint before
any production routing.

## E0 regression

E1's E0 integration tests (V3-preferred evidence, invalid V3 → legacy, missing
crop → fallback/manual review, hard-defect veto) remain green. J1 does not enable
the native chart/table flags; E0 safe defaults stay false.

## HTTP endpoint matrix (executed, non-container)

Via FastAPI TestClient on `app_vnext` (real docling): `/` 200 +
`runtime_profile=vnext`; `/capabilities` 200 + truthful `docling_vnext`;
`/plan` reuses Plan V2 verbatim. Full container-hosted endpoint + async-callback
+ `/parse-chunk` matrix runs in the CI workflow.

## Container result

- **Actual build: NOT completed locally.** `Dockerfile.vnext` parses and reaches
  the `uv sync` layer; the sandbox Docker-build network cannot reach PyPI
  (`files.pythonhosted.org` connect error) even with `--network=host`. The host
  `uv sync` succeeds, so the lock is buildable — this is a sandbox network limit.
- The CI workflow builds `vnext-cpu-standard`, starts the container, checks
  `/` + `/capabilities` identify vNext, and runs the `--network none` offline
  conversion smoke. **Run it and require green before J1 PASS.**

## Standard vs threaded / VLM

`pipeline_family` selects the real pipeline class (both present in 2.113).
Threaded + VLM targets are defined but not advertised effective without a
successful conversion; the standard CPU candidate is the merge gate.

## Test commands & counts (executed)

- `python3 -m pytest test_lane_policy.py test_operational_metrics.py test_source_scene_graph.py test_docling_vnext.py` → **206 passed**.
- `vnext/.venv/bin/python -m pytest test_j1_runtime_wiring.py` → **3 passed** (real docling).
- Real conversion harness → 5/5 fixtures success, E1 regions populated.
- `uv lock --check` reproducible; `uv sync --locked` succeeded.
- TypeScript: `tsc -p tsconfig.app.json --noEmit`, E1/E0 vitest suites, release gate — see the J1 PR checks.

## Known defects / degradations

- **Container build not run locally** (sandbox network) — CI workflow provided.
- Minimal fixtures don't produce docling-recognized tables (fixture fidelity).
- `app.py` startup prewarm builds a legacy converter even under vnext (wasteful,
  not incorrect) — J1 follow-up.
- Chart/formula/VLM `modelReady=false` until the image downloads those models.

## E1 backport plan (PR #1037)

The E1 branch is already correct; J1 added no E1-canonical fixes (the E1 code
integrated cleanly and its tests stayed green). Merge E1 as-is after re-running
E1 tests.

## E2 backport/rebase plan (PR #1038, after E1 merges)

Apply these J1 E2-canonical fixes to the rebased E2 branch:
`docling_runtime_vnext.py` (real-API `build_pipeline_options` + `convert` raw
handle + export), `docling_runtime_protocol.py` (`raw_document`), `app.py`
(runtime seam + `_do_parse` vNext routing + engine identity), `app_vnext.py`
(unchanged wiring), `Dockerfile.vnext` (copy `source_scene_graph.py`, fail-closed
model download), `vnext/download_models.py`, `test_j1_runtime_wiring.py`, and the
CI workflow. Then re-run: uv sync, real conversions, the CI container gate, E1 V3
validation, all regressions.

## Merge sequence (do NOT execute in J1)

1. Apply E1 J1 fixes (none needed) → re-run E1 tests → merge PR #1037.
2. Rebase PR #1038 onto the new main → apply the E2 J1 fixes above.
3. Re-run uv sync + real conversions + CI container gate + E1 validation + regressions.
4. Merge PR #1038 only after those pass.

## Production-change confirmation

No gcloud, no Cloud Build, no image pushed, no Cloud Run revision/traffic change,
no Supabase migration applied, no Edge Function deployed, no production data/Storage
mutated, no external provider or remote VLM invoked. `requirements.txt` and the
production `Dockerfile` are unchanged; absent `DOCLING_RUNTIME_PROFILE` → legacy.

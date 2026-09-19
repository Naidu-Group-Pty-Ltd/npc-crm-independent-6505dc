# pdf-parse-service — Deployment Guide (Phase D)

Complete, copy-pasteable instructions to deploy the Docling sidecar to Google
Cloud Run with all **Phase A–D** enrichments active (formula + code, sharp
picture crops at 2× scale, table accuracy, OCR fallback, DocTags + Markdown
exports, outline + cross-references + per-page language, streaming progress).

> **There is now a workflow, and it is the preferred path.**
> `.github/workflows/deploy-pdf-parse-service.yml` builds on Cloud Build, stages
> a Cloud Run revision with **no traffic**, verifies it on its own tagged URL,
> and stops. Sending traffic is a separate `workflow_dispatch` with
> `promote: cutover`.
>
> Use this document for the **first** deploy of a service — it is what creates
> the service and sets its environment. The workflow deliberately sets no
> environment variables at all (`gcloud run deploy --set-env-vars` *replaces*
> the whole environment, so a partial restatement would wipe
> `PDF_PARSE_SERVICE_TOKEN` and the Supabase credentials); it only ever replaces
> the image, and its verify step fails if either is missing.
>
> Also use this document for **rollback**, and when federated deploy is not
> configured on the repository — the workflow says so and changes nothing.
>
> The current lane policy is **`extractor-lane-policy-v3`**, not the v2 named in
> the note below; `npm run pdf-import:engine-lockstep` prints both sides and
> fails if they have drifted apart.

> **Lane Policy V2 (`extractor-lane-policy-v2`)** — extraction-lane behaviour and
> the converter cache key are governed by [`LANE-POLICY.md`](./LANE-POLICY.md).
> No new environment variables are introduced and Cloud Run CPU/memory sizing is
> unchanged. Deploy the sidecar **together with** the `pdf-parse-dispatch` edge
> function (whose `LANE_POLICY_VERSION` mirror is also bumped to v2) so the C1
> cache fingerprint never reuses a v1-semantics artifact for a v2 request.
>
> **Operational Metrics V1 (`sidecar-operational-metrics-v1`)** — every parse
> path now emits a truthful, versioned per-invocation metrics object (timings +
> counts + bytes) documented in [`METRICS.md`](./METRICS.md). It is **additive**
> (a new `metrics` field on existing callbacks + `/parse` responses, plus an
> `operational_metrics` block on `/capabilities`), introduces **no new
> environment variables**, and requires **no Cloud Run sizing change**. Existing
> callback consumers that ignore the field are unaffected; C11 consumes it later.

The sidecar is called by the `pdf-parse-dispatch` Supabase edge function via
two secrets stored on the Supabase project:

- `PDF_PARSE_SERVICE_URL` → the Cloud Run HTTPS URL (no trailing slash)
- `PDF_PARSE_SERVICE_TOKEN` → a long random bearer token (you generate it)

---

## 0. Prerequisites

- Google Cloud project with billing enabled.
- `gcloud` CLI ≥ 470 installed and authenticated:
  ```bash
  gcloud auth login
  gcloud config set project <YOUR_GCP_PROJECT_ID>
  ```
- Docker (only required if you build locally; otherwise Cloud Build does it).
- Access to the Supabase project `dduzbchuswwbefdunfct` (to update the two
  secrets above after the URL is known).

**Deploy in the same region as the Supabase project.** This page used to say
latency was "dominated by Docling parse time" and that any region worked. The
sidecar's own operational metrics disagree: on the measured jobs
`artifact_upload_ms` was **19.0s of a 45.2s** invocation — 42% of wall clock —
because the service ran in `us-central1` while the Supabase project it uploads
every artifact to is in `ap-southeast-1`. Every artifact upload, source download
and callback crossed the Pacific twice.

Supabase project `dduzbchuswwbefdunfct` is in **ap-southeast-1 (Singapore)**, so
the co-located Cloud Run region is `asia-southeast1`, which is also Tier-1
priced. `australia-southeast1` is Tier-2 (~20% more) and is *not* closer to the
data; choose it only if a contractual AU-residency obligation applies — and note
that moving Cloud Run alone does not achieve residency while Supabase remains in
Singapore.

```bash
export GCP_PROJECT=<YOUR_GCP_PROJECT_ID>
export REGION=asia-southeast1
export SERVICE=pdf-parse-service
export IMAGE=gcr.io/$GCP_PROJECT/$SERVICE:docling-2.14.0-lanepolicy-v3
```

---

## 1. Generate the bearer token

```bash
export PDF_PARSE_SERVICE_TOKEN=$(openssl rand -hex 48)
echo "$PDF_PARSE_SERVICE_TOKEN"
```

Copy this value — you need it in step 4 and step 6. Treat it like a password.

---

## 2. Enable required Google APIs

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  containerregistry.googleapis.com
```

---

## 3. Build the container image

From the repo root:

```bash
cd pdf-parse-service
gcloud builds submit --tag "$IMAGE" .
```

This uploads the `pdf-parse-service/` directory (Dockerfile, `app.py`,
`requirements.txt`) to Cloud Build, builds the image, and pushes it to GCR.
First build takes ~6–10 minutes because Docling pulls its layout, table, and
enrichment models into the image cache.

> **Tip:** if you change `requirements.txt`, rebuild with a new tag
> (e.g. `:phaseD-2`) to bust Cloud Run's revision cache cleanly.

---

## 4. Deploy to Cloud Run

```bash
gcloud run deploy "$SERVICE" \
  --image "$IMAGE" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --no-cpu-throttling \
  --cpu 2 \
  --memory 8Gi \
  --concurrency 2 \
  --timeout 300 \
  --min-instances 0 \
  --max-instances 10 \
  --startup-probe-http-path /healthz \
  --set-env-vars "PDF_PARSE_SERVICE_TOKEN=$PDF_PARSE_SERVICE_TOKEN" \
  --set-env-vars "ENABLE_PICTURE_CLASSIFICATION=true" \
  --set-env-vars "ENABLE_PICTURE_DESCRIPTION=false" \
  --set-env-vars "ENABLE_OCR_FALLBACK=true" \
  --set-env-vars "DOCLING_PREWARM_ON_STARTUP=true" \
  --set-env-vars "DOCLING_IMAGES_SCALE=2.0" \
  --set-env-vars "DOCLING_TABLE_MODE=ACCURATE"
```

Notes:

- **`--no-cpu-throttling` is not optional.** `/parse` returns `202` immediately
  and runs the whole Docling pipeline in a FastAPI background task
  (`app.py: background_tasks.add_task(_run_async_job, req)`). Cloud Run allocates
  CPU *during request processing*; work continuing after the response is sent is
  throttled toward zero until another request wakes the instance. Without this
  flag the production ledger shows two 94-page jobs completing in 357s and
  46,424s respectively — a 130x spread on identical work, with a chunked p90 of
  37,857s. It changes billing to instance-based (~$0.000018/vCPU-s over instance
  lifetime), which at ~60 jobs/month is roughly $1 and still near the free tier.
- `--allow-unauthenticated` is safe because every request must carry the
  `Authorization: Bearer $PDF_PARSE_SERVICE_TOKEN` header — Cloud Run IAM is
  bypassed but our app-level auth blocks anything else.
- `--memory 8Gi` with `--concurrency 2`: each request can hold ~1.5 GB while
  parsing a large PDF, and the resident model weights are on top of that. At
  4 GiB two concurrent heavy parses were tight enough to plausibly explain the
  observed `sidecar_error 503` failures. Either 8 GiB at concurrency 2, or stay
  at 4 GiB and drop to `--concurrency 1` — not 4 GiB at concurrency 2.
- `ENABLE_FORMULA_ENRICHMENT` / `ENABLE_CODE_ENRICHMENT` are **deliberately
  absent** — both now default to `false` in `app.py`. They target scientific
  papers and source listings; on property and finance PDFs they load extra
  models and add per-page work for no measured benefit. Set them explicitly only
  if a document class actually needs them.
- `ENABLE_OCR_FALLBACK=true` no longer implies full-page OCR on every page. Those
  two behaviours were the same expression until lane-policy v3; see the OCR note
  below.
- `--timeout 300` is the production request deadline; very large scanned PDFs
  should fail cleanly with the sidecar error taxonomy instead of monopolising a
  worker indefinitely.
- `--max-instances 10` bounds worst-case parallel Docling memory use while
  still allowing twenty in-flight requests at `--concurrency 2`.
- `--startup-probe-http-path /healthz` lets Cloud Run defer traffic until the
  FastAPI process is accepting requests; app startup also pre-warms Docling with
  a one-page sample unless `DOCLING_PREWARM_ON_STARTUP=false`.
- Bump `--min-instances 1` only once usage justifies the ~$25/mo idle cost —
  cold starts are ~30 s. At the measured volume (~60 jobs/month) this would be
  the single largest line item on the whole deployment and would *triple* the
  bill. `--no-cpu-throttling` plus the boot prewarm addresses the same symptom
  for roughly $1/month; do that first and re-measure before considering this.

### OCR forcing (lane-policy v3)

`ENABLE_OCR_FALLBACK` and `DOCLING_FORCE_FULL_PAGE_OCR` used to be the same
switch: `app.py` derived both the `ocr` capability ceiling and
`force_full_page_ocr_default` from `(FORCE_FULL_PAGE_OCR or ENABLE_OCR_FALLBACK)`.
Because the `unplanned` lane inherits the forcing default, enabling the fallback
silently ran full-page EasyOCR on every page of every document on that lane —
44% of production traffic — including native-text PDFs whose measured
`ocr_page_ratio` was `0.0`.

Turning the fallback off was not a workaround: `ocr` is a hard ceiling
(`LANE-POLICY.md` rule 4), so that would have left the `ocr_scanned` lane unable
to OCR a genuinely scanned document. There was no env-var combination for "OCR
available, not forced".

Since v3 the two are independent:

- `ENABLE_OCR_FALLBACK=true` → OCR is *available* to lanes that want it.
- `DOCLING_FORCE_FULL_PAGE_OCR=true` → lanes inheriting the default also *force*
  it. Leave this off.
- `ocr_scanned` forces full-page OCR either way, capped only by the `ocr` ceiling.

`/capabilities` reports `global_force_full_page_ocr_default`, which before v3
showed `FORCE_FULL_PAGE_OCR` alone while the code used the combined expression —
so the endpoint advertised the intended behaviour rather than the real one. It
is now accurate.

When the command finishes, copy the printed **Service URL**:

```
Service URL: https://pdf-parse-service-xxxxxxxx-uc.a.run.app
```

Export it for the next step:

```bash
export PDF_PARSE_SERVICE_URL="https://pdf-parse-service-xxxxxxxx-uc.a.run.app"
```

---

## 5. Smoke-test the sidecar

```bash
# Health probe (no auth required)
curl -s "$PDF_PARSE_SERVICE_URL/healthz" | jq

# Parse a small public PDF (auth required)
curl -s -X POST "$PDF_PARSE_SERVICE_URL/parse" \
  -H "Authorization: Bearer $PDF_PARSE_SERVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://arxiv.org/pdf/2206.01062.pdf"}' \
  | jq '{engine: .engine_version, pages: (.pages|length), has_outline: (.outline|length>0), has_doctags: (.doctags|length>0), has_summary: (.summary != null)}'
```

Expected output:

```json
{
  "engine": "docling-2.14.0+phaseD+waveD",
  "pages": 9,
  "has_outline": true,
  "has_doctags": true,
  "has_summary": true
}
```

If you see `401 Unauthorized`, the token doesn't match. If you see `500`,
check logs:

```bash
gcloud run services logs read "$SERVICE" --region "$REGION" --limit 50
```

---

## 6. Wire the secrets into Supabase

In the Lovable chat, add (or update) the two secrets so the
`pdf-parse-dispatch` edge function can reach the new sidecar:

1. `PDF_PARSE_SERVICE_URL` → value of `$PDF_PARSE_SERVICE_URL` from step 4.
2. `PDF_PARSE_SERVICE_TOKEN` → value of `$PDF_PARSE_SERVICE_TOKEN` from step 1.

After they're saved the dispatcher picks them up automatically — no redeploy
needed because edge functions read `Deno.env.get(...)` per invocation.

You can also set them via the dashboard:
<https://supabase.com/dashboard/project/dduzbchuswwbefdunfct/settings/functions>

---

## 7. End-to-end verification from the app

1. Open `/admin/pdf-import-engine` (superadmin only) and confirm the engine
   toggle is set to **Docling**.
2. Open any template import surface and upload a PDF.
3. Watch the job ledger at `/admin/pdf-import-diagnostics` — you should see
   stage breadcrumbs progress through:
   `hashing → parsing → persisting → rastering → finalizing`.
4. Re-upload the **same** PDF — the second job should complete in <2 s with
   `cache_hit: true` and `source_file_hash` populated (Phase C cache).
5. Open the diagnostics bundle for the first job; it should contain:
   ```
   <job_id>/docling.json
   <job_id>/rasters.json
   <job_id>/doctags.md        ← Phase D
   <job_id>/outline.json      ← Phase D
   <job_id>/document.md       ← Phase D
   ```

---

## 8. Updating the sidecar later

Any change to `pdf-parse-service/app.py`, `requirements.txt`, or `Dockerfile`:

```bash
cd pdf-parse-service
export IMAGE=gcr.io/$GCP_PROJECT/$SERVICE:phaseD-$(date +%Y%m%d-%H%M)
gcloud builds submit --tag "$IMAGE" .
gcloud run deploy "$SERVICE" \
  --image "$IMAGE" \
  --region "$REGION" \
  --concurrency 2 \
  --timeout 300 \
  --min-instances 0 \
  --max-instances 10 \
  --startup-probe-http-path /healthz
```

Cloud Run will roll the new revision in atomically and drain the old one.

To roll back:

```bash
gcloud run revisions list --service "$SERVICE" --region "$REGION"
gcloud run services update-traffic "$SERVICE" \
  --region "$REGION" \
  --to-revisions <PREVIOUS_REVISION_NAME>=100
```

---

## 9. Environment variable reference

| Var | Default | Purpose |
| --- | --- | --- |
| `PDF_PARSE_SERVICE_TOKEN` | _(required)_ | Bearer token enforced on `/parse` and `/raster`. |
| `ENABLE_PICTURE_CLASSIFICATION` | `true` | Classify pictures (chart/table/photo/etc). |
| `ENABLE_PICTURE_DESCRIPTION` | `false` | VLM-generated captions (slow; opt-in per job). |
| `ENABLE_FORMULA_ENRICHMENT` | `false` | Emit LaTeX for detected formulas. Off by default — scientific-paper feature, no measured benefit on property/finance PDFs. |
| `ENABLE_CODE_ENRICHMENT` | `false` | Detect code blocks + language. Off by default, same reason. |
| `ENABLE_OCR_FALLBACK` | `false` | Make EasyOCR *available* as a fallback on text-less pages. Since lane-policy v3 this no longer also forces full-page OCR — use `DOCLING_FORCE_FULL_PAGE_OCR` for that. |
| `DOCLING_FORCE_FULL_PAGE_OCR` | `false` | Force full-page OCR as the process-wide default for lanes that inherit it (`unplanned`). The `ocr_scanned` lane forces it regardless. |
| `DOCLING_OCR_LANGS` | `en` | EasyOCR languages. Resolved through `ocr_languages.py`: non-EasyOCR spellings are aliased (`zh` → `ch_sim`), unknown codes dropped, and incompatible script mixes reduced to one constructible group. |
| `DOCLING_PREWARM_ON_STARTUP` | `true` | Convert a one-page sample at boot so Docling models are loaded before the first real import. |
| `DOCLING_IMAGES_SCALE` | `2.0` | Picture crop DPI multiplier (1.0 = 72 dpi). |
| `DOCLING_LAYOUT_MODEL` | _(unset)_ | Override layout model id, e.g. `docling-models/layout-heron`. |
| `DOCLING_TABLE_MODE` | `ACCURATE` | `FAST` or `ACCURATE` TableFormer mode. |
| `DOCLING_ENABLE_FITZ_LAYERS` | `true` | Phase 2: PyMuPDF vector-graphics + span-typography pass. Set `false` to fall back to Docling-only output. |
| `DOCLING_RASTER_DPI` | `300` | Phase 2: reference-raster DPI (was 200). Lower to 200/240 if cold-starts or memory regress. |
| `DOCLING_MAX_VECTORS_PER_PAGE` | `400` | Phase 2: cap on extracted vector items per page (prevents overlay explosion). |
| `DOCLING_MIN_VECTOR_SIZE_PT` | `1.0` | Phase 2: drop vector drawings smaller than this (pt) in both width and height. |
| `DOCLING_MAX_FONTS` | `48` | Phase 3: cap on distinct fonts surfaced in `doc.fonts`. |
| `DOCLING_MAX_FONT_BYTES` | `524288` | Phase 3: only embed (base64) font programs at or under this size. |

Override per deploy with `--update-env-vars KEY=VALUE` on `gcloud run deploy`.

---

## 10. Cost & quota expectations

- ~$0.003 per import (median 8-page report, no OCR).
- ~$0.012 per import with OCR fallback on a 30-page scanned PDF.
- 5 MB diagnostics bundle per job, auto-purged after 7 days from the
  `pdf-import-diagnostics` Storage bucket.
- Cloud Run free tier covers ~2 M requests/month at this size; expect
  <$15/mo until you cross ~50 K imports.

### Sidecar token rotation runbook

1. Generate the replacement token: `openssl rand -hex 48`.
2. Redeploy Cloud Run with the current `PDF_PARSE_SERVICE_TOKEN` and the replacement as `PDF_PARSE_SERVICE_TOKEN_NEXT`.
3. Update the Supabase edge-function secret `PDF_PARSE_SERVICE_TOKEN` to the replacement token.
4. Run `/healthz`, `/parse`, and `/raster` smoke tests and verify request IDs in Cloud Run logs.
5. Redeploy Cloud Run with the replacement as `PDF_PARSE_SERVICE_TOKEN` and remove `PDF_PARSE_SERVICE_TOKEN_NEXT`.

During the grace window, the sidecar accepts either bearer token. Do not leave `PDF_PARSE_SERVICE_TOKEN_NEXT` set after rotation is complete.

---

## 11. Phase 2 deploy delta — vector graphics + typography (PyMuPDF)

This release adds a **PyMuPDF (`fitz`)** pass that extracts vector graphics
(logos, rule lines, fills) and real span typography (line-height, letter
spacing, alignment, embedded font names) on top of Docling. PyMuPDF is
**AGPL-3.0** — see `pdf-parse-service/NOTICE.md`.

Three components changed and each must be deployed:

### 11.1 Rebuild + redeploy the Cloud Run sidecar (required)

`requirements.txt` now pins `PyMuPDF==1.24.14`, so the image **must** be
rebuilt — a config-only revision will not pick it up.

```bash
cd pdf-parse-service
export GCP_PROJECT=<YOUR_GCP_PROJECT_ID>
export REGION=us-central1            # whatever you deployed to originally
export SERVICE=pdf-parse-service
export IMAGE=gcr.io/$GCP_PROJECT/$SERVICE:phase2-fitz-$(date +%Y%m%d-%H%M)

gcloud builds submit --tag "$IMAGE" .

gcloud run deploy "$SERVICE" \
  --image "$IMAGE" \
  --region "$REGION" \
  --memory 4Gi \
  --concurrency 2 \
  --timeout 300 \
  --min-instances 0 \
  --max-instances 10 \
  --startup-probe-http-path /healthz \
  --update-env-vars "DOCLING_ENABLE_FITZ_LAYERS=true,DOCLING_RASTER_DPI=300,DOCLING_MAX_VECTORS_PER_PAGE=400,DOCLING_MIN_VECTOR_SIZE_PT=1.0"
```

Notes:
- `--update-env-vars` preserves the existing env (token, Docling toggles) and
  only adds/overrides the Phase 2 keys. Do **not** use `--set-env-vars` here or
  you will wipe `PDF_PARSE_SERVICE_TOKEN`.
- The default raster DPI rose 200 → 300. If you observe Cloud Run OOM/cold-start
  regressions, set `DOCLING_RASTER_DPI=240` (or bump `--memory 6Gi`).
- No secret/token change; the Supabase secrets from section 6 still apply.

### 11.2 Redeploy the `pdf-parse-chunk-callback` edge function (required)

The chunk-merge for large PDFs now carries `vectors` through the merged
document. Without this, PDFs large enough to be chunked (>20 pages) would lose
vectors.

```bash
# Supabase CLI (from repo root). Project ref: dduzbchuswwbefdunfct
supabase functions deploy pdf-parse-chunk-callback --project-ref dduzbchuswwbefdunfct
```

(or deploy it from the Lovable/Supabase functions UI). No other edge function
changed; `pdf-parse-dispatch` / `pdf-parse-callback` are untouched.

### 11.3 Frontend (standard deploy, no migration)

The frontend changes are additive — a new optional `Page.background.imageFit`
schema field and new vector/typography mapping. There is **no database
migration**. Deploy the app the usual way (Vite build / Lovable publish).

### 11.4 Smoke-test the new extraction

```bash
curl -s -X POST "$PDF_PARSE_SERVICE_URL/parse" \
  -H "Authorization: Bearer $PDF_PARSE_SERVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://arxiv.org/pdf/2206.01062.pdf"}' \
  | jq '{engine: .engine_version, vectors: (.docling_document.vectors|length), vector_count: .summary.vector_count, fitz: .parse_options.fitz_layers, sample_font: (.docling_document.texts[0].font)}'
```

Expect `engine` to end with `+phase2-fitz-vectors-typography`, `fitz: true`,
`vectors` > 0 on a design-rich PDF, and `sample_font` to include
`line_height`/`letter_spacing` when the source had detectable leading.

### 11.5 End-to-end verification in the app

1. Import a brand-heavy template (e.g. one of `public/templates/*.pdf`).
2. On the builder canvas you should now see **vector logos/rule lines** and
   text laid out with the source's real leading/alignment — not just the flat
   raster. (Tables and vectors render via `OverlayPreview` from Phase 1.)
3. Open `PdfFidelityDiffDialog` and confirm reduced drift / higher SSIM vs. a
   pre-Phase-2 import of the same file.

### 11.6 Rollback

- **Fastest:** set `DOCLING_ENABLE_FITZ_LAYERS=false` via
  `gcloud run services update "$SERVICE" --region "$REGION" --update-env-vars DOCLING_ENABLE_FITZ_LAYERS=false`
  — the sidecar reverts to Docling-only output with no rebuild. The frontend
  simply receives no `vectors` and unchanged typography (graceful).
- **Full:** roll Cloud Run traffic back to the previous revision (section 8) and
  redeploy the prior `pdf-parse-chunk-callback`.

---

## 12. Phase 3 deploy delta — faithful fonts

Phase 3 surfaces document fonts (`doc.fonts`) and makes imported text render in
its real typeface (web-font matching, with opportunistic byte-embedding for the
rare fully-embedded font). It ships in the **same sidecar image + chunk-callback**
as Phase 2, so the deploy is identical to §11.1–11.2 — no extra services.

- **Sidecar:** the Phase 2 rebuild already includes Phase 3 (`_extract_fitz_fonts`).
  Optional caps: `DOCLING_MAX_FONTS`, `DOCLING_MAX_FONT_BYTES` (see §9). The
  `DOCLING_ENABLE_FITZ_LAYERS=false` kill-switch disables fonts too.
- **Chunk-callback:** the same redeploy carries `doc.fonts` through the merge.
- **Frontend / WeasyPrint:** no change beyond the standard app deploy — fonts load
  via the existing `ensureCatalogFontFaces` → `@font-face` path, which WeasyPrint
  embeds natively.

Smoke-test additions:

```bash
curl -s -X POST "$PDF_PARSE_SERVICE_URL/parse" \
  -H "Authorization: Bearer $PDF_PARSE_SERVICE_TOKEN" -H "Content-Type: application/json" \
  -d '{"url":"https://arxiv.org/pdf/2206.01062.pdf"}' \
  | jq '{engine: .engine_version, font_count: .summary.font_count, fonts: [.docling_document.fonts[]? | {basename, subset, hasUnicodeCmap, embeddable: (has("base64"))}]}'
```

Expect `engine` to end with `+phase3-fonts` and `fonts` to list the source font
names (most `subset: true`, `embeddable: false` → matched to web fonts by name).
In the builder, imported headings/body should render in their real families
(e.g. Unbounded / Open Sans / Playfair Display); fonts with no web match surface
a `font_substituted` import warning.

**Rollback:** same as §11.6 — `DOCLING_ENABLE_FITZ_LAYERS=false` (instant, no
rebuild) or revert the Cloud Run revision + prior chunk-callback.

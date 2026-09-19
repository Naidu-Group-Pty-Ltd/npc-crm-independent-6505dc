# PDF Fidelity — Deployment Verification Runbook

> **Why this doc exists.** After merging the template-builder PDF-fidelity work
> (Phases 1–5: vector + typography + font extraction), the new richness did **not**
> appear in the builder. Investigation showed this is a **deployment** gap, not a code
> gap. Use this runbook to verify each deployable surface is actually running the new
> code, fix the one that isn't, and confirm end-to-end.

_Last verified: 2026-06-29._

---

## 1. Architecture sanity check — three surfaces, three deploy triggers

A single PDF import crosses **three independently-deployed surfaces**. Merging code to
`main` deploys **none** of them by itself.

```
 Browser (React / Vite app)                         ← Surface 3: FRONT-END   (Lovable)
        │  upload PDF
        ▼
 pdf-parse-dispatch (Supabase edge fn) ──► pdf-parse-service (Cloud Run)   ← Surface 1: SIDECAR
        │   routes the job                      │  extracts text/tables/pictures
        │                                       │  + vectors / fonts / typography   (NEW)
        │                                       │  uploads docling.json → Storage bucket
        ▼                                       ▼
 pdf-parse-callback (≤20 pp)        /    pdf-parse-chunk-callback (>20 pp)  ← Surface 2: EDGE FNs
        │  writes result_payload.docling_path
        ▼
 Browser downloads docling.json → mapDoclingToRawBlocks → overlays → builder canvas
```

| Surface | What it is | Deploy trigger | Needs action? |
| --- | --- | --- | --- |
| **1. Sidecar** | `pdf-parse-service` on Cloud Run (Docling + PyMuPDF). **Produces** `vectors`/`fonts`/typography. | `gcloud builds submit` + `gcloud run deploy` (manual, e.g. Cloud Shell) | **YES — primary blocker.** Must run the new image. |
| **2. Edge functions** | `pdf-parse-dispatch` (routes) + `pdf-parse-callback` (≤20 pp) / `pdf-parse-chunk-callback` (>20 pp) | Supabase deploy / MCP | **NO.** See below. |
| **3. Front-end** | Vite/React app published via **Lovable**. **Renders** the new data. | Manual **Publish** in Lovable (CI builds/tests only — never deploys) | **YES — Publish required.** |

### Why the edge functions need no redeploy
- For a **normal (≤20-page)** PDF the callback is `pdf-parse-callback`, which merges the
  sidecar's `result_payload` **verbatim** — no field whitelist, no summary rebuild
  (`supabase/functions/pdf-parse-callback/index.ts:73-82`). `pdf-parse-dispatch` only
  routes the job; it never transforms `docling.json`. So `vectors`/`fonts`/typography
  pass straight through.
- The **only** function that rebuilds the merged JSON is `pdf-parse-chunk-callback`
  (the >20-page path), and it already carries the `vectors`/`fonts` merge + counts and
  is deployed (v22, `verify_jwt=false`).

---

## 2. Current findings (evidence)

**The live sidecar is still the OLD build.** Every `pdf_import_jobs` row — including the
most recent (2026-06-29 11:15 UTC) — reports:

```
engine_version = docling-2.14.0+…+phase4j-capability-activation          ← OLD (live)
```

The new code declares (`pdf-parse-service/app.py`, `ENGINE_VERSION`):

```
engine_version = docling-2.14.0+…+phase4j-capability-activation+phase2-fitz-vectors-typography+phase3-fonts   ← NEW (expected)
```

The `+phase2-fitz-vectors-typography+phase3-fonts` suffix is **absent from every job**,
and job summaries carry no `vector_count`/`font_count`. So either the Cloud Shell deploy
never took traffic, or it was built from a stale clone / wrong project-region, **or** it
is fine but no fresh import has exercised it yet. A single fresh import resolves the
ambiguity (§3, step C).

**What is confirmed correct (do not re-do):**
- The phase code **is merged to `origin/main`**: `mapDoclingToRawBlocks.ts` has
  `vectorItemToBlock` + `doc.vectors` iteration; `app.py` has `_extract_fitz_layers`;
  `ENGINE_VERSION` carries the new suffix.
- Edge functions: no redeploy needed (see §1).

**Guaranteed red herring:** re-opening a **previously-imported** template always shows
pre-feature data (its `docling.json` predates the new extractor). Always test with a
**fresh import**.

---

## 3. Verification & fix

> Run in Cloud Shell. Assumes the `pdf-parse-service/DEPLOY.md` conventions.

### Set variables
```bash
export GCP_PROJECT="<your-gcp-project-id>"   # the project hosting the sidecar
export REGION=us-central1
export SERVICE=pdf-parse-service
gcloud config set project "$GCP_PROJECT"
```

### A. Verify — which revision is live, and is it the new code?
```bash
# (a) Which revision serves traffic, how much, and what is the latest created revision:
gcloud run services describe "$SERVICE" --region "$REGION" \
  --format="table(status.traffic[].revisionName, status.traffic[].percent, status.latestCreatedRevisionName)"

# (b) Newest revisions first — confirm the top one is the one taking traffic:
gcloud run revisions list --service "$SERVICE" --region "$REGION" \
  --sort-by="~metadata.creationTimestamp" --limit 5 \
  --format="table(metadata.name, status.conditions[0].status, metadata.creationTimestamp, spec.containers[0].image)"

# (c) Decisive check — ask the LIVE service its version (healthz is open, no auth):
SERVICE_URL=$(gcloud run services describe "$SERVICE" --region "$REGION" --format="value(status.url)")
echo "Service URL: $SERVICE_URL"
curl -s "$SERVICE_URL/healthz" | jq -r '.engine_version'
```

**Pass condition:** `engine_version` from (c) contains
`phase2-fitz-vectors-typography+phase3-fonts`.
- If it ends at `…+phase4j-capability-activation` → live revision is the **old build** → do **B**.
- If `latestCreatedRevisionName` is newer than the revision taking 100% traffic → the
  deploy landed but never got traffic → run the `update-traffic` line in **B**.

### B. Fix if stale — rebuild from `main` and route traffic
The most common Cloud Shell failure is building from a **stale clone**. Pull fresh and
**verify the source version before building**:
```bash
cd ~/npc-property-dashbord 2>/dev/null && git fetch origin && git checkout main && git pull origin main \
  || { cd ~ && rm -rf npc-property-dashbord && git clone <your-repo-url> && cd npc-property-dashbord; }

# Confirm the source you are about to build actually has the new version string:
grep -m1 '^ENGINE_VERSION' pdf-parse-service/app.py
#   must include: +phase2-fitz-vectors-typography+phase3-fonts

cd pdf-parse-service

# Build a fresh, uniquely-tagged image and deploy it:
export IMAGE="gcr.io/$GCP_PROJECT/$SERVICE:phase2-3-$(date +%Y%m%d-%H%M)"
gcloud builds submit --tag "$IMAGE" .
gcloud run deploy "$SERVICE" --image "$IMAGE" --region "$REGION"

# Force 100% traffic to the just-deployed revision (covers the 0%-traffic trap):
gcloud run services update-traffic "$SERVICE" --region "$REGION" --to-latest
```

> ⚠️ **Do NOT change `PDF_PARSE_SERVICE_TOKEN` on redeploy.** Reuse the existing value or
> the edge function's calls start failing auth. A plain `gcloud run deploy --image …`
> keeps existing env vars — don't pass `--set-env-vars` unless you intend to.

### C. Re-verify the sidecar, then prove it with one fresh import
```bash
curl -s "$SERVICE_URL/healthz" | jq -r '.engine_version'
# expect now: …+phase2-fitz-vectors-typography+phase3-fonts
```
Then **import one small (≤20-page) PDF through the app** (not an existing template) and
run this SQL in the Supabase SQL editor (or via MCP):
```sql
select
  id,
  created_at,
  engine_version,
  (result_payload->>'docling_path')        as docling_path,
  (result_payload->'summary'->>'vector_count') as vector_count,
  (result_payload->'summary'->>'font_count')   as font_count
from pdf_import_jobs
order by created_at desc
limit 3;
```
**Pass condition:** the newest row's `engine_version` contains
`phase2-fitz-vectors-typography+phase3-fonts`. (For a ≤20-page job, `summary` won't carry
`vector_count`/`font_count` — those are added by the chunked-merge path — so confirm the
**`engine_version`** and inspect the stored `docling.json` itself for top-level `vectors`
and `fonts` keys + `line_height`/`text_align` on text spans.)

---

## 4. Front-end (Lovable) publish

Even with the sidecar fixed, the browser only renders the new data if the **published**
front-end bundle contains the phase code. Merging to `main` does **not** auto-deploy.

1. In **Lovable**, open the project and **Publish** (Share → Publish) so production picks
   up the latest `main`.
2. **Hard-refresh** the app in the browser (bypass cache).
3. **Import the PDF fresh** again and open it in the builder.

---

## 5. Final checklist (do in order)

- [ ] **A.** `gcloud run …describe` + `/healthz` → confirm the live `engine_version`.
- [ ] **B.** If old / 0%-traffic: rebuild from a fresh `main` clone (verify `ENGINE_VERSION`
      first) → `run deploy` → `update-traffic --to-latest`. Keep the existing token.
- [ ] **C.** Re-check `/healthz`; run one fresh import; confirm the new `engine_version`
      on the newest `pdf_import_jobs` row and `vectors`/`fonts` in its `docling.json`.
- [ ] **D.** **Publish** the front-end in Lovable; hard-refresh; re-import.
- [ ] **E.** Confirm the builder canvas now shows reconstructed vectors + faithful fonts
      / typography (not just the flat raster).

**Edge functions:** no action required.

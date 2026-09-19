# Sidecar deploy — August 2026 catch-up

> **Engineering runbook — one specific deploy, not a template.** This ships the
> accumulated sidecar changes (lane-policy v3, OCR language fix, subset-font
> embedding, `source_measure`, 300 DPI) and closes a live version mismatch.
> The generic deploy reference remains [`pdf-parse-service/DEPLOY.md`](../../../pdf-parse-service/DEPLOY.md).

## Why this deploy is urgent

The dispatcher on `main` auto-deploys on merge and is already live at
`extractor-lane-policy-v3` (since the #1976/#1989 merges). The Cloud Run
sidecar image is still the old v2 build — the pairing `LANE-POLICY.md` G3
forbids. Import volume is currently near zero, so exposure is small, but every
import made in this state can cache stale-semantics artifacts. This deploy ends
that state.

It also picks up the fixes production testing asked for: **fonts render in the
source document's own embedded programs** (subset embedding), per-line measured
advance widths, the 300 DPI rasters, and the OCR language fix that was failing
9 of 33 parses.

---

## 0. Preconditions

1. **Merge PR [#1990](https://github.com/lavan96/npc-property-dashbord/pull/1990) first.**
   Building the image before that merge misses the subset-font and
   `source_measure` changes — the two things that make text render exactly.
   Merging also auto-deploys the dispatcher with the matching
   `ENGINE_VERSION_FAMILY`, which is correct: this sidecar deploy is what closes
   the pair.
2. A machine with `gcloud` authenticated against the GCP project that runs
   `pdf-parse-service`, and a fresh clone/pull of `main` *after* the merge.
3. `jq` installed (verification steps).

```bash
git checkout main && git pull
cd pdf-parse-service
```

## 1. Set the variables

```bash
export GCP_PROJECT=<YOUR_GCP_PROJECT_ID>
export REGION=us-central1          # current region — do NOT move regions in this deploy
export SERVICE=pdf-parse-service
export IMAGE=gcr.io/$GCP_PROJECT/$SERVICE:docling-2.14.0-lanepolicy-v3-subset-fonts
```

Region note: the Singapore move (`asia-southeast1`) is a **separate later
step** in the performance programme. Doing it in the same deploy as a semantics
change destroys attribution — if something regresses you won't know which
change did it.

## 2. Confirm the live service's current environment (token safety)

The bearer token lives in the service's env. **Do not use `--set-env-vars`
anywhere in this deploy** — it replaces the entire env block and would wipe
`PDF_PARSE_SERVICE_TOKEN`, causing every request to 401. This runbook only uses
`--update-env-vars` / `--remove-env-vars`, which merge.

Sanity-check what's currently set:

```bash
gcloud run services describe "$SERVICE" --region "$REGION" \
  --format 'value(spec.template.spec.containers[0].env)' | tr ';' '\n'
```

You should see `PDF_PARSE_SERVICE_TOKEN` (value present),
`ENABLE_OCR_FALLBACK=true`, and the two enrichment flags this deploy removes.

## 3. Build the image (~6–10 min — Docling models bake in at build time)

```bash
gcloud builds submit --tag "$IMAGE" .
```

## 4. Deploy

```bash
gcloud run deploy "$SERVICE" \
  --image "$IMAGE" \
  --region "$REGION" \
  --platform managed \
  --no-cpu-throttling \
  --memory 8Gi \
  --remove-env-vars ENABLE_FORMULA_ENRICHMENT,ENABLE_CODE_ENRICHMENT
```

What each flag is doing:

| Flag | Why |
|---|---|
| `--no-cpu-throttling` | **The single highest-value change in the whole programme.** `/parse` returns 202 and does all Docling work in a background task; without this flag that work runs on a throttled CPU — the production ledger shows two 94-page jobs at 357s vs 46,424s. Billing becomes instance-based (~$1/mo at current volume). |
| `--memory 8Gi` | Each request holds ~1.5 GB mid-parse plus resident model weights; 4 GiB at concurrency 2 is the likely cause of the five `sidecar_error 503` failures. |
| `--remove-env-vars …ENRICHMENT` | Formula/code enrichment now default **off** in code (scientific-paper features, no benefit on property PDFs). Removing the explicit `true` lets the new defaults apply. |

Everything else (token, OCR fallback, prewarm, table mode) carries over from
the previous revision untouched. `ENABLE_OCR_FALLBACK=true` is now safe: since
lane-policy v3 it makes OCR *available* without forcing it on every page.

## 5. Verify — this step is the deploy

```bash
export PDF_PARSE_SERVICE_URL=$(gcloud run services describe "$SERVICE" \
  --region "$REGION" --format 'value(status.url)')

# The token as currently set on the service (for the curl below):
export PDF_PARSE_SERVICE_TOKEN=$(gcloud run services describe "$SERVICE" --region "$REGION" \
  --format 'value(spec.template.spec.containers[0].env)' | tr ';' '\n' \
  | grep -A1 "'PDF_PARSE_SERVICE_TOKEN'" | grep value | sed "s/.*value': '//;s/'.*//")

curl -s "$PDF_PARSE_SERVICE_URL/healthz" \
  -H "Authorization: Bearer $PDF_PARSE_SERVICE_TOKEN" | jq

curl -s "$PDF_PARSE_SERVICE_URL/capabilities" \
  -H "Authorization: Bearer $PDF_PARSE_SERVICE_TOKEN" | jq '{
    engine: .engine_version,
    lane: .lane_policy_version,
    force_ocr: .ocr.global_force_full_page_ocr_default,
    langs: .ocr.ocr_langs,
    dropped: .ocr.ocr_language_resolution.dropped,
    formula: .global_capabilities.formula,
    code: .global_capabilities.code
  }'
```

**Every row of this table must match, or do not proceed:**

| Field | Expected |
|---|---|
| `engine` | contains `+subset-fonts-v1+source-measure-v1` |
| `lane` | `extractor-lane-policy-v3` |
| `force_ocr` | `false` |
| `langs` | `["en"]` |
| `dropped` | `{}` |
| `formula` / `code` | `false` / `false` |

Then confirm the dispatcher pair. The merge in step 0 should have deployed it
via `deploy-supabase-functions.yml` — check the run succeeded at
<https://github.com/Naidu-Group-Pty-Ltd/npc-property-dashbord/actions/workflows/deploy-supabase-functions.yml>.
The `lane` value above must equal the dispatcher's `LANE_POLICY_VERSION`
(`extractor-lane-policy-v3` in `supabase/functions/pdf-parse-dispatch/index.ts`).
A mismatch means the cache fingerprint is serving stale-semantics artifacts —
fix before importing anything.

## 6. Prove it end to end (10 minutes, do not skip)

1. In the Template Builder, **import a fresh PDF** — one with a distinctive
   brand font and a full-page image. Do not re-open an existing template:
   existing templates were built from artifacts that predate every fix here,
   and prove nothing either way.
2. Check, in the editor: text renders in the source's own font (not a
   lookalike); pages are white; brand images present.
3. Export the template to PDF via WeasyPrint (a multi-page pixel-perfect one if
   available). **This is the first-ever live run of the reference-mode image
   transport** — confirm every page background actually appears in the PDF.
   - If backgrounds are missing from the export: the transport is the suspect.
     Mitigation without redeploying: flip the four `preloadImages(...,
     { mode: 'reference' })` call sites back to `'inline'` (client-only change),
     and file what you saw.
4. Check the job in `pdf_import_jobs`: `status = succeeded`, and duration
   consistent with an *unthrottled* run (a 20-page doc should be minutes, not
   hours).

## 7. Rollback

```bash
gcloud run revisions list --service "$SERVICE" --region "$REGION"
gcloud run services update-traffic "$SERVICE" \
  --region "$REGION" --to-revisions <PREVIOUS_REVISION_NAME>=100
```

Rolling back the sidecar re-opens the version mismatch with the live v3
dispatcher — that pairing was already live before this deploy, so it is a
return to the prior (bad but known) state, not a new failure. Do not roll back
the dispatcher independently.

## 8. Afterwards (separate steps, in this order)

1. **Watchdog tightening** — only once step 6.4 confirms unthrottled runs:
   apply the v6 migration if not yet applied, then the tuning UPDATE per
   [`pdf-import-watchdog-window-tuning-sop.md`](./pdf-import-watchdog-window-tuning-sop.md).
2. **Artifact Registry cleanup policy** (keep ~3 revisions) — your largest real
   cost line, independent of everything.
3. **Region move to `asia-southeast1`** — after a week of stable measurements,
   per the baseline SOP, cutting the 19s-per-job cross-Pacific upload tax.

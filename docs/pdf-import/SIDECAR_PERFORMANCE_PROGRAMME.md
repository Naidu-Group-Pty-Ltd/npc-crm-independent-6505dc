# PDF-import sidecar — performance & cost programme

Status: **Track A complete (code + docs merged); Track B awaiting operator action.**
Evidence base: `pdf_import_jobs` ledger, 76 jobs, 2026-06-12 → 2026-07-19.

Read this before touching `pdf-parse-service/`, `pdf-parse-dispatch`, or the
Cloud Run deployment. It records what the production ledger actually says, which
is not what the deployment docs assumed.

---

## 1. The measured baseline

76 jobs over 5.4 weeks — roughly **60 jobs/month**, average 21.6 pages, largest
106 pages.

| | n | avg pages | p50 | p90 | max |
|---|---|---|---|---|---|
| monolithic, succeeded | 29 | 6.2 | 50.4s | 177.1s | 330.3s |
| chunked, succeeded | 14 | 52.7 | **369.0s** | **37,857s** | **47,573s** |
| monolithic, failed | 29 | 6.0 | 8.7s | 238.4s | 283.3s |
| chunked, failed | 4 | 43.5 | — | — | — |

**43% of all jobs failed** (33 of 76). Failure breakdown:

| error_code | n |
|---|---|
| `dispatcher_timeout` | 15 |
| `docling_convert_failed` | 9 |
| `sidecar_error` (503) | 5 |
| `chunk_stalled` | 2 |
| `chunk_merge_validation_failed` | 1 |
| `manual_stuck_chunk_timeout` | 1 |

Only 3 jobs carry the `sidecar-operational-metrics-v1` contract (it postdates
most of the ledger). Those three: `parse_ms` 23.6s, `raster_ms` 2.5s,
**`artifact_upload_ms` 19.0s**, `source_download_ms` 0.1s, total 45.2s,
2.3s/page, `ocr_page_ratio` **0.000**.

---

## 2. Findings

### F1 — The sidecar runs its real work on a throttled CPU

`/parse` returns `202` and does the entire Docling pipeline in a FastAPI
background task (`app.py`, `background_tasks.add_task(_run_async_job, req)`).
The deployment carried **no `--no-cpu-throttling`**. Cloud Run allocates CPU
during request processing; work continuing after the response is throttled
toward zero until another request wakes the instance.

The ledger matches that signature: two 94-page jobs took **357s and 46,424s** —
130x on identical work. A 106-page job finished in 617s while a 62-page job took
47,573s. That is not a Docling variance curve.

Treated as a strong hypothesis, not proof. Confirm by comparing billable
instance time against request count (see the baseline SOP) before and after.

### F2 — OCR availability and OCR forcing were the same switch

`app.py` derived both from `(FORCE_FULL_PAGE_OCR or ENABLE_OCR_FALLBACK)`. The
`unplanned` lane inherits the forcing default, so enabling the fallback ran
full-page EasyOCR on every page of 44% of traffic — on documents whose measured
`ocr_page_ratio` was `0.0`.

Disabling the fallback was not an escape: `ocr` is a hard ceiling
(`LANE-POLICY.md` rule 4), so it would also have disabled OCR for genuinely
scanned documents. **No env-var combination expressed "available, not forced".**
Fixed in lane-policy v3.

`/capabilities` reported `global_force_full_page_ocr_default` as
`FORCE_FULL_PAGE_OCR` alone — the intended behaviour, not the real one. That is
plausibly why this survived so long.

### F3 — The OCR language default could not be constructed

Shipped default: `en,fr,de,es,zh,ja,ko,ar`. `zh` is not an EasyOCR code (it is
`ch_sim`/`ch_tra`), and EasyOCR cannot combine Japanese, Korean and Arabic in one
reader. This is `docling_convert_failed: ({'zh'}, 'is not supported')` — **9 of
33 failures**, on OCR that was never going to contribute a character.

`test_ocr_config.py` already asserted the default was a compatible group. **No CI
job ran it**, or any of the 15 other `pdf-parse-service` test files. An unrun
test is not a test.

### F4 — 44% of traffic runs on the most expensive lane

19 of 43 successful jobs carry no `extractor_lane` and land on `unplanned`, which
inherits every global ceiling: ACCURATE tables, picture classification, formula
enrichment, code enrichment, forced full-page OCR. Formula and code enrichment
target scientific papers and source listings.

| lane | n | avg pages | avg duration |
|---|---|---|---|
| `(none)` → unplanned | 19 | 55.6 / 4.0 / 6.5 | up to 12,334s |
| `fast_native` | 11 | 8.6 | 89.8s |
| `accurate_table` | 10 | 30.6 | 3,067.8s |
| `design_heavy` | 2 | 1.0 | 21.9s |
| `pixel_raster_only` | 1 | 13.0 | 48.1s |

### F5 — Region mismatch is 42% of wall clock

Cloud Run in `us-central1`; Supabase in `ap-southeast-1`. `artifact_upload_ms` is
19.0s of a 45.2s invocation. `DEPLOY.md` asserted latency was "dominated by
Docling parse time" and that any region worked. The metrics contradict it.

### F6 — Memory/concurrency ratio is tight

4 GiB at `--concurrency 2`, with `DEPLOY.md` itself noting each request can hold
~1.5 GB plus resident model weights. Consistent with the 5 `sidecar_error 503`
failures.

### F7 — Watchdog windows convert a stall into a half-day

The v5 sweep auto-fails a chunk after **90 minutes** of silence. Those windows
are generous *because* jobs currently crawl (F1) — so they cannot be tightened
until F1 is fixed. See §5.

---

## 3. What one Cloud Run actually costs

At 2 vCPU / 4 GiB, us-central1 list rates ($0.000024/vCPU-s, $0.0000025/GiB-s),
estimated ~8,400 sidecar-seconds/month:

- **16,800 vCPU-seconds/month** — free tier 180,000 → **9%**
- **33,600 GiB-seconds/month** — free tier 360,000 → **9%**
- **≈ $0.49/month at list price; ≈ $0 after free tier.**

The README's "~$0.003 per import" is right per-unit and irrelevant at 60/month.
The real bill is elsewhere:

| Line item | Estimate | Driver |
|---|---|---|
| **Artifact Registry** | **~$5–15/mo, growing** | Docling weights baked into the image; `DEPLOY.md` prescribes a fresh timestamped tag per deploy, so revisions accumulate at $0.10/GB/mo |
| Cross-Pacific egress | ~$0.15–0.40/mo | F5 |
| Cloud Build | ~$0 | 120 build-min/day free |
| Cloud Logging | ~$0 | 50 GiB/mo free |

**Realistic total $8–15/month, dominated by image storage.** List-price estimates
— confirm against the billing export.

**There is no meaningful compute bill to optimise.** This programme buys
reliability and latency, not savings. Expected outcome is roughly flat cost
(~$3–6/mo after Artifact Registry cleanup) with the failure rate falling from
43% toward under 15%.

Note `DEPLOY.md`'s suggestion to set `--min-instances 1` at ~$25/mo: that would
triple the bill to treat a symptom `--no-cpu-throttling` addresses for ~$1.

---

## 4. Track A — landed in this branch

| Item | Change |
|---|---|
| **P2-1** | `app.py`: `force_full_page_ocr_default=FORCE_FULL_PAGE_OCR` only (F2) |
| **P2-2/3** | New pure `ocr_languages.py`: default `en`, aliases `zh`→`ch_sim`, drops unknown codes, reduces incompatible script mixes (F3) |
| **P2-4** | `ENABLE_FORMULA_ENRICHMENT` / `ENABLE_CODE_ENRICHMENT` default `false` (F4) |
| **P2-5** | `LANE_ENFORCEMENT_VERSION` and the dispatcher's `LANE_POLICY_VERSION` → `extractor-lane-policy-v3` |
| **P2-6** | 92 pure tests (43 lane policy, 16 OCR, 33 metrics), all passing |
| **CI** | New `ci.yml` step running the sidecar's dependency-free tests (F3 root cause) |
| **Dockerfile** | `ocr_languages.py` added to the explicit COPY + py_compile list |
| **P4-1** | Watchdog v6 migration — windows moved to config, **seeded with v5 values, inert on apply** |
| **P3-1** | `DEPLOY.md` rewritten: `--no-cpu-throttling`, `asia-southeast1`, 8 GiB, corrected env table, F5 claim retracted |

### Cache fingerprint (P5-2) — investigated, deliberately unchanged

3 cache hits in 76 jobs. `computeCacheFingerprint` folds in
`ENGINE_VERSION_FAMILY`, `LANE_POLICY_VERSION`, `REDACTION_POLICY_VERSION` and
`ARTIFACT_CONTRACT_VERSION`, so every deploy invalidates the cache — and the v3
bump above invalidates it again, correctly.

**Recommendation: change nothing.** The null hypothesis is simply that users
rarely re-upload a byte-identical PDF, which would fully explain 3 hits without
any defect. The fields that make the key strict are security invariants (a
redacted request must never reuse an unredacted artifact). Measure repeat-upload
rate first; do not weaken the key to raise a metric.

### `description_tier` (P5-3) — a no-op, leave it alone

`extractPdfViaDocling.ts` hardcodes `description_tier: 'on'`. This looks like it
enables VLM picture captioning, and does not: `ENABLE_PICTURE_DESCRIPTION`
defaults to `false` and is a hard global ceiling, and the dispatcher further
requires `plan.requires_picture_description === true`. It is currently inert.

Documented here because "fixing" the client to match the flag would switch on a
vision-language model per image across all traffic. If picture description is
ever genuinely wanted, enable it per-lane (`design_heavy` already intends it),
not by changing the client.

---

## 5. Track B — operator actions, in order

Three ordering constraints matter. The rest parallelises.

> **① P4-2 must follow P1-1 verification.** Tightening watchdog windows while
> jobs are still throttled would mass-fail legitimate in-flight work. This is
> why the v6 migration ships inert.
>
> **② P2-7 and P2-8 must land in the same window.** Sidecar and dispatcher share
> `extractor-lane-policy-v3`; a split deploy means the cache fingerprint serves
> v2-semantics artifacts to v3 requests.
>
> Half of ② is now enforced rather than remembered. `pdf-parse-engine-lockstep.mjs`
> fails the pull request when `ENGINE_VERSION`/`LANE_ENFORCEMENT_VERSION` and the
> dispatcher's `ENGINE_VERSION_FAMILY`/`LANE_POLICY_VERSION` disagree, and
> `deploy-pdf-parse-service.yml` re-checks the same thing against the **staged**
> revision's `/healthz` before it can be promoted. What stays human is the
> *ordering* of the two deploys — the workflow stages with no traffic and will
> not cut over on its own.
>
> **③ P3 (region) after P1 and P2 are stable.** Moving region mid-change destroys
> attribution.

```
P0-1 ─► P0-2 ─► P1-1 ─► P1-2 ──────────► P3-2 ─► P3-3
                  │                        ▲
                  └──► P4-2                │
P2-7 ─► P2-8 ──────────────────────────────┘
P5-1  (independent — anytime)
```

| # | Action | Where |
|---|---|---|
| **P0-2** | Confirm F1: billable instance time vs request count | Cloud Run metrics |
| **P0-3** | Replace §3 estimates with real figures | Billing export |
| **P1-1** | `gcloud run services update pdf-parse-service --region us-central1 --no-cpu-throttling --memory 8Gi` | gcloud |
| **P2-7** | Rebuild + stage the image (includes `ocr_languages.py`), then promote | `deploy-pdf-parse-service.yml` |
| **P2-8** | Deploy `pdf-parse-dispatch` **in the same window** | CI |
| **P3-2** | Stand up `asia-southeast1`, verify `/healthz` + one real import | gcloud |
| **P3-3** | Repoint Supabase secret `PDF_PARSE_SERVICE_URL`, keep old service until confirmed | Supabase |
| **P4-2** | Apply the v6 migration, then tighten windows per the SOP | Supabase |
| **P5-1** | Artifact Registry cleanup policy, keep last ~3 revisions | gcloud |

Runbooks: [`pdf-import-performance-baseline-sop.md`](./runbooks/pdf-import-performance-baseline-sop.md)
and [`pdf-import-watchdog-window-tuning-sop.md`](./runbooks/pdf-import-watchdog-window-tuning-sop.md).

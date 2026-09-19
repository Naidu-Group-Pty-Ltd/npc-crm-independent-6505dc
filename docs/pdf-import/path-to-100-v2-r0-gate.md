# PDF Import — Path-to-100 v2 · Joint Release Gate R0

**Gate:** R0 — Dispatcher/sidecar contract gate
**Run:** 2026-07-16 · validation only (no source/migration/function/template/Cloud-Run changes)
**Branch under test:** `claude/document-analysis-clz4vi` @ `ef97c5d` (C0 + C1 + C2)
**Supabase project:** `dduzbchuswwbefdunfct` · **Cloud Run:** `pdf-parse-service` (`australia-southeast1`)

> Raw evidence is held in a local, git-excluded audit directory. No service-role keys, parse-service tokens, signed URLs, client PDFs, or unredacted artifact contents are recorded here. Identifiers are redacted.

---

## Verdict

**R0 — INCOMPLETE (not a full PASS). C3 is formally gated.**

- The **static / contract / negative-contract** half of R0 **PASSES** in full.
- The **live end-to-end** half (Tests A–F) is **BLOCKED**, not failed: the C1/C2 migration and Edge Functions are **not deployed** to any environment, and this gate's rules forbid deploying, using service tokens, or mutating production. The live imports are also operator-driven by design (joint gate).

**BLOCKED ≠ FAIL.** No C1/C2 contract was observed to be broken. The blocker is purely that the code is committed but undeployed, so its runtime behavior cannot be exercised here.

Per the gate rules, **no corrective changes were made**. A narrowly-scoped remediation package is at the end of this report.

---

## Decisive preflight finding — C1/C2 is committed but NOT deployed

| Signal | Expected if deployed | Observed | Result |
|---|---|---|---|
| Applied migration head (live) | `20260716120000…` (C1) | `20260715145228` | **C1 migration NOT applied** |
| `pdf_import_jobs` new columns (live) | `template_import_id`, `cache_contract_fingerprint`, `service_class` | none (query → `[]`) | **absent** |
| Deployed Edge Function timestamps | ≥ 2026-07-16 (C1/C2 commit day) | all `2026-07-15T16:16:05Z` | **pre-C1/C2 revisions** |

Deployed function revisions (all Jul-15, i.e. before C1/C2): `pdf-parse-dispatch` v49 · `pdf-parse-callback` v29 · `pdf-parse-chunk-callback` v40 · `pdf-parse-recover-stuck-jobs` v24 · `template-import-pdf` v54 · `pdf-import-diagnostics` v24 · `template-design-agent` v44.

Consequence: running a live import now would exercise the **pre-C1/C2** dispatcher/callbacks/importer (no Plan V2 validation, no cache fingerprint, no correlation column, no signed-map delivery) **and** would write to a schema that lacks the new columns — so Tests A–F cannot validate C1/C2 against this project, and doing so would also mutate production.

---

## Preflight (recorded, redacted)

| Item | Value |
|---|---|
| Branch / HEAD | `claude/document-analysis-clz4vi` @ `ef97c5d` |
| Working tree | CLEAN |
| Repo migration head | `20260716120000_pdf_import_c1_plan_correlation_cache.sql` |
| Live applied migration head | `20260715145228` |
| Cloud Run (operator/G0-provided) | `pdf-parse-service` · `australia-southeast1`; revision/image not independently queried (no `gcloud` in this environment) |

**Contract version constants (discovered from implementation, rule 4):**

| Contract | Constant | Value |
|---|---|---|
| Plan | `PDF_PLAN_CONTRACT_VERSION` | `pdf-plan-contract-v2` |
| Cache | `PDF_CACHE_CONTRACT_VERSION` | `pdf-cache-contract-v2` |
| Page artifacts | `PDF_PAGE_ARTIFACT_CONTRACT_VERSION` | `pdf-page-artifact-contract-v2` |
| Lane policy | `LANE_POLICY_VERSION` | `extractor-lane-policy-v1` |
| Redaction policy | `REDACTION_POLICY_VERSION` | `redaction-policy-v1` |
| Per-page docling | `PER_PAGE_DOCLING_ARTIFACT_VERSION` | `per-page-docling-v1` |

**Discovered C1/C2 names (from implementation, not assumed):**

- New job columns: `template_import_id` (uuid, FK→`template_imports` ON DELETE SET NULL), `cache_contract_fingerprint` (text), `service_class` (text).
- Persisted routing (`pdf_import_jobs.plan_payload`): `contract_version`, `plan_fallback_reason`, `requested_mode`, `dispatch_effective_mode`, `selected_lane`, `dispatch_selected_chunk_size`, `dispatch_allow_mode_override`, `service_class`, plus the normalized plan fields (`recommended_mode`, `recommended_lane`, `recommended_chunk_size`, `requires_*`, `plan_ms`).
- `/plan` request body forwarded: `{ url, mode, max_chunk_pages, force_chunking }`.
- `get_artifacts` response keys (C2.1): `pdfDiagnosticsSignedByPath`, `pdfPageArtifactSignedUrls`, `pdfDiagnosticsSignedUrlTtlSeconds` (TTL = 3600s).
- Signed-URL kind map keys: `` `${pageNo}:${kind}` `` for kind ∈ {`source`,`raster`,`docling`,`blocks`,`ocr`,`tables`,`pictures`,`vectors`,`summary`}.
- Page manifest fields: `per_page_docling_manifest_path`, `per_page_docling_artifact_version`, `artifact_contract_version`.

---

## Static + negative-contract gates (executed)

| Gate | Result | Evidence |
|---|---|---|
| `tsc -p tsconfig.app.json --noEmit` | **PASS** | exit 0 |
| Focused C1/C2 + negative unit tests (`vitest`) | **PASS** | 5 files / **26 tests** pass |
| Changed-file lint (`eslint`) | **PASS** | 0 errors (1 pre-existing warning at `extractPdfViaDocling.ts:249`, unrelated to C1/C2) |
| PDF import release gate (`:no-build`) | **PASS** | PASS_WITH_WARNINGS, **100/100**, 0 fail |

---

## Requirement PASS/FAIL table

| # | Requirement | Result | Basis |
|---|---|---|---|
| 1 | Plan V2 request (mode + chunking forwarded to `/plan`) | **PASS (static)** · live BLOCKED | code forwards `{url,mode,max_chunk_pages,force_chunking}`; runtime send not observable (undeployed) |
| 2 | Plan V2 response validation | **PASS** | `normalizePlanV2` unit tests: malformed/incomplete/unknown mode+lane → structured rejection |
| 3 | Routing persistence (modes/lane/chunk/version/timing/service class) | **BLOCKED** | requires deployed columns; `plan_payload` write path is coded + reviewed |
| 4 | Correlation (`template_import_id` both directions) | **BLOCKED** | column absent in live DB; frontend→dispatcher threading is coded |
| 5 | Cache parity (artifact-complete cache hit) | **BLOCKED** | requires deployed dispatcher + a completed source job |
| 6 | Cache isolation (redaction + all options partition the key) | **PASS (unit)** · live reuse BLOCKED | `buildCacheContractFingerprintInput` tests prove redaction + every option change alters the key |
| 7 | Signed artifact delivery (maps + TTL + per-kind fetch) | **BLOCKED** | deployed `template-import-pdf` (v54) predates C2; maps not returned at runtime yet |
| 8 | Chunk parent-global artifact smoke (incl. OCR/vector paths) | **BLOCKED** | requires a completed chunked job on the deployed C2 finalizer |
| 9 | Legacy compatibility | **PASS** | tests: legacy pages without OCR/vectors remain usable and never fail validation |
| 10 | Negative-contract handling | **PASS** | Test G: invalid plan → conservative fallback + audit; invalid page manifest cannot be selected as preferred source |

---

## Tests A–G

- **Test A (fresh import)** — **BLOCKED.** No authenticated live import executed: C1 dispatcher undeployed; running against prod tests stale code + mutates prod; gate forbids using the parse-service token.
- **Test B (cache-hit parity)** — **BLOCKED.** Depends on A + deployed cache path.
- **Test C (privacy/cache isolation)** — **PARTIAL PASS.** The fingerprint contract is proven at unit level: redaction (`redact=0/1`) and every artifact-affecting option participate. Live reuse isolation BLOCKED (undeployed).
- **Test D (signed artifact delivery)** — **BLOCKED.** Deployed `get_artifacts` (v54) does not yet return the signed maps; no authenticated client contract available in this environment.
- **Test E (parent-global chunk smoke)** — **BLOCKED.** No completed chunked job on the deployed C2 finalizer.
- **Test F (correlation)** — **BLOCKED.** `template_import_id` column not present in the live DB.
- **Test G (negative contracts)** — **PASS.** C1 malformed/incomplete/unknown-mode/lane and C2 invalid-manifest/preferred-source rejection all covered by the 26 passing tests.

> Note on Test G "unknown-version" plan: the sidecar `/plan` body carries no self-declared version field — the contract version is assigned by the dispatcher at the boundary — so any unrecognized/malformed structure is handled by the same conservative-fallback path rather than a separate version check.

---

## Stop conditions encountered

1. **C1 migration `20260716120000` is not applied** to `dduzbchuswwbefdunfct` (live head `20260715145228`).
2. **New `pdf_import_jobs` columns are absent** in the live schema.
3. **Deployed Edge Functions predate C1/C2** (all `2026-07-15`), so the dispatcher/callbacks/importer under test are not running.
4. Gate rules forbid deploying, using the parse-service token, or mutating production — and the live imports are operator-driven (joint gate) — so Tests A/B/D/E/F cannot be executed from this environment.

---

## Remediation package (narrowly scoped — not executed)

To convert R0 to a full PASS, perform the following in a **non-production / Supabase branch** environment (never production during R0), then re-run the live section:

1. **Apply migration** `20260716120000_pdf_import_c1_plan_correlation_cache.sql` (adds `template_import_id`, `cache_contract_fingerprint`, `service_class` + indexes).
2. **Deploy Edge Functions** in Appendix-A order: `pdf-parse-dispatch` → `pdf-parse-callback` → `pdf-parse-chunk-callback` → `pdf-parse-recover-stuck-jobs` → `template-import-pdf` → `pdf-import-diagnostics`; then the frontend build.
3. Keep the **current Cloud Run sidecar** (`pdf-parse-service`, `australia-southeast1`) — R0 validates dispatcher/importer contracts against the *existing* sidecar; G1/G2/G3 are separate.
4. **Operator runs Tests A–F** through the authenticated app against that environment: one small selectable-text PDF (A–D, F), then a document above the chunk threshold (E), capturing the redacted evidence fields defined in each test.
5. Re-run this R0 live section; on green, mark **R0 PASS** and unblock **C3**.

Until then: **C3 is gated by R0.** (C3's logic is frontend-only and does not depend on the deployed dispatcher, so it *could* be developed in parallel at the user's discretion, but formal R0 sign-off requires the live run above.)

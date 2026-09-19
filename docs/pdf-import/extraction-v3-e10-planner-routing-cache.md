# PDF Extraction V3 · E10 — Planner V3, Service Routing, Cache Safety and Deterministic Recovery

> **Status:** CODE ONLY · additive · shadow-mode · fully backward compatible · **not** wired into the
> live parse path · no deploy. Every prior E-package guarantee (E0–E9) is preserved unchanged.

E10 introduces a **deterministic Planner V3 and execution-control architecture**: one immutable
plan derived from a fixed set of inputs, a logical service-class routing layer that is separate from
physical service URLs, a V3 cache-safety contract that can never reuse a V1/V2 cache and never
serves an artifact-incomplete hit, and a deterministic recovery planner. All of it is expressed as
**pure, import-safe modules** with **cross-runtime byte-identical identities** (Python sidecar ⇄
TypeScript edge/frontend).

---

## 1. The core invariant

> **Same source + same requested output + same planner inputs + same provider policy + same service
> registry + same implementation versions ⇒ the SAME plan id, plan hash, page classifications,
> service routes, provider policy, chunk plan and cache fingerprint.**

Two derived rules make the plan *immutable*:

- **A retry never changes the plan.** Re-running the planner with identical inputs reproduces the
  identical `plan_id` / `plan_hash`. An `ExecutionAttemptV1`'s `attempt_index` and `outcome` are
  recorded for audit but are **excluded from every identity hash**.
- **A reroute always creates a NEW plan.** Any change to the registry, routing policy, provider
  policy, planner inputs or planner implementation version produces a new `plan_id` / `plan_hash`.
  Recovery signals `reroute` and the caller **builds a fresh plan** — it never mutates the old one.

---

## 2. Thirteen versioned contracts

| Contract | Version string | Module (Python / TS) |
|---|---|---|
| Preflight | `pdf-extraction-preflight-v1` | `planner_v3/preflight.py` · `pdfExtractionPlanV3.pure.ts` |
| Page complexity | `pdf-page-complexity-v1` | `planner_v3/complexity.py` · `pdfExtractionPlanV3.pure.ts` |
| Plan V3 | `pdf-extraction-plan-v3` | `planner_v3/plan.py` · `pdfExtractionPlanV3.pure.ts` |
| Service-class registry | `pdf-service-class-registry-v1` | `planner_v3/service_registry.py` · `pdfServiceRoutingV1.pure.ts` |
| Service routing policy | `pdf-service-routing-policy-v1` | `planner_v3/routing.py` · `pdfServiceRoutingV1.pure.ts` |
| Route decision | `pdf-service-route-decision-v1` | `planner_v3/routing.py` · `pdfServiceRoutingV1.pure.ts` |
| Execution target | `pdf-execution-target-v1` | `planner_v3/routing.py` · `pdfServiceRoutingV1.pure.ts` |
| Execution attempt | `pdf-execution-attempt-v1` | `planner_v3/contracts.py` · `pdfServiceRoutingV1.pure.ts` |
| Cache fingerprint V3 | `pdf-cache-fingerprint-v3` | `planner_v3/fingerprint.py` · `pdfCacheFingerprintV3.pure.ts` |
| Cache entry V3 | `pdf-cache-entry-v3` | `planner_v3/fingerprint.py` · `pdfCacheFingerprintV3.pure.ts` |
| Artifact completeness | `pdf-artifact-completeness-v1` | `planner_v3/completeness.py` · `pdfArtifactCompletenessV1.pure.ts` |
| Recovery plan | `pdf-recovery-plan-v1` | `planner_v3/recovery.py` · `pdfRecoveryPlanV1.pure.ts` |
| Routing audit | `pdf-routing-audit-v1` | `planner_v3/audit.py` · `pdfExtractionPlanV3.pure.ts` |

The planner also carries `PLANNER_V3_IMPLEMENTATION_VERSION = planner-v3-impl-1`; any change to how
inputs map to a plan **must** bump it so plan ids and cache fingerprints partition.

---

## 3. Logical service classes ≠ physical URLs

A **service class** is a capability contract, never a host:

| Class | Region (logical) | Remote | GPU | Native | OCR | Tables | VLM | Raster |
|---|---|---|---|---|---|---|---|---|
| `fast_cpu` | local | ✗ | ✗ | ✓ | ✗ | ✓ | ✗ | ✓ |
| `heavy_cpu_au` | australia-southeast1 | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ |
| `docai_au` | australia-southeast1 | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | ✗ |
| `vlm_gpu_sg` | asia-southeast1 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `raster_only` | local | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |

The plan names a **class**. A physical `ExecutionTargetV1` binds the class to a **logical target
reference** (an env/secret key the runtime resolves to a host) — **never a literal URL or credential**
— and target resolution is deliberately **excluded from plan identity**. The same immutable plan can
therefore run against blue/green, region-failover or local-emulator hosts without changing its id.

---

## 4. Deterministic pipeline

```
source signals ─▶ buildPreflight ─▶ classifyPages ─▶ routePages ─▶ buildChunkPlan
                     (immutable)      (per page)      (fail-closed)   (bounded runs)
                                                          │
                          classificationDigest ─┐         │
                                    routeDigest ─┼─▶ computeCacheFingerprint (pf3-…)
                                                          │
                                                   buildPlanV3 ─▶ plan_id = plan3-<fnv1a32(core)>
```

- **Preflight** is the single, source-derived truth the planner consumes; identical sources yield an
  identical preflight (page signals are sorted, ratios clamped).
- **Complexity** classifies each page into exactly one tier — `native_simple`, `native_rich`,
  `scanned`, `design_heavy`, `unreadable` — with derived `requires_ocr/tables/raster/vlm`.
- **Routing** picks a *desired* class from complexity, then a *resolved* class after fail-closed
  policy gating; adjacent same-resolution pages merge into one decision.
- **Chunk plan** cuts each contiguous route run into bounded (`max_chunk_pages` ∈ [1,50]) chunks,
  preserving the resolved class.
- **Plan id/hash** are `fnv1a32` over the sorted-key compact JSON of the plan *core*, so identity and
  content can never disagree.

---

## 5. Fail-closed routing

Remote (`docai_au`, `vlm_gpu_sg`) and GPU (`vlm_gpu_sg`) classes are **never routable** unless the
routing policy independently approves **each** risk:

1. the class is in `enabled_classes`;
2. `remote_classes_enabled` (for remote classes);
3. explicit remote approval when `require_explicit_remote_approval`;
4. the class's region is in `approved_regions` (data residency);
5. `gpu_classes_enabled` (for GPU classes);
6. the per-job page budget (`max_remote_pages_per_job` / `max_gpu_pages_per_job`) is not exceeded.

The **default policy** enables only `fast_cpu`, `heavy_cpu_au`, `raster_only`; remote and GPU are
disabled with zero budget. A blocked desired class **degrades deterministically** down the ladder
`heavy_cpu_au → fast_cpu → raster_only` (never elevates), and the worst case is `raster_only` — a
truthful pixel page, never a silently elevated class or a false success.

---

## 6. Cache safety V3

`computeCacheFingerprint` folds in **every plan-affecting input** — the C1 `pdf-cache-contract-v2`
fields (source hash, requested/effective mode, redaction, description tier, markdown/doctags, raster
format/DPI, engine/artifact/lane versions, provider) **plus** the Planner V3 additions (registry id,
routing policy id, provider policy id, planner impl version, classification digest, route digest).

Two hard rules:

1. **No V1/V2 reuse.** The fingerprint payload is namespaced by `pdf-cache-fingerprint-v3`;
   `isReusableContract` rejects any non-V3 contract, and the validators reject the legacy contract
   strings `parse-cache-safety-v1` / `pdf-cache-contract-v1` / `pdf-cache-contract-v2` outright.
2. **A hit must be artifact-complete.** `evaluateCacheHit` admits a candidate only when the contract
   is exactly V3, the fingerprints match, **and** the entry is artifact-complete. Anything else is a
   **miss** with a specific bounded reason (`cache_reuse_forbidden_legacy_contract`,
   `cache_miss_no_fingerprint_match`, `cache_miss_incomplete_artifacts`) — never a partial hit.

Redaction still partitions the cache (a redacted request can never satisfy a non-redacted entry, the
C1 privacy invariant), now reinforced by the V3 namespace.

---

## 7. Artifact completeness

`evaluateArtifactCompleteness` computes the required artifact set per page from its resolved
capabilities (`raster` always; `docling`+`blocks` for native; `+ocr` when OCR; `+tables` when
tables; **only** `raster` for `raster_only`/`unreadable` pages). An artifact counts as present only
when it is a **durable object reference** — a signed URL / absolute path / traversal where a durable
ref belongs is both a completeness failure **and** a recorded `signed_url_leak_pages` entry. The
report is deterministic (`report_id`) and is the single gate the cache layer and finalizer consult.

---

## 8. Deterministic recovery

`planRecovery` chooses **one** next action from the attempt history, source-raster presence and error
class:

- **transient error, budget remaining** → `retry_same_route` (same plan, same route);
- **deterministic error / budget exhausted** → `reroute` down the ladder
  (`vlm_gpu_sg`/`docai_au` → `heavy_cpu_au` → `fast_cpu` → `raster_only`) — the caller **builds a new
  plan**;
- **floor reached, source raster present** → `fallback_raster_only`;
- **floor reached, no source raster** → `abort_manual_review` (`recovery_abort_no_source_raster`) —
  never a false fallback claim.

Recovery is a pure function (no wall-clock, no randomness) and carries a deterministic `recovery_id`.

---

## 9. Cross-runtime parity

The Python `planner_v3` package and the TypeScript `_shared` modules use the same canonical
sorted-key compact JSON. Non-security identifiers retain the existing FNV-1a-32 compatibility
scheme, while the security-sensitive cache fingerprint uses SHA-256. Both runtimes emit
**byte-identical** identities for ASCII inputs. The TS spec embeds Python-produced anchors:

| Identity | Value |
|---|---|
| `fnv1a32("abc")` | `1a47e90b` |
| default registry id | `svcreg-52451c5f` |
| default routing policy id | `svcpol-f3fd6a52` |
| mixed-doc plan id | `plan3-a8ce0afb` |
| mixed-doc plan hash | `a8ce0afb` |
| mixed-doc cache fingerprint | `pf3-aab8d89ced1d9f08a7250086264be2968872c18c6fdf76c0dbee39ab28aa067b` |
| mixed-doc routing audit id | `raud-ee8cfe89` |

---

## 10. Import-safety & security posture

- Importing `planner_v3` (or any module) loads **no** torch / docling / fitz / pymupdf / Google SDK,
  opens no file, reads no secret, performs no network I/O (asserted in `test_e10_planner_v3.py`).
- No identity hash includes a timestamp, signed URL, credential, temp path, UUID, job id or retry
  counter.
- Remote/GPU/Document-AI/VLM routing is **disabled by default** and gated fail-closed; nothing here
  activates any external provider, deploys anything, or mutates production state.
- Persisted-shape validators reject signed URLs, raw payloads, non-finite numbers, wrong versions and
  legacy cache contracts.

---

## 11. Files

**Python** — `pdf-parse-service/planner_v3/`: `__init__.py`, `contracts.py`, `service_registry.py`,
`preflight.py`, `complexity.py`, `routing.py`, `plan.py`, `fingerprint.py`, `completeness.py`,
`recovery.py`, `audit.py`, `validators.py`, `fixtures.py`; tests `test_e10_planner_v3.py` (19).

**Shared TS** — `supabase/functions/_shared/`: `pdfServiceRoutingV1.pure.ts` (foundation +
identity), `pdfExtractionPlanV3.pure.ts`, `pdfCacheFingerprintV3.pure.ts`,
`pdfArtifactCompletenessV1.pure.ts`, `pdfRecoveryPlanV1.pure.ts`. Frontend re-exports under
`src/lib/reportTemplate/pdfImport/`; spec `src/lib/reportTemplate/__tests__/pdfExtractionPlanV3.pure.spec.ts` (19).

**Docs** — this file + `extraction-v3-e10-cloud-handoff.md`.

---

## 12. What E10 does NOT do

No live-path wiring, no dispatcher change, no migration, no Edge Function deploy, no Cloud Run change,
no IAM/Secret/API change, no Document-AI/VLM/remote invocation, no production data/storage mutation.
E10 is a self-contained, deterministic contract layer ready to be adopted behind an explicit
feature-gate in a later package once the physical multi-service topology exists (see the cloud
handoff doc).

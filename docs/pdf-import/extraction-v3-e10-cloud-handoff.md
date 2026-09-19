# PDF Extraction V3 · E10 — Cloud Handoff (manual, human-operated)

> **Audience:** the human operator who owns Google Cloud + Supabase. **Claude never performs any of
> the steps in this document.** E10 shipped **code only**, shadow-mode, not wired into the live parse
> path. This doc describes what a human must do — later, deliberately, out of band — to bind the
> Planner V3 *logical* service classes to *physical* execution targets, and the invariants that must
> hold before any such activation.

Nothing here is a deployment instruction Claude will execute. It is a checklist and a contract for the
owner.

---

## 1. What E10 handed off

A deterministic Planner V3 that emits, per import:

- an immutable `PdfExtractionPlanV3` (`plan_id` / `plan_hash`);
- per-page complexity classifications;
- fail-closed **route decisions** naming **logical service classes** (`fast_cpu`, `heavy_cpu_au`,
  `docai_au`, `vlm_gpu_sg`, `raster_only`);
- a bounded chunk plan;
- a V3 cache fingerprint + cache-entry contract;
- an artifact-completeness gate;
- a deterministic recovery plan;
- a PII-safe routing audit.

It does **not** call any service. Route decisions name a class; binding a class to a host is the
operator's job (below).

---

## 2. Logical class → physical target binding (operator-owned)

A class is bound to a **logical target reference** — an env/secret **key**, never a literal URL — via
`resolveExecutionTarget(serviceClass, registry, availableTargetRefs)`. The operator provides the
`availableTargetRefs` map at run time from the deployed topology, e.g.:

| Logical class | Target ref (key, operator-defined) | Physical binding (operator-owned, NOT in repo) |
|---|---|---|
| `fast_cpu` | `PDF_TARGET_FAST_CPU` | Cloud Run fast CPU service (existing) |
| `heavy_cpu_au` | `PDF_TARGET_HEAVY_CPU_AU` | Cloud Run heavy CPU service, australia-southeast1 |
| `docai_au` | `PDF_TARGET_DOCAI_AU` | Document AI processor, australia-southeast1 (opt-in) |
| `vlm_gpu_sg` | `PDF_TARGET_VLM_GPU_SG` | GPU VLM service, asia-southeast1 (opt-in) |
| `raster_only` | `PDF_TARGET_RASTER` | local raster path (no external call) |

The literal hosts / processor ids / credentials live **only** in Cloud Run env/secrets and Supabase
secrets — never in the repo, never in a plan, never in a hash. A missing binding yields
`available:false`; the recovery layer degrades accordingly.

---

## 3. Pre-activation invariants (must all hold before wiring E10 into the live path)

1. **Determinism proven end-to-end.** The same source + request + config must reproduce the same
   `plan_id` on both the sidecar and the edge (already proven byte-for-byte in tests; re-confirm
   against the deployed sidecar's real preflight signals).
2. **Cache isolation.** No V1/V2 cache row can satisfy a V3 request; a V3 hit is artifact-complete;
   redaction partitions the fingerprint. Verify against a real cached corpus before enabling V3
   lookups.
3. **Fail-closed defaults.** Remote (`docai_au`), VLM/GPU (`vlm_gpu_sg`) and Document AI stay disabled
   until the routing policy explicitly enables the class, the region residency, the approval flag and
   the per-job budget — each independently. This mirrors the E9 provider fail-closed posture.
4. **Data residency.** `docai_au` / `heavy_cpu_au` are australia-southeast1; `vlm_gpu_sg` is
   asia-southeast1. Do not add a region to `approved_regions` without a data-residency sign-off.
5. **Recovery has a source raster.** A `raster_only` fallback requires a durable source raster;
   without one, recovery aborts to manual review — never a false fallback claim.

---

## 4. Manual Google Cloud steps the operator owns (Claude does NONE of these)

- Inventory the currently-deployed sidecar revision before any change (region, digest, SA,
  ingress/auth, CPU/mem/concurrency/timeout, VPC, env-var *names* + secret bindings, traffic split).
- Provision any *new* physical service classes (heavy CPU AU, GPU SG, Document AI processor) as
  **separate** Cloud Run services / processors, each with its own SA, residency and budget.
- Populate the `availableTargetRefs` bindings via `--update-env-vars` / `--update-secrets` (never
  `--set-env-vars` on a live service).
- Canary (no-traffic tagged revision → smoke → 5% → 100%), keep the previous revision for rollback.
- Only after R-gate style verification, enable the corresponding classes in the routing policy.

Explicitly out of scope for Claude and **not** performed by this package: `gcloud`, Cloud Build,
image push, Cloud Run deploy/traffic/env/IAM/secret changes, enabling Google APIs, creating or
invoking Document AI processors, invoking a remote VLM or any external provider, applying a Supabase
migration, deploying Edge Functions, changing Supabase secrets, mutating production DB rows or Storage
objects, running production imports, activating multi-service or remote-provider routing.

---

## 5. Supabase / edge adoption (a LATER package, behind a feature gate)

When adopted, the dispatcher would (behind an explicit, default-off gate):

- build the preflight from the sidecar's existing plan signals;
- call `buildPlanV3` to get the immutable plan + V3 fingerprint;
- attempt a V3 cache lookup via `evaluateCacheHit` (artifact-complete only);
- persist the plan id/hash + routing audit alongside the existing Plan V2 record (additive columns);
- resolve each chunk's class to a target ref and dispatch;
- on failure, consult `planRecovery` and, on `reroute`, build a **new** plan.

Until that gate is built and turned on, the live path is unchanged and every E0–E9 guarantee holds.

---

## 6. Rollback

Because E10 is additive shadow code with no live wiring, "rollback" of E10 itself is trivial: the code
is never on the hot path until a future feature-gate turns it on, and that gate is the single control
point. Physical service rollback (Cloud Run revisions, Document AI, GPU service) follows the standard
sidecar runbook and is entirely operator-owned.

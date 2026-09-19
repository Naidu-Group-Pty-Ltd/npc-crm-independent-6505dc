# PDF Extraction V3 — Release-Candidate Runbook (operator-owned, non-executing)

> **Audience:** the human operator who owns Google Cloud + Supabase. **E12 executes NONE of these
> steps.** This runbook describes the future, deliberate, out-of-band sequence that turns "code
> certified by generated evidence" into "verified in a zero-traffic revision, then canary, then
> production." Every gate below can BLOCK; on any failed gate, roll back.

## 0. Preconditions

- E0–E12 merged; the `generated-full` gate green in a capable CI environment; the private-controlled
  gate green in the protected environment (both are operator-run — see the E12 gates workflow).
- Readiness decision (`pdf-release-readiness-v1`) shows `codeReady` and `generatedCorpusReady` true;
  `zeroTrafficRuntimeReady` / `canaryReady` / `productionPromotionReady` are `null` until this runbook
  produces their evidence.

## 1. Merge E12

Merge the E12 PR. No infrastructure changes.

## 2. Run the generated-full gate (CI, capable environment)

`npm run pdf-import:v3:gate:full` on a runner with Chromium + Docker. Requires: every generated fixture
family, 25/80-page completion, determinism double-run, browser/export parity, performance baseline,
local container gate. Must be `pass` + `releaseReady`.

## 3. Run the private controlled gate (protected environment, manual dispatch)

Dispatch `pdf-extraction-v3-gates.yml` with `tier=private` in the protected `pdf-v3-private` environment
(reviewer approval; no fork access). The private source resolver key is read from a protected secret at
runtime; the private 13-page report and its images are NEVER uploaded; only a sanitized report is
retained. The 13-page checklist (page count, chart visibility, independent tables, no generic headers /
clipped rows / fused ranges / wrong-cell values, browser/export parity, score ≥ 0.95, ≤ 2 repair
passes, complete audits) must pass.

## 4. Build the consolidated sidecar image (Cloud Shell, operator)

Build ONE image from the current repo containing the E3–E10 runtime Python (source_scene_graph,
table_candidates, table_integrity, source_typography, font_assets, providers, planner_v3, runtime
adapters, app/app_vnext). No repository source mount at runtime; imports resolve from the installed
container path; no `/workspace` on the Python path; no Google SDK for the standard target; no VLM model
download; remote providers disabled. Record the **immutable image digest**.

## 5. Deploy a zero-traffic revision (operator)

Deploy the image as a **no-traffic** tagged Cloud Run revision (existing `fast_cpu` service, region
australia-southeast1). Preserve SA / VPC / ingress / concurrency / timeout / memory. No traffic shift.

## 6. Run the zero-traffic runtime gate (operator, future Tier 5)

Against the tagged revision URL (supplied at runtime, never committed): verify endpoint + accepted
service class, `/`, `/openapi.json`, `/capabilities`, `/plan`, parse a generated fixture, artifact
contract, runtime/provider identity, E3–E10 artifacts, no source mount, imports resolve from the
container package, immutable digest. No production traffic.

## 7. Run the generated canary corpus (operator)

Run the generated corpus against the candidate revision; compare to the baseline production revision.

## 8. Run the approved private canary (operator, only when authorized)

Only with explicit approval + the protected environment. Sanitized evidence only.

## 9. Review E11 diagnostics (operator)

Use the E11 review workspace / admin diagnostics to inspect candidate imports (hard defects, output
strategy, provider/cache/routing) before shifting traffic.

## 10. Promote incrementally (operator, future Tier 6)

Canary promotion requires: every mandatory release report pass; zero unresolved hard defects; zero
artifact incompleteness; no route/callback drift; no unacceptable performance regression; no
privacy/policy violation; a recorded rollback target; operator approval. Shift 5% → 100% only as each
gate passes.

## 11. Rollback

On any failed gate, shift traffic back to the previous revision (recorded rollback target) immediately.
E12 changed no traffic and created no resource, so rolling back the CODE is a no-op — the control point
is this operator-owned deployment sequence.

## Optional services (remain unavailable until separately proven)

`heavy_cpu_au`, `docai_au`, `vlm_gpu_sg` are NOT enabled by E12 and must not be activated here without
their own residency/approval verification. Do not claim Australia/Singapore target availability without
later verification.

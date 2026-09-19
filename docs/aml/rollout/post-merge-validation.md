# Post-merge validation record — PR #1912 → main

Date: 2026-08-04 (UTC). Scope: urgent post-merge validation, remediation
and regression audit after PR #1912 (the Phases 1–9 AML/CTF partner
programme) merged into `main` as `515195d11cdef1c82f6f55d48d7f75cd48189a04`
(first parent `cc80bb814`, programme head `c2215141a`). Fixes from this
audit live on `claude/aml-post-merge-validation-hotfix` (draft PR — never
merged automatically).

## 1. Merge integrity

- `origin/main` == the merge commit; zero commits landed after it during
  the audit.
- Every AML-owned path (migrations, `aml-reliance`, `aml-records`,
  `cross-portal-outbox-worker`, `_shared/aml/*`, partner UI, rollout docs,
  rehearsal harness) is **byte-identical** between the audited programme
  head `c2215141a` and merged `main` (`git diff` empty on all of them).
- Main's thirteen pre-merge commits (registry backfill `90ed9b88f`,
  tiered-entitlements navigation redesign PR #1905, and others) did not
  modify AML content; the merge produced exactly one semantic conflict
  artefact — see defect DEF-1.

## 2. Deployment audit — did the merge deploy or activate anything?

**Classification: A — CODE MERGED ONLY.** No containment was required.

| Channel | Evidence | Outcome |
| --- | --- | --- |
| `deploy-supabase-functions.yml` | Merge-triggered run 30956155790: the "Check for a deploy credential" gate found no `SUPABASE_ACCESS_TOKEN`; setup-cli and Deploy steps concluded **skipped** | **No function deployed** |
| Database migrations | No workflow, script or config in the repository applies migrations to any environment | **No migration applied by the merge** |
| Feature flags | Flags are jsonb rows seeded by migrations; no automation flips them; every programme flag seeds `'false'::jsonb` | **Nothing enabled** |
| Worker scheduling | No scheduler exists in-repo for `cross-portal-outbox-worker`; Phase 6 docs record scheduling as an operator action | **Not scheduled** |
| `aml-sanctions-refresh.yml` | Pre-existing daily cron; without `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` it runs `--dry-run`; three post-merge runs completed in ~35–45 s consistent with dry-run | Unchanged by the merge; secret presence **UNKNOWN — NOT VERIFIED** |
| Frontend publication | No in-repo deploy config; Lovable/gpt-engineer bot history suggests possible external auto-publish | **UNKNOWN — NOT VERIFIED**; even if published, partner surfaces fail closed server-side and the backing functions are undeployed |

Per-environment migration state, function versions and live flag values
cannot be read from this environment and are recorded as
**UNKNOWN — NOT VERIFIED** (file presence is never deployment truth). No
evidence anywhere showed an AML flag true, so no containment flag flip was
performed.

## 3. Defect register

| ID | Defect | Classification | Resolution |
| --- | --- | --- | --- |
| DEF-1 | `SECURITY_REGISTRY.json` carried **duplicate `"aml-reliance"` keys** after the merge — the programme's entry (`verify_jwt:false`, `public-auth`) plus main's wp14 backfill entry (`verify_jwt:true`, `human-authenticated`). JSON key shadowing made the wrong later entry win: the registry checker reported drift against `config.toml` (the deployment authority, correctly `verify_jwt=false`) and the attestation-v2 contract test failed (615/616) | Confirmed implementation defect (merge artefact) | Deduplicated to a single correct entry (`verify_jwt:false`, `exposure_class:"public-auth"`, `reviewed_in:"aml-post-merge-validation"`). Registry checker: **412 entries, 0 findings**; suite back to 616/616 |

No other confirmed defect was found. No speculative change was made. The
registry file is documentation/CI-gate state — nothing about the fix
touches runtime behaviour, and `config.toml` (unchanged, correct) remains
the deployment authority.

## 4. Functional audit highlights (Phases 1–9 on merged main)

- Record classifications re-proven in source and on a live chain: raw ID
  copy **P3**, legal hold **P4**, suspicious-matter material **P5**,
  raw biometric **P6**; the correction migration self-verifies and raises
  on any other state.
- Evidence delivery: full ordered authorisation before storage resolution;
  TTL 300 s; rate limit 10/min/membership; the signed URL exists only in
  the response body — access logs and case events record the expiry
  timestamp, never the URL.
- Restricted classes are structurally undeliverable: prohibited codes are
  rejected at request creation, approval can only subset the requested
  codes, delivery requires an approved code, and the catalogue CHECK plus
  `evaluatePartnerExport` block P4/P5/P6 everywhere.
- All 16 programme flags seed false (14 `aml_partner_*` +
  `aml_arrangement_governance` + `aml_attestation_v2`);
  `aml_partner_service_blocking` is enforced nowhere; `revoke_grant` has
  no flag gate (MLRO role only). Note: the pre-existing platform switch
  `aml_ctf` is seeded enabled by July 2026 migrations — that predates and
  is untouched by this programme; `aml_purchase_ready_gate` /
  `aml_settlement_gate` seed `{"enabled": false}`.

## 5. Local database re-rehearsal (disposable, synthetic)

On a throwaway Postgres 16 container (destroyed afterwards): the full
60-file chain applied cleanly; schema verification showed the fourteen
partner flags false and corrected classifications; the behaviour battery
passed (RLS denial, flag-off = zero outbox writes, atomic trigger
emission, duplicate-enqueue collapse, tripwire and closed catalogue,
idempotent material change, one-shot revocation, claim → dead-letter →
replay, grant-less access logging, opaque delivery chain, no path column);
the rollback rehearsal reverted the two 20260828 migrations exactly per
their headers with earlier-phase objects intact, then reapplied cleanly;
the flag-order rehearsal proved layered enablement with service blocking
false throughout. The committed harness gained `00b-platform-stubs.sql`
so the chain is reproducible without ad-hoc fixes.

## 6. Regression matrix (post-fix, on merged main + DEF-1 fix)

| Gate | Result |
| --- | --- |
| AML vitest battery (39 files) | **616/616 PASS** |
| Full repo vitest (550 files) | 8892 pass / **35 fail — all 35 reproduce identically on pre-merge main `cc80bb814`**: zero AML regressions |
| Solicitor portal suite | 116/117 (1 known pre-existing) |
| Builder portal suite | 820/823 (1 known pre-existing types test; 2 nav literal tests broken by main's PR #1905 redesign — pre-merge, not AML) |
| Cross-portal contracts / sanctions | 4/4, 13/13 |
| security:registry | PASS — 412 entries, 0 findings (was failing pre-fix) |
| security:static / finance-handoff / feedback-campaign / edd-boundary / builder / solicitor | PASS |
| security:cors-contract | 3 findings (get-vapid-public-key, push-subscribe, push-unsubscribe) — known pre-existing, non-AML |
| security:solicitor-intelligence-authz | FAIL — **identical failure on pre-merge main**; pre-existing, out of scope |
| security:edge-check | TOOL-BLOCKED (repo-wide Deno type resolution needs the npm `openai` package used by ten non-AML functions). Compensating: direct `deno check` on all three AML functions and all nine `_shared/aml` modules — clean |
| deno check (AML functions + shared) / typecheck:builder-edge | PASS |
| `npm run build` | PASS |
| lint | AML paths: 0 errors. Repo: 44 errors, all outside AML paths, pre-existing |
| audit:style | Ratchet deltas zero versus pre-existing state |
| typecheck:portals | 1 known pre-existing failure (`SolicitorMatterDetail.tsx` TS2322) |
| Playwright synthetic pilot | **NOT RUN** — requires `AML_PILOT_BASE_URL` against a deployed synthetic stack; listed only. Skipped is not passed |

## 7. Rollout status

Unchanged by this audit: **IMPLEMENTATION COMPLETE — ROLLOUT BLOCKED.**
Blockers remain exactly those in `pilot-signoff-register.md` and
`legal-mlro-decision-register.md` (no sign-offs obtained, D1–D10 open, no
staging deployment or verification, production untouched). Merging to main
changed none of that: nothing is deployed, nothing is enabled, and no
partner-facing behaviour exists anywhere until an operator executes the
controlled-rollout runbook.

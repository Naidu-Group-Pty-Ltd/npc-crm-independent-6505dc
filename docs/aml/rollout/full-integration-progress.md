# Full-integration progress — Client Portal ↔ Command Center

Live checkpoint file for the production-integration mission. Updated at every
stage boundary and before any long-running suite.

## Identity

- Branch: `claude/aml-client-command-center-production-integration`
- Created from: `origin/main` @ `5979b30c2` (merge-base verified)
- Imported history: PR #1937 (6 remediation commits + main sync `9d3475ca5`)
  and PR #1938 (matrix + 2 migrations) via fast-forward — authorship and
  focused commits preserved; branch does NOT depend on either PR merging.
- PR: #1939 (draft, targets main) — see PR body for scope.
- Worktree: clean apart from work-in-progress files listed per stage below.

## Interrupted-work recovery (Stage 0)

- Container restart recovered cleanly: committed work was already pushed on
  the #1938 branch; the only uncommitted artefact was
  `supabase/functions/cross-portal-outbox-worker/verificationConsumer.ts`
  (untracked, 6.4 KB), backed up to the session scratchpad before any branch
  operation. The interrupted worker-dispatch wiring edit to the worker's
  `index.ts` had been rejected and was NOT present — index.ts is pristine.
- No staged or unstaged diffs existed (empty patches recorded).

## Stage status

- [x] Stage 0 — recovery + backup
- [x] Stage 1 — branch + PR
- [x] Stage 2 — import audit: all #1937/#1938 commits imported verbatim via
      fast-forward (nothing obsolete; the interrupted consumer file is being
      completed on this branch rather than imported blind)
- [x] Stage 3 — integration matrix (imported; updated as stages complete)
- [x] Stage 4/5 — canonical model + migrations 20260831000000/000100
      (imported; schema verified against production before they were written)
- [x] Stage 6 — attempt accounting (RPC-first with legacy fallback; commit 94430b470)
- [x] Stage 7 — transactional portal submission (readiness gate, in-flight
      dedupe, per-capture idempotency, trigger-emitted event; 94430b470)
- [x] Stage 8 — verification outbox consumer wired into the platform worker
      (claim guards, eligibility, technical/unusable/authoritative
      classification; 843f05aab)
- [x] Stage 9 — staff technical retry (retry_verification_processing;
      57c8be6a1); runProviderForCheck is the shared processing body
- [x] Stage 11 — client-safe readiness (available / temporarily_unavailable /
      manual_verification_required; selfie collection gated; 94430b470)
- [x] Stage 12/13/14 — closed action vocabulary + safe projection,
      transactional request notifications (trigger), v1 response contract
      (94430b470 + migration 20260831000100)
- [x] Stage 21 — canonical risk inputs + staleness (907fae425)
- [x] Stage 22 — server-derived journey in overview (57c8be6a1)
- [x] Stage 27 — 24 integration contracts added; AML glob 703/703; registry
      PASS; WP-14 ratchet unchanged (f0dffc93b)
- [x] Stage 28B — production-shaped rehearsal: three migrations applied,
      trigger emits identifier-only events once, duplicate capture raises
      23505 (portal maps to already_processing), attempts fn counts only
      authoritative outcomes with case isolation, request notification +
      event transactional, action-code CHECK enforced, rollback per headers
      + reapply clean; DB destroyed
- [x] Stage 28A — fresh-ledger rehearsal: NOT replayable (documented
      pre-existing failure at parent-ledger row 90/~600; platform issue)
- [x] Submission Review backend + UI — get_submission_review (complete
      immutable package) and accept/changes/document/clarification/escalate/
      supersede; own workspace section; next-best-action retargeted
      (73064daa9 + 56aed2366)
- [x] Document rejection + replacement — dual reasons (client-safe code
      required; internal note staff-only), lineage columns, replacement
      request raised automatically (73064daa9)
- [x] P3 IDV evidence references + P6 biometric governance —
      aml.idv_evidence_references with classification, legal hold, disposal
      status/evidence; object never duplicated (20260901000000)
- [x] Party reconciliation backend + UI — work items, provenance, no fuzzy
      merge (suggestion-only), rationale + cross-case denial
- [x] Party verification linking — canonical links only, simulated/
      non-authoritative refused, unlink reason enforced, panel derives state
- [x] Party-scoped screening orchestration — subjects, freshness window,
      reviewer-only adjudication, panel with queue/re-screen/adjudicate
- [x] Unified staff verification surface — one canonical section plus a
      collapsed read-only legacy panel; duplicate VerificationTab unmounted
- [x] Client Portal action buttons — closed vocabulary → internal step
      routing (no URLs), lifecycle chips, v1 response contract
- [x] Retention registrations — 11 new record types registered with
      necessity-based years=0 for raw ID copies and biometrics
- [x] Tests — 48 integration contracts; AML glob 727/727
- [x] Rehearsal B (continuation) — four migrations applied on a
      production-shaped DB; lineage, P3/P6 evidence without duplication,
      legal-hold blocking, disposal evidence, suggestion-only similarity,
      adjudication, link isolation, immutable v1 snapshot, 11 retention rows;
      rollback per header + reapply clean; DB destroyed
- [x] Provider deployable package + 13 runbooks
      (docs/aml/rollout/verification-service-deployment.md) — audit, secret-free
      config contract, honest limitation register
- [x] Browser E2E — RUN on staging branch yncczbrmicjebjepfave with real
      Chromium across 360x800 / 768x1024 / 1440x900 / 1728x864: linked case
      returns AML-STG-00001 with a 6-step server journey, genuine no-case
      returns null-case, revoked session 401 portal_session_invalid,
      cross-client case_id excluded. aml-client-portal deployed as v2 there;
      all four migrations applied; queued check emitted exactly one
      identifier-only outbox event; attempts counter correctly 0 while queued.
      Environment notes: Chromium needed the agent proxy plus a TLS 1.2 cap;
      synthetic session tokens were re-dated. Screenshots not captured — the
      probe asserts contracts through the browser rather than rendering the
      Lovable-hosted SPA, which has no staging build target.
- [x] DEFECT FOUND AND FIXED by that E2E: 20260831000100's notification
      trigger wrote category='aml' but the production CHECK (verified
      read-only) allows only general|deal|document|message|property, so with
      migration 3 applied NO client request could be created at all. Fixed by
      additive 20260901000100 (widen the CHECK), proved on a disposable DB:
      insert fails before, succeeds after with notification + event + queued
      status; regression test added.
- [ ] Stage 10 — self-hosted service DEPLOYMENT itself (infrastructure host,
      secrets, owner) — external
- [x] Full staff-side browser E2E of the new review/reconciliation surfaces —
      RUN against the rendered SPA served locally in staging mode (24 specs,
      four viewports); see the round record above for exactly what is real
- [ ] Stage 29/30 — staging + browser E2E (blockers recorded below)
- [ ] Stage 31 — monitoring/runbooks
- [ ] Stages 32–36 — commits/PR/gates/release (release expected BLOCKED)

## Repository-validation round (browser + rehearsal)

Starting point: branch head `4d4efa3d6`; `origin/main` had advanced to
`199485506`. Merged (not rebased) as `7fe648002`; the incoming diff touched only
`package.json`/`package-lock.json`, `src/assets/intakePack/*` and
`src/lib/ciAssessment/*` — no AML, portal, provider, migration, auth or storage
surface. `main` then advanced a further 17 commits during the round and was
merged again as `42a19dcbd` (commercial/industrial finance redesign and the
intake-pack viewer, plus five AML *test* files where `if (!d.ok)` became
`if (d.ok === false)` — type narrowing only). AML vitest 749 passed after that
merge. Worktree clean and pushed at each stage boundary.

### GitHub CI

Real PR checks ran on `b37941021`: `GitGuardian Security Checks`, `verify`,
`supply-chain`, `render-container`, `pdf-import-release-gate` and
`pdf-import-regression` all green; `security` failed on
`supabase/functions/listing-images/index.ts: 6 → 8` (WP-14 edge-typecheck
ratchet). **That failure is identical on `main`** at `199485506` — this PR's
merge base — and on the commits after it (run 31021092008, job 92357669102).
`listing-images` is not touched by this branch; the change that raised its
count, `1c2fcee14`, is on `main`. The base branch is red and this PR inherits
it. The baseline update belongs with that change, not absorbed into an AML PR,
so the PR is being left **draft** while it stands, with a human reviewer
requested so review can proceed regardless.

### Browser test environment

- The SPA is served **locally** (`npx vite --mode staging --host 127.0.0.1
  --port 8080`) with every Supabase literal retargeted at the non-production
  preview branch `yncczbrmicjebjepfave` by `vite-staging-target.ts`. Zero
  production references remain in any served module (asserted), a fixed STAGING
  banner is injected, and both specs fail if the browser makes any request to
  the production host.
- Credentials live only in a git-ignored `.env.local`. Nothing is committed.
- **Safety defect found in this tooling and fixed:** gating on the variables
  alone was not enough, because `loadEnv` reads the dotenv *file* — a plain
  `npm run build` on a machine with a `.env.local` produced a staging-pointing
  bundle carrying a STAGING banner. Activation now also requires
  `--mode staging`, and a default build is verified clean (0 staging refs, no
  banner).
- Client-portal journeys run against the **real** deployed `aml-client-portal`
  on that branch. Only the portal shell's `client-portal-verify` bootstrap is
  fulfilled locally, because its session select joins `public.clients`, a table
  the branch does not carry. That does not weaken the access-control
  assertions: `aml-client-portal` performs its own session lookup, so the
  revoked-session refusal is still a real 401 from the real backend.
- Staff journeys run against the **real rendered SPA** with the `aml-*` boundary
  served from fixtures shaped to the response contracts in
  `src/lib/aml/amlCasesApi.ts`. The staff functions are not deployed to the
  branch and ~25 of the `aml.*` tables they query do not exist there (the parent
  ledger is not replayable — see blockers). Staff *server* behaviour is covered
  by the production-shaped rehearsal below and by the contract suite; what the
  browser proves is the rendered UI, routing, dialogs, focus and layout.

### Browser findings (all fixed, all with regression contracts)

| Ref | Defect | Fix |
| --- | --- | --- |
| DEF-B1 | The portal's no-case empty state rendered the API status line "No AML onboarding case yet.", which reads like a fault | Client-facing copy returned by the server so every consumer shows the same words |
| DEF-B2 | A terminology payload without `terminology_overrides` flowed into state as `undefined`, so the next `t()` threw and AmlLayout's ErrorBoundary replaced the **whole Command Centre** with "Something went wrong" | Coerced at the boundary (`asOverrideMap`), `t` defensive |
| DEF-B3 / B7 | Absent timestamps rendered the literal "Invalid Date" to compliance staff, in the workspace header and the legacy verification history | One shared `displayDate`/`displayDateTime` helper; every date render in the six touched surfaces goes through it |
| DEF-B4 | An absent attempt number printed "attempt undefined of 3" | Clause omitted unless the number is finite |
| DEF-B5 | **Material.** `processing_status`, `attempt_consumed`, `provider_error_category` and the `retry_verification_processing` op existed server-side and were already on the wire, but no staff UI read them: a check stranded in `technical_failure` rendered as "Awaiting adjudication" and could not be retried at all | Processing state shown beside the identity outcome, attempt accounting stated, simulation labelled, provider readiness surfaced, **Retry processing** offered only for `technical_failure`/`dead_lettered` with the vocabulary shared so the client cannot drift from the server |
| DEF-B6 | Five icon-only shell controls (menu, search, theme, account, notification bell) had no accessible name at 360x800 | `aria-label` on each |
| DEF-B8 | The party-verification form's viewport-keyed 4-up grid clipped every label, the party-type value and the button text — at 1728px as well as 360px, because the panel sits in the workspace's narrow middle column | One column by default, two-up only when the panel is wide, action on its own row; a clipping assertion now runs at all four viewports |
| DEF-B10 | The party-type picker offered `beneficiary`, which `aml.party_verification_links_party_type_check` rejects — picking it produced a server error | Picker reduced to exactly the nine types the CHECK allows |

### Rehearsal finding (blocking, fixed)

| Ref | Defect | Fix |
| --- | --- | --- |
| DEF-B9 | **Blocking.** `attempt_number` was doing two incompatible jobs — row identity (`uq_aml_verification_attempt`) and the allowance ceiling (`CHECK BETWEEN 1 AND 3`). Deriving it from the consumed-attempt count made the next capture reuse the previous number, so 23505 fired and the portal answered "your verification is already being checked": **a client whose first capture was unreadable could never recapture.** Deriving it from the row count instead hit the 1..3 cap after three captures even when none consumed an attempt. Both reachable in normal operation | New additive migration `20260901000200_aml_capture_row_identity.sql` moves row identity to `capture_sequence`, lifts the cap to `>= 1`, and backfills; the portal derives the row sequence from rows and only reports `already_processing` on a genuine idempotency-key collision |

### Production-shaped rehearsal (disposable Postgres 16, destroyed)

65 migrations applied in order on a fresh database, then the sixth release
migration; 16 behaviour proofs, each of which raises on failure rather than
reporting success:

1. pre-fix probe: with `20260831000100` applied and the category fix absent, the
   AFTER-INSERT notification trigger aborts the whole insert — **zero** client
   requests creatable (the defect, reproduced).
2. request + notification + outbox event + `notification_status='queued'`, all in
   the insert's transaction.
3. event payload carries identifiers only — no name, no message body.
4. action-code CHECK closed.
5. exactly one identifier-only verification event; a duplicate capture raises
   23505.
6. attempt accounting: outage, unusable capture and simulation consume nothing;
   `attempts_used = 1` from the one authoritative outcome.
7. a superseded authoritative outcome stops counting.
8. `processing_status` CHECK closed.
9. five consecutive unusable captures then a sixth recapture, all with
   `attempts_used = 0` — and the old `used + 1` formula still collides, so the
   defect is genuinely reproduced rather than assumed.
10. document rejection/replacement lineage over two cycles; client-safe reason
    and internal note kept apart; no version removed.
11. P3 evidence reference; a legal hold blocks disposal
    (`blocked_by_hold`); disposal writes evidence; the classification
    vocabulary is closed to P3/P6.
12. similarity is suggestion-only — resolution stays `open` until confirmed.
13. necessity-based retention (`years = 0`) registered for raw ID copies and
    biometrics.
14. `review_status` closed; a superseded submission snapshot is unchanged.
15. party verification links stay inside their case.
16. screening adjudication recorded with a note.

Rollback was then executed from the six migration headers **verbatim**. Two
statements refused — restoring the 1..3 `attempt_number` cap and narrowing the
notification category — which is exactly the precondition each header
documents ("only safe once no party holds more than three capture rows" /
"only safe once no row uses category='aml'"). With those preconditions met the
same statements succeeded, leaving a fully rolled-back schema. All six
migrations then **reapplied cleanly** and every convergence check passed;
the 16 proofs were re-run green after the reapply. The database was destroyed.

## Staging backend materialisation round (Stage 4)

Live state at the start of this round, verified against GitHub rather than
assumed: branch head `8d8ee61b7` (matches the expected SHA), remote branch head
identical, `origin/main` at `0e0961968`, worktree clean, **0 commits behind main
and 28 ahead**, PR #1939 draft, `mergeable_state: unstable` (checks, not
conflicts), reviewer `mithrubanbupathy3-design` requested, **no submitted
reviews**.

### Correction to an earlier claim

The PR body previously said "~25 of the `aml.*` tables the staff functions query
do not exist" on the staging branch. **That was an unverified estimate and it was
wrong.** Measured: the staff functions reference 16 `aml.*` tables, of which 13
already existed. The real gap was **3** `aml` tables and **7** `public` tables.

### What was materialised (non-production branch `yncczbrmicjebjepfave`)

DDL copied verbatim from the production migration that owns each object, so the
staging shape matches production instead of being invented:

| Object | Source migration |
| --- | --- |
| `aml.aml_role`, `aml.event_category`, `aml.role_assignments`, `aml.case_events`, `public.has_any_aml_role`, `public.has_aml_role` | `20260716170455_b7407ffa…` |
| `aml.risk_assessments` | `20260716180637_ab42e934…` |
| `aml.plan_tiers`, `aml.tenant_settings` | `20260716194926_1979ae2f…` |
| `public.integration_delivery_attempts`, `public.integration_dead_letters` | `20260730220000_field_ownership_outbox_projections_phase6` |

`public.clients` is created as the **functional subset** the AML surface reads —
`CLIENT_SEARCH_SELECT` plus `is_active` plus the four columns
`client-portal-verify` joins — with each column's type taken from the production
definition. It is explicitly *not* a replica of the production table, which also
carries GHL-sync, address and financial columns no AML op touches.
`public.purchase_files` is id-only: `aml.cases.purchase_file_id` is nullable and
no staging scenario sets it.

### A second divergence found and fixed

`aml.verification_checks` on the staging branch was **not production-shaped**:
seven columns were missing — `requested_at`, `completed_at`, `updated_at`,
`provider_reference`, `failure_reason`, `verified_by`, `verified_by_type`.
Migration `20260901000200` orders its `capture_sequence` backfill by
`requested_at`, so it failed outright on staging. The table was aligned to the
production definition (`20260728120000_aml_verification_checks.sql`) rather than
weakening the migration for staging.

### All six release migrations now converge on staging

| Migration | Convergence check |
| --- | --- |
| `20260830000000_aml_check_execution_mode` | `identity_checks.execution_mode` present |
| `20260831000000_aml_canonical_verification_model` | `verification_checks.processing_status` + `aml.verification_attempts_used()` present |
| `20260831000100_aml_verification_outbox_and_request_notifications` | `client_requests.action_code` + both triggers (`trg_aml_verification_outbox`, `trg_aml_client_request_notify`) present |
| `20260901000000_aml_integration_completion` | `aml.idv_evidence_references` present, 11 retention rows |
| `20260901000100_aml_notification_category_fix` | category CHECK includes `'aml'` |
| `20260901000200_aml_capture_row_identity` | `uq_aml_verification_capture` present, `uq_aml_verification_attempt` gone, cap lifted |

24 `aml` tables now exist on the branch.

### The main-side `security` job needs TWO fixes, not one

`fix/listing-images-wp14-edge-typecheck` → **PR #1944** fixes the WP-14 failure
at source (not by moving the baseline): the seven `TS2345` from
`ReturnType<typeof createClient>` instantiating generics from their constraints
rather than their defaults, and one from `crypto.subtle.digest` requiring an
`ArrayBuffer`-backed view. `deno check` on that file goes 8 errors → 0 and the
baseline entry is lowered 6 → 0. **CI confirms WP-14 now passes.**

That unmasked a second pre-existing failure in the same job: step 12, the WP-12
internal-auth legacy-fallback gate, had been reported `skipped` because WP-14
failed ahead of it. It now runs and fails on three pre-existing violations in
`dispatch-marketing-reports` and `send-web-push` (both read
`x-internal-edge-secret` directly instead of routing through
`verifySignedInternal`). Confirmed 3 violations on a clean `origin/main` tree.
Not fixed here: the scanner's ALLOWLIST is for shared modules that *define* the
legacy surface, so adding two ordinary functions would be suppression; and the
real fix is an internal-auth migration on two unrelated cron paths whose failure
mode is silent breakage of marketing-report and web-push dispatch. Recorded on
PR #1944 for the owner of those functions.

## Final execution round — live state

| Field | Value |
| --- | --- |
| Branch | `claude/aml-client-command-center-production-integration` |
| Local SHA | `2a702b6ef` (+ this commit) |
| Remote SHA | same as local |
| `origin/main` | `5fab4bbaf` |
| Behind main | 2 at round start (main advanced during the round) |
| Worktree | clean |
| PR #1939 | draft, unmerged, no submitted reviews, reviewer `mithrubanbupathy3-design` |
| PR #1944 (WP-14 / listing-images) | draft, 4/5 checks green; `security` fails only on WP-12 |
| PR #1946 (WP-12 / cron dispatchers) | draft, opened this round |
| Staging project | `yncczbrmicjebjepfave` (non-production preview branch) |
| Staging schema | complete for the AML surface; all six release migrations converge |
| Deployed functions | `aml-client-portal` v2 only |
| Provider | not deployed |
| Worker | not deployed / not scheduled |
| E2E | client journey real against `aml-client-portal`; staff journey still fixture-backed |
| Rehearsal | passed previously on a disposable production-shaped DB |

### The `security` job was FOUR failures deep, not two

The earlier entry in this file said the job had "two independent failing steps".
**That was wrong, and it was wrong in a way worth recording**: the job is a
sequence of `bash -e` steps, so it only ever reports the *first* failure. Fixing
one revealed the next, three times.

| Layer | Step | Failure | Fixed by |
| --- | --- | --- | --- |
| 1 | Deno type-check every Edge Function entry point (WP-14) | `listing-images: 6 → 8` | PR #1944 |
| 2 | Internal-auth legacy-fallback gate (WP-12) | 3 findings, `x-internal-edge-secret` read directly | PR #1946 |
| 3 | Agent tool policy gate (WP-05A/05C) | **5 of its 18 scripts failing** — only the first was visible, because the whole step is one `bash -e` block | PR #1946 |
| 4 | *(none — added)* | nothing verified that a repaired gate still bites | PR #1946 |

All five in layer 3 were run against a clean `origin/main` worktree at
`5fab4bbaf` and fail there identically. None is caused by the AML branch.

#### Layer 3, diagnosed one at a time

Four of the five were **assertion drift**, not missing controls: the gate greps
for the exact line that implemented a property, the implementation was later
hardened, and the literal stopped matching. In three of those four, satisfying
the old literal would mean *reintroducing the weaker design*.

| Gate | Was asserted | Actually implemented now | Nature |
| --- | --- | --- | --- |
| `check-agent-tool-policies` | a superadmin could opt into a cross-user `agent_action_log` view | opt-in removed; `activity_logs` module gate **plus** an explicit superadmin role check that 403s; per-user scoping now **unconditional** | drift — code is stricter |
| `check-step-up-session-binding` | `bound_session_id: staffSession.id` | at assurance ≥ 2 the issuer **rotates** the staff session first, so the proof binds to the rotated id via `boundSessionId` | drift — old literal is now the bug |
| `check-storage-upload-hardening` | human `upsert=true` is refused | the flag is **ignored** instead (refusing broke callers that passed it defensively); path is server-generated and unique, `upsert` forced false for non-internal | drift — property intact |
| `check-market-digest-authz` | idempotency on `(period, period_start)` | key is `(period, period_key)`; early return narrowed to `status === 'published'` so a failed window is re-attempted; provider variable renamed, which had turned the ordering assertion into an **unconditional** failure | drift — property intact |
| `check-csrf-coverage` | every `verifyAuth` function invokes `enforceCsrf` | **2 of 6 had no CSRF enforcement at all** | **a real defect** |

The CSRF one was genuine. `agent-insights-runner` INSERTs into
`agent_insights_feed` and `notifications` and accepts a cookie-carried staff
session, so a cross-site POST was a cookie-authenticated **write**;
`agent-models-read` dispatches reads over POST and was reachable the same way.

Three others (`notifications-feed`, `notifications-feed-v2`,
`market-updates-archive`) had a local `csrfCheck` that is **stricter** than the
shared guard — smaller `EXACT_ORIGINS`, and no `CORS_ALLOW_LOVABLE_PREVIEW`
suffix widening. Delegating to the shared guard would have *widened* the origins
they accept, so the shared guard is composed **in front of** the local list as a
floor. No origin refused before is accepted now.

#### Layer 4 — the reason to believe layer 3

Re-pointing a drifted gate and quietly loosening it produce similar diffs, and
nothing in CI could tell them apart. `scripts/security/check-security-gate-negatives.mjs`
now does: for each control it runs the gate against a symlink mirror of the tree
with that control **removed**, and requires the gate to **fail**. Nine controls,
nine gates. A case whose anchor is no longer present fails loudly rather than
passing vacuously.

CI output on the green run:

```
Security gate negative tests passed (9 controls removed, 9 gates failed as required).
```

### The `security` job is now GREEN on a real SHA

Run [`31037583288`](https://github.com/lavan96/npc-property-dashbord/actions/runs/31037583288),
head `58cb46556`, job `security`: **success**, with every step executing through
to gitleaks (`no leaks found`) — not skipped. This is the first green `security`
job in this programme.

Because both fixes are needed together, **PR #1944 is merged into PR #1946**
(authorship preserved) so the job could be demonstrated green on one SHA rather
than argued about across two red PRs. #1944 stays open as the reviewed source of
the `listing-images` change and becomes redundant once #1946 lands.

### WP-14's counts are not deterministic — a new finding

`ci.yml` pins `deno-version: v2.x`, which floats. **Two runs of identical code
reached opposite verdicts:**

| Run | Head | WP-14 reported |
| --- | --- | --- |
| `31035705138` | `07cf77b16` | `409 entry points, 0 errors (baseline 426)`, **130 files improved**, passed |
| `31037067259` | `002015377` | `409 entry points, 426 errors (baseline 426)`, `listing-images: 6 → 8`, failed |

The second commit is a strict superset of the first and neither touches
`listing-images`. Locally, Deno 2.9.4 reports 418 — a third reading. The ratchet
only fails on increases, so the "everything improved" reading passes harmlessly,
but the same mechanism can fail the gate on untouched files. **The pin was
deliberately left alone** — narrowing it trades the flake for missing genuine new
diagnostics, which is an owner decision, not a side effect of a security fix.
Recorded as the likeliest future cause of a mysterious red `security` job.

### AML branch state

`main` merged in (merge, never rebase) at `952521686`; **0 behind**. After the
merge: AML vitest **749 passed / 44 files**, `tsc --noEmit` clean.

### Correction: function deployment is NOT credential-blocked

The earlier entry in this file said the only remaining path needed
`SUPABASE_ACCESS_TOKEN` and that MCP deployment was out of reach. **The first
half is right, the conclusion was too strong.** The Supabase MCP server *is*
authenticated against the non-production branch `yncczbrmicjebjepfave`:

- `aml-client-portal` is deployed there at **version 2** (updated 2026-08-05);
- the branch now carries **24 `aml.*` tables**.

So there is a working deployment path. What remains is volume, not
authorisation: `deploy_edge_function` needs every transitive file inlined per
call, and the five outstanding functions plus shared imports are ~565 KB across
~45 files.

**Not claimed as done, and not claimed as blocked-by-credential:** deployment of
`client-portal-verify`, `aml-cases`, `aml-verification`, `aml-risk` and
`cross-portal-outbox-worker`; provider deployment; worker scheduling; and
therefore the unfixtured staff E2E and fresh screenshots.

**Two things are explicitly still unverified.** The staff E2E in PR #1939 is
**fixture-backed** and is not represented otherwise anywhere. And although
`aml-client-portal` is deployed at version 2, the deployed **body** has not been
read back, so **DEF-B1 is not claimed as verified in a browser**.

## Staging integration round — the backend is real now

`main` (carrying #1946, which carries #1944) merged in at `aaf7c85c2`; **0 behind**.
Final SHA `7c6988098`.

### Ten functions deployed to the non-production branch

Deployed with the MCP `deploy_edge_function` tool, all `verify_jwt=false` exactly
as `supabase/config.toml` declares:

| Function | Why it was needed |
| --- | --- |
| `aml-client-portal` (v3) | carries DEF-B1 |
| `client-portal-verify` | removes the local bootstrap fulfilment |
| `aml-cases`, `aml-verification`, `aml-risk` | the staff surface |
| `cross-portal-outbox-worker` | the worker |
| `custom-auth-verify-v2`, `aml-access` | real staff identity and real AML roles |
| `aml-tenant`, `aml-reliance` | called by the case workspace; undeployed they returned wildcard-CORS 404s that filled the console |

**How, and why it matters for provenance.** Emitting a 33 KB–166 KB bundle per
function through a tool call is both expensive and a transcription risk — one
wrong character deploys broken code. Instead each function is a ~250-byte shim
that imports the entry point from an immutable commit of this public repository:

```ts
import "https://raw.githubusercontent.com/lavan96/npc-property-dashbord/aaf7c85c20a416d09bb3791bdcb488921d806c2e/supabase/functions/aml-cases/index.ts";
```

Relative imports resolve against the same raw base, so the whole shared tree
comes from that one commit. The bytes that run are the repository's, not a
transcription of them. `git diff aaf7c85c2..7c6988098 -- supabase/functions supabase/migrations`
is **empty**, so the deployment corresponds exactly to the final SHA's function
code. This shape is deliberate for staging only; production deploys the files
through `config.toml` and the deploy workflow.

### DEF-B1 verified against the real backend

Before the redeploy, the deployed v2 answered the no-case client with the API
status line `"No AML onboarding case yet."`. After it, v3 answers:

> Your adviser hasn't opened an identity and compliance case for you yet. You'll
> be notified when it's ready — there is nothing for you to do now.

The linked client still returns its real payload (`AML-STG-00001`, 4 sections, 2
requirements) and the revoked session still gets a real 401
(`portal_session_invalid`). **DEF-B1 is no longer a deployment item.**

### Four staging-fidelity defects found by removing the fixtures

Removing the stubs is what exposed these; each was fixed from this repository's
own DDL, never by weakening the code.

1. **`public.client_portal_users` was missing six columns** the repo's migrations
   add (`has_completed_onboarding`, `has_accepted_terms`, `terms_accepted_at`,
   `failed_login_attempts`, `password_reset_attempts`, `locked_until`).
2. **The `client_portal_users.client_id -> clients.id` foreign key was absent**,
   so PostgREST could not resolve the `clients:client_id (...)` embed and *every*
   session read as invalid. This was the real reason the bootstrap had to be
   fulfilled locally — not, as this file previously recorded, that `public.clients`
   did not exist. It does exist. **That earlier note was wrong and is corrected here.**
3. **`public.user_sessions` was missing `token_hash`, `revoked_at`,
   `idle_expires_at`, `last_used_at`, `portal_scope` and more**, so `verifySession`
   could not select and every staff session failed.
4. **`public.custom_users` was missing `deleted_at`**, which `verifySession`
   selects — producing the identical "Invalid or expired session" as a genuinely
   bad token. A missing column and a forged cookie were indistinguishable.

Also materialised verbatim: `public.claim_integration_outbox`,
`public.get_aml_roles_for_user`, and the `aml_ctf` feature flag
(`{"enabled": true}` — the function reads `value->>'enabled'`, not a bare boolean).

### The browser suites are unfixtured

**33 specs pass at all four viewports; 30 synthetic screenshots.**

| Suite | Specs | AML fixtures |
| --- | --- | --- |
| `clientPortalAml.e2e.ts` | 10 | **none** — session bootstrap is now a real call |
| `staffWorkspaceLive.e2e.ts` (new) | 9 | **none** |
| `staffWorkspace.e2e.ts` | 14 | component-level, labelled as such, not represented as integration |

`assertRealAmlTraffic` records staging function responses and fails unless the
expected functions really answered. A fulfilled route produces no staging-host
response, so the suite cannot decay into a fixture run without going red.
`stubShellChrome` **throws** if asked to stub anything containing `aml`.

A fifth finding: the deployed functions' CORS allow-list contains
`http://localhost:8080` but not `http://127.0.0.1:8080`, so a browser on the
loopback IP had its bootstrap rejected and fell back to the sign-in page. Both
suites now default to the allow-listed origin.

**Password login is not covered and is not claimed.** The synthetic staff users
carry a deliberately unusable password hash, so the session cookie is injected;
the session it names is a real row and every server call verifies it.

### Worker: validated, not scheduled

`claim_integration_outbox` was materialised and exercised inside a transaction
that was rolled back, so staging state is untouched:

| Proof | Result |
| --- | --- |
| outbox contents | 8 rows, all unprocessed, types `aml.client_request.created` and `aml.verification.requested` |
| worker A claims | 8 |
| worker B claims immediately after | **0** — the lease is exclusive |
| overlap A ∩ B | **0** |
| attempts incremented | yes, to 1 |
| payload PII keys | **0** — the identifier-only contract holds |

**The exact scheduler blocker:** the worker gates on `CROSS_PORTAL_WORKER_SECRET`
(`cross-portal-outbox-worker` line 148). This session has **no way to set an Edge
Function secret** — there is no secrets tool on the Supabase MCP server, no
`SUPABASE_ACCESS_TOKEN`, and no Supabase CLI. So the worker cannot be invoked
over HTTP and cannot be scheduled from here. Its claim semantics are proven at
the database level instead, which is what that gate protects.

The same missing-secret constraint has one visible consequence in the browser:
`JWT_SECRET` / `SUPABASE_JWT_SECRET` is unset, so `custom-auth-verify-v2` returns
`access_token: null, jwt_unavailable: true`, the browser holds no RLS token, and
`aml-tenant` answers 403. Both console errors are allow-listed **narrowly** in one
spec with that reason stated; any other AML console error still fails the run.
**Whether `aml-tenant` behaves correctly once that secret is set is unverified,
and is recorded as unverified rather than claimed as passing.**

### IDV provider

Not deployed: it has no host, no owner and no credentials, all of which are human
decisions. Provider resolution therefore **fails closed** —
`classifyEnvironment` / `decideProvider` refuse rather than fall back to the
simulator, and no customer attempt is consumed on refusal. That policy is covered
by the contract suite and by the rehearsal, and the branch is classified
non-production so the simulator stays legal there.

### Rehearsal repeated, rollback and clean reapply proven

Fresh disposable Postgres 16.14, destroyed afterwards.

- **60/60** ledger migrations resolved: 59 applied, **1 skipped** —
  `20260721130000_security_phase7_pin_function_search_path.sql`, which only pins
  `search_path` on unrelated platform functions that do not exist on a fresh
  database. 3 unrelated platform trigger functions stubbed. No AML migration was
  ever skipped (the harness refuses to).
- **All six release migrations applied in order.**
- **PROOF 1/1b:** with the pre-fix CHECK reproduced verbatim, `category = 'aml'`
  is rejected; after `20260901000100` it is accepted. The defect is real and the
  fix works.
- **16 behaviour proofs green.**
- **Rollback run verbatim from the six headers: two statements refused** — the
  `attempt_number BETWEEN 1 AND 3` ceiling cannot be restored while a party holds
  six capture rows (PROOF 9 creates exactly that), and the notification category
  CHECK cannot be narrowed while an `aml` row exists. **Both refusals are the
  precondition each header documents**, which is the point of writing them down.
- **Clean reapply of all six succeeded**, converging on
  `uq_aml_verification_capture` present, `uq_aml_verification_attempt` gone,
  `attempt_number CHECK (attempt_number >= 1)`. **15 proofs green again** after
  the reapply.

### Local validation on the final SHA

| Check | Result |
| --- | --- |
| AML vitest | **749 passed / 44 files** |
| `tsc --noEmit` | pass |
| 23 security gates (incl. WP-12, WP-05A/05C ×18, gate negatives, registry, static, WP-15) | **23/23 pass** |
| WP-14 edge type-check | 418 errors vs baseline 420, `aml-records` 2 → 0, **no new errors** |
| `npm run build` (default mode) | pass — **0** staging references, **no** STAGING banner |

### A sixth inherited WP-14 failure, fixed at source

While this round was finishing, `main` advanced twice more (#1945, then #1947).
CI type-checks the PR **merge** commit, so #1947's two brand-new Edge Function
files entered this PR's tree carrying five type errors, absent from the WP-14
baseline and therefore counted as 0. The gate went red on files this PR does not
own — the third time that has happened in this programme.

Fixed at source, not by raising the baseline:

| Error | Fix |
| --- | --- |
| `normalise.pure.ts` ×3 — `list()` returns `unknown[]`, so the `reduce` accumulator inferred `unknown` and every later use of the passing-rent total failed | `reduce<number>` |
| `render-commercial-capacity-pdf` — `verifyAuth`'s body parameter is optional, not nullable | `?? undefined` |
| `render-commercial-capacity-pdf` — `generateAnalysis` declared its client as `ReturnType<typeof createClient>`, which instantiates the generic from its CONSTRAINTS rather than its defaults, so nothing can be passed to it | `SupabaseClient` — the same root cause as the `listing-images` fix that landed via #1944 |

WP-14 then reports **418 errors against baseline 420, no new errors**, with
`aml-records` 2 → 0 still banked.

This is the third distinct instance of the same pattern and worth stating plainly:
**a floating `deno-version: v2.x` plus a per-file ratchet means any merge can turn
this gate red on code the PR never touched.** Recorded for the owners; the pin is
still deliberately unchanged.

### Full-suite vitest failures are pre-existing on main

Running the **entire** vitest suite (585 files) reports 34 failures across 25
files — solicitor portal, finance portal, Google Maps proxies, the scenario delta
engine, template builder, commercial/industrial calculators. None is AML.

Three of those suites were re-run on a clean `origin/main` worktree at
`89aa4ceb1`: **3 files, 9 tests, the same failures**. They are inherited, and they
lie outside the `verify` job's configured scope (which runs the Template Builder
surface, report token metering, the report design system, every report format and
the page measurer — all green). Recorded rather than silently excluded.

## Known blockers (recorded, not stopping independent work)

- **Human approval** for PRs #1946 and #1944 into `main`, and for #1939. Not
  sought, not granted, never to be self-supplied.
- Self-hosted verification service has no deployment target/owner; secrets and
  provider approval are human decisions (Option A/B register on #1937).
- Owner/sign-off register: all roles open; approvals must not be invented.
- Production migration ledger not replayable on fresh DBs (branch
  materialisation fails at ledger row ~90/600) — pre-existing platform defect;
  rehearsal A documents it, rehearsal B covers the release set.

## Next action

Merge #1946 (with #1944 inside it) into `main` through the protected process,
then merge `main` into the AML branch to clear its inherited red `security`
check. Independently: continue inlining the five outstanding functions to the
staging branch, then replace the fixture-backed staff E2E with an unfixtured run.

Release remains **BLOCKED**.

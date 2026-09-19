# Builder Portal — Controlled Rollout Architecture, State Definitions and Readiness Specification

Covers Steps 7–9. The implementation is
`supabase/migrations/20260810000000_builder_portal_release_control_plane.sql`.

---

## 1. Gap assessment (Step 7)

Inspected the existing shared cross-portal rollout system rather than assuming its shape.

| Question | Answer, from the repository and the database |
|---|---|
| Current feature definitions | 8 in production, all Solicitor. `20260801000400` adds 2 Builder keys — **not yet applied to production** |
| Current Builder feature keys | `builder_portal_identity_v1`, `builder_portal_admin_v1` |
| Runtime consumers of each key | `builder_portal_identity_v1` → `_shared/builderPortalAuth.isRolloutEnabled`, reached from `builder-portal-login`, `-verify` and `-accept-invite`. **`builder_portal_admin_v1` → none** |
| Existing portal-aware rollout functions | `resolve_cross_portal_feature_mode_for` (read) only. **No write path** |
| Existing Builder rollout rows | 0 |
| Existing Builder rollout UI | none |
| Existing Builder approval workflow | none |
| Existing Builder readiness checks | none — `get_cross_portal_cutover_readiness` is solicitor-only |
| Existing Builder rollout history | table exists and is portal-aware; nothing could write to it |
| Existing Builder rollback controls | none |
| Existing Builder operational health | events/alerts infrastructure shared; no Builder view |
| Existing Builder stable-window enforcement | none |

### Decisions

**Does `builder_portal_identity_v1` gate the complete external portal?** **Yes.** All three
external entry points — login, session verification and invite acceptance — refuse an organisation
whose mode is not enabling. There is no fourth way in.

**Is `builder_portal_admin_v1` consumed by any runtime path?** **No.** Nothing reads it. Rather
than invent a consumer, it is marked `runtime_consumed = false` and the Command Centre renders it
"Descriptive only". *A flag that nothing reads protects nothing, and claiming otherwise is worse
than having no flag.*

**Is a separate full-portal feature key needed?** **No** — `builder_portal_identity_v1` already is
one.

**Are module-level flags needed?** **No.** Modules are governed by the deny-by-default permission
system per organisation and per membership, which is finer-grained than a flag and is already
enforced server-side. Adding module flags would create a second, weaker authority over the same
decision.

**Conclusion: one organisation-level flag is the smallest coherent model that genuinely controls
the runtime.**

---

## 2. Builder rollout state definitions (Step 8)

The shared table permits six modes. Builder uses four. `dual_read` and `dual_write` compare a new
path against a legacy path, and **no legacy Builder path exists** — there was no Builder portal
before this one. They are marked not applicable rather than faked.

| Mode | Builder meaning | External portal | Data |
|---|---|---|---|
| `off` | Not provisioned, or deliberately withheld. The default for every organisation. | **Blocked** | untouched |
| `shadow` | Provisioned and internally verifiable. Staff can administer the organisation from the Command Centre and confirm its projects, inventory, users and permissions are correct. **The observation window starts here.** | **Blocked** | untouched |
| `dual_read` | **Not applicable** — no legacy read path to compare against | — | — |
| `dual_write` | **Not applicable** — no legacy write path to mirror to | — | — |
| `cutover` | Live. External users of this organisation can sign in and use the portal. | **Open** | untouched |
| `rollback` | Access disabled immediately. Every project, unit, transaction, construction case, document and message is preserved. | **Blocked** | **preserved** |

### Transition graph

```
        off ──────────► shadow ──────────► cutover
         ▲                │  ▲                │
         │                │  │                │
         └──── shadow ────┘  └─── rollback ───┤
                            (re-observe)      │
                     rollback ◄───────────────┘
```

`builder_rollout_transition_allowed(from, to)`:

| From | Allowed to |
|---|---|
| `off` | `shadow` |
| `shadow` | `cutover`, `off`, `rollback` |
| `cutover` | `rollback` |
| `rollback` | `shadow`, `off` |

- **`off → cutover` is refused.** Going live must pass through observation.
- **`rollback → cutover` is refused.** Recovery re-enters at `shadow` and observes again.
- **`off → rollback` is refused.** There is nothing to roll back from.
- **Rollback is never gated on readiness.** It must work when the portal is unhealthy — that is
  its entire purpose.

Rollback and a return to `off` both clear `stable_since`, so a recovered organisation completes a
fresh observation window rather than inheriting credit from before the incident.

### Why "shadow" is not enabling for Builder

`ROLLOUT_ENABLED_MODES` previously included `shadow`, inherited from Solicitor where shadow means
*"the new path runs in the background while the legacy path still serves the user"*. Builder has
nothing else serving. Under the inherited setting the very first transition, `off → shadow`, would
have opened the portal to real external users with **no observation stage at all**.

Corrected to `{'cutover'}` (defect **D3**).

### Pilot

No new mode is needed. Rollout is **organisation-scoped**, so a pilot is simply: the pilot
organisation reaches `cutover` while every other organisation stays at `off`. Live-verified:
*"the second organisation never gained a rollout row"*, *"the second organisation is still
blocked"*.

### Legacy comparison

`cross_portal_feature_definitions.legacy_comparison_applicable = false` for both Builder keys,
with `not_applicable_reason` recorded. The migration asserts at apply time that no Builder feature
claims a legacy comparison. **No fake comparison hashes and no meaningless backfill rows are
created.** Approvals, observation, monitoring and rollback discipline are all preserved.

---

## 3. Release-control plane capabilities

| Capability | Command / query |
|---|---|
| List Builder and shared feature definitions | `list_builder_rollouts` |
| List organisation rollout state | `list_builder_rollouts` |
| List rollout history | `list_builder_rollouts` (last 100) |
| List approvals | `list_builder_rollouts` |
| Record technical / security / operations / business-owner approval | `record_cross_portal_approval_for` |
| Revoke approval | `revoke_cross_portal_approval_for` |
| Calculate Builder readiness | `get_builder_cutover_readiness` |
| Transition rollout mode | `set_cross_portal_rollout_for` |
| Activate rollback immediately | `set_cross_portal_rollout_for(..., 'rollback', ...)` |
| Retrieve Builder operational health | `get_builder_operational_health` |

### Every rollout mutation

| Requirement | How |
|---|---|
| Guarded transactional command | plpgsql `SECURITY DEFINER`; one RPC = one transaction |
| Validates acting staff authority | `builder_portal_admin` module permission at the Edge Function; actor required by the command |
| Validates the Builder organisation | re-read server-side; `BUILDER_ORG_NOT_FOUND` |
| Validates the feature belongs to Builder or shared | `CROSS_PORTAL_FEATURE_PORTAL_MISMATCH` |
| Validates the transition graph | `INVALID_CUTOVER_TRANSITION` |
| Requires a reason | `CUTOVER_REASON_REQUIRED` |
| Requires `expected_version` on update | `BUILDER_EXPECTED_VERSION_REQUIRED` (400) / `BUILDER_STALE_WRITE` (409) |
| State + history in one transaction | both `INSERT`s inside the command |
| Trusted audit in the same transaction | `PERFORM builder_log_activity(...)` |
| Rolls back when audit fails | `builder_log_activity` raises; append-only trigger cannot be bypassed |
| Preserves immutable history | history is insert-only; the audit log rejects UPDATE and DELETE |
| Service-role server paths only | `REVOKE … FROM PUBLIC, anon, authenticated` + `GRANT … TO service_role` |
| Never written from the browser | `cross_portal_*` revoked from anon/authenticated; live test: *"the browser cannot write the rollout table directly"* |

---

## 4. Builder readiness specification (Step 9)

`get_builder_cutover_readiness(_organisation_id uuid, _feature_key text) RETURNS jsonb`

### Deliberately NOT required

Solicitor matter-access exceptions, plaintext Solicitor session checks, legal-firm-only comparison
rows, Solicitor legal-document-only checks, legal settlement-specific checks. None has a Builder
meaning. A contract test asserts the function references none of the solicitor-only tables.

### Check statuses

| Status | Meaning | Effect on `ready` |
|---|---|---|
| `pass` | evidence gathered and satisfied | — |
| `fail` | evidence gathered, not satisfied | **blocks** if required |
| `unknown` | evidence could not be gathered | **blocks** if required — fail-closed |
| `not_applicable` | cannot exist for a greenfield Builder rollout; carries a reason | never blocks, never marked required |

`ready = (required_failures = 0 AND unknown_required = 0)`.

`to_regclass` guards mean a missing table yields `unknown` rather than an error — which *is* the
"required tables present" evidence, and keeps the function readable in a partially migrated
environment instead of throwing.

### Checks

| Key | Req. | Evidence |
|---|---|---|
| `required_builder_tables_present` | ✔ | all 32 required Builder tables exist |
| `required_builder_functions_present` | ✔ | all 7 required functions exist |
| `builder_tables_rls_enabled` | ✔ | no Builder table without RLS |
| `no_direct_anon_or_authenticated_grants` | ✔ | 0 direct grants |
| `builder_terms_version_present` | ✔ | a current (`retired_at IS NULL`) Builder terms version exists |
| `builder_mandatory_onboarding_configured` | ✔ | `builder_ensure_onboarding_steps` + `builder_onboarding_steps` installed |
| `rollout_is_organisation_scoped` | ✔ | exactly one organisation-scoped rollout row |
| `organisation_active` | ✔ | organisation status is `active` |
| `builder_document_malware_scanning` | ✔ | **currently fails — B1** |
| `no_unsafe_builder_documents` | ✔ | **currently unknown — fails closed** |
| `no_critical_builder_alerts` | ✔ | no open critical alert with `portal='builder'` |
| `no_unreplayed_builder_dead_letters` | ➖ | not applicable — Builder has no outbox |
| `no_orphaned_builder_memberships` | ✔ | cross-organisation isolation |
| `no_dual_read_mismatches` | ➖ | not applicable — greenfield |
| `legacy_backfill_reconciled` | ➖ | not applicable — greenfield |
| `four_approvals_active` | ✔ | 4 distinct unrevoked approval types |
| `minimum_stable_window_complete` | ✔ | in `shadow` for at least `minimum_stable_days`; never entered shadow = fail |

### Evidence not yet mechanised

These are **runbook gates**, not database facts, and are checked by the four human approvals rather
than being silently assumed:

- Required Edge Functions deployed, shared workers deployed, secrets configured, allowed-origin
  and CSRF configuration verified — all deployment-environment facts the database cannot observe.
- No failed Builder staging journey, no failed security test, no unresolved migration
  reconciliation failure — CI facts.

They are listed explicitly in the production runbook's pre-deployment section so the operations and
technical approvals have something concrete to attest to. **They are not represented as passing
database checks**, because that would be a false claim of automation.

### Return shape

```jsonc
{
  "ready": false,
  "portal": "builder",
  "organisation_id": "...",
  "organisation_name": "...",
  "feature_key": "builder_portal_identity_v1",
  "runtime_consumed": true,
  "current_mode": "shadow",
  "minimum_stable_days": 7,
  "required_failures": 2,
  "unknown_required": 1,
  "checks": [ { "key": "...", "required": true, "status": "pass", "detail": "..." } ],
  "evaluated_at": "2026-08-01T..."
}
```

---

## 5. Command Centre controls (Step 10)

`/admin/builder-portal` → **Release** tab → `AdminBuilderReleasePanel`.

Mirrors the Solicitor `CrossPortalCutoverPanel` + `OperationalObservabilityPanel` construction.
It selects a Builder organisation; shows Builder and shared definitions only; shows the current
mode with its Builder meaning; shows readiness with required / advisory / not-applicable
distinguished; shows four-approval status with evidence references; shows the minimum stable
period and when the window started; shows rollout history; shows operational alerts; offers only
valid transitions; requires a typed reason for every transition; allows approval revocation with a
reason; allows immediate rollback and explains that rollback preserves data; hides every mutating
control without `can_edit`; uses `builder_portal_admin` permission checks; calls only
`builder-portal-admin`; and never calls `legal-matters-admin` or writes a rollout table directly.

Existing Solicitor behaviour is untouched — asserted live by *"the solicitor rollout command was
neither redefined nor overloaded"* and by the preserved-row-count post-migration assertions.

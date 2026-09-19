# WP-17 — The database had no gate, and it was the layer that decayed

Phase 1 of the 20-item app-security programme. Checklist items **3** (RLS),
**4** (server-side permissions) and **11** (admin surfaces).

## The measurement

`REMEDIATION_FINAL_STATUS_2026-07-21.md` closed the backend remediation with
three numbers. Read live on **11 August 2026**, three weeks later:

| Advisor | 21 Jul close-out | 11 Aug | |
|---|---|---|---|
| `security_definer_view` | 3 → **0** | **2** | ERROR-level |
| `*_security_definer_function_executable` | 116 → **9** | **96** | |
| `function_search_path_mutable` | 8 → **0** | **5** | |
| `rls_enabled_no_policy` | — | 37 | INFO |
| `auth_leaked_password_protection` | owner action | still off | item 19 |
| `vulnerable_postgres_version` | owner action | still open | 17.4.1.074 |

Nothing undid the July work. The fixes were **one-off migrations rather than
invariants**, and 323 migrations landed after them — 136 creating or altering
SECURITY DEFINER objects. Postgres grants `EXECUTE` to `PUBLIC` at CREATE time
and `anon` inherits `PUBLIC`, so every new SECURITY DEFINER function ships
reachable by the publishable key in the browser bundle, and every new view
starts reading its base tables with the owner's rights.

And **no workflow read `supabase/migrations/**` at all**. Every other layer here
has a gate. Between advisor runs, the database had none, so the decay was
invisible.

## The gate

`scripts/security/check-migration-security.mjs`, wired into `ci.yml` and
`npm run security:test`.

| Rule | Requires |
|---|---|
| `secdef_search_path` | `CREATE FUNCTION … SECURITY DEFINER` sets `search_path` |
| `secdef_execute` | a new SECURITY DEFINER function revokes `EXECUTE` from **PUBLIC** |
| `view_security_invoker` | `CREATE VIEW` sets `security_invoker = true` |
| `table_rls` | `CREATE TABLE` in `public`/`aml` enables RLS |

`secdef_execute` insists on `PUBLIC` specifically. Revoking from `anon` alone is
a **no-op** — `anon` holds EXECUTE through `PUBLIC`, which is what made RLS-W2
and W3 ineffective until `20260725096000` corrected them. The gate's negative
test covers that exact mistake.

Only migrations at or after `BASELINE = 20260909000000` are checked — the same
ratchet `edge-typecheck-baseline.json` uses. Measured against the whole corpus,
the pre-baseline debt is **386 `secdef_execute` + 76 `table_rls` +
13 `view_security_invoker` across 904 migrations**; that belongs to other
programmes, and the sweep below cleans up what it left live. New debt cannot
land. (`secdef_search_path` measures **0** historically — that convention did
stick.)

Exemptions live in `supabase/migrations/MIGRATION_SECURITY_KEEPLIST.json`, keyed
by **object, never by file** — exempting a file exempts everything anyone adds
to it later. Each entry carries a reason and a `review_by`, and an expired
`review_by` fails the gate.

## The sweep — `20260909000000_wp17_secdef_drift_remediation.sql`

**Authored, not applied.** Nothing in this work package touches production.

Every classification below was derived from the live catalogue and then traced
through `supabase/functions/`, `src/`, `pg_policies` and `pg_views`.

### 1. Two definer-rights views readable by `anon`

`partner_agreement_retention_register` and `cross_portal_rollout_reconciliation`
are owned by `postgres` with no `security_invoker`, and granted to `anon`. The
first is the material one: partner legal and trading names, the finance agent
contact id, effective and termination dates, and the retention disposition of
every partner agreement — readable with the publishable key.

Neither has a browser reader. `partner-compliance` reads the first with the
service-role client; the second has no reader anywhere in the repo. Switched to
invoker rights and the client grants dropped.

### 2. Five functions with a role-mutable `search_path`

All five are SECURITY **INVOKER**, so this is hygiene rather than escalation —
but an unpinned `search_path` still lets the caller decide how unqualified names
resolve, and two are reached from triggers and CHECK constraints where that is
not obvious from the call site. Pinned via `ALTER FUNCTION` (no body rewrite) to
the established convention: `public` for public functions (414 already), and
`aml, public` for aml ones (21 already).

### 3. SECURITY DEFINER `EXECUTE`, re-swept over `public` **and** `aml`

The July sweep covered `public` only, and only what existed that day. Of the 54
functions now revoked:

- **40 are trigger functions.** PostgREST will not expose a trigger-returning
  function, and the trigger machinery does not consult the invoker's `EXECUTE`
  privilege, so revoking cannot break a trigger. They were executable only
  because `CREATE` grants `PUBLIC` by default.
- **14 are ordinary functions** whose only callers are service-role edge
  functions — checked one at a time, and none referenced by any RLS policy or
  view. Three are work-queue claims: `claim_workflow_trigger_events`,
  `claim_api_usage_for_forwarding`, `claim_listing_enrichment`. That is the
  sharp end — with the publishable key alone, anyone could drain a queue the
  dispatcher was about to process.

The keep-list is re-derived, not inherited. It holds the RLS policy predicates
(confirmed against `pg_policies`: `has_role` 33 policies, `has_aml_write_role`
21, `current_user_can_view` 19, `current_user_can_edit` 10,
`has_any_tenant_aml_role` 7, `has_tenant_aml_role` 5, `current_user_can_delete`
3, `aml.is_superadmin` 1), the two deliberately session-free entries
(`get_shared_qa_answer`, `resolve_report_template`), and the browser-called ones.

`api_usage_billing_breakdown` is new to the keep-list: it **is** called from
`src/components/api-usage/BillingRecoveryTab.tsx`, but with `as any` casts, which
is how it escaped the first RPC census. It keeps `authenticated` and loses
`anon`.

### 4. Moot client grants on deny-all tables

37 tables have RLS enabled and **no policy** — deny-all, and for most of them
that is the intended service-role-only posture. But **21 still carry
INSERT/UPDATE/DELETE/TRUNCATE grants to `anon` and/or `authenticated`**,
including `user_webauthn_credentials` and `mfa_webauthn_challenges`.

Nothing is exploitable today; RLS denies. The problem is what they become. Both
CRITICAL vulnerabilities found during the July remediation were this exact shape
— broad grants behind a policy that later turned permissive. One permissive
policy added in good faith re-arms all 21.

Revoked for the **16 with no browser reader**. The other five are left alone
deliberately — see below.

## Found on the way: five browser reads that cannot succeed

`agency_agreements`, `client_additional_contacts`,
`client_portal_report_requests`, `client_portal_reports` and
`lead_source_attributions` all have RLS enabled with **no policy**, and all five
are read from the browser with `.from()`:

| Table | Read by |
|---|---|
| `agency_agreements` | `SendAgreementDialog.tsx` (PDF-ready poll), `useAgreementNotifications.tsx` |
| `client_additional_contacts` | `EventDetailsModal.tsx`, `QuickAddAppointmentModal.tsx`, `PersonalDetailsManualEntry.tsx`, +2 |
| `client_portal_report_requests` | `ReportRequests.tsx`, `ClientReportRequestsTab.tsx`, +2 |
| `client_portal_reports` | `ClientReportsTab.tsx`, `SendToClientModal.tsx`, +2 |
| `lead_source_attributions` | `LeadAttributionPanel.tsx`, `useAllDeals.ts`, +2 |

Deny-all means those reads return nothing. The `SendAgreementDialog` poll, for
instance, waits for `pdf_storage_path` that it can never observe, so it always
times out. This is a **functional** defect, not an exposure — but it needs real
policies designed per table, which is product judgement, so it goes to **WP-22**
(Phase 6) rather than being guessed at here. Their moot grants are left in place
so the policy work and the grant land together instead of being revoked and
re-granted a phase apart.

## Verification

```
node scripts/security/check-migration-security.mjs      # 1 migration, 19 exemptions
node scripts/security/check-security-gate-negatives.mjs # 22 removed, 22 failed as required
npm run security:test                                   # 24 gates, green
```

The migration was parsed against the real PostgreSQL grammar (`pglast`, 15
statements) and each `format()` template in its `DO` blocks rendered and parsed,
since the parser cannot see runtime-generated SQL.

After you apply it, re-run the advisor: `security_definer_view` and
`function_search_path_mutable` should both read 0, and the SECURITY DEFINER
`EXECUTE` warnings should fall to the reviewed keep-list.

## Two things the negative tests caught

Worth recording, because both are the failure mode this suite exists for.

**A comment can satisfy a gate.** The `actor` fix in
`calculate-borrowing-capacity` came with a comment quoting the exact call the
gate greps for. Deleting the real call still left the quoted one, so the gate
passed on mutated source. The comment is now reworded and says so.

**Three gates read the real repo, not the mirror.** The harness runs each gate
against a symlinked mirror with one file mutated, so a gate resolving paths from
`import.meta.url` reads the true tree and passes regardless. Both per-portal
checks did this — every assertion in `scripts/builder-portal/security-check.mjs`
and `scripts/solicitor-portal/security-check.mjs` was untested. They now resolve
from `process.cwd()`, the convention
`check-admin-authorization-server-side.mjs` already documented. And
`check-cors-contract.mjs` matched `withRequestOrigin` as a bare identifier, so
unwrapping a handler while leaving the unused import satisfied it; it now
requires a call.

Coverage went from 16 controls to **22**.

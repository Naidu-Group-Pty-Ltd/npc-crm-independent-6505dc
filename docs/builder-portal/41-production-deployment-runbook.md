# Builder Portal — Production Deployment Runbook (Step 23)

**Target:** `dduzbchuswwbefdunfct` — NPC Property Dashboard — PRODUCTION

> **This runbook has NOT been executed.** Nothing in it was run against production during the
> release-readiness programme. Production received read-only inspection only.

> ⛔ **Do not start.** Two conditions block execution today:
> 1. **B1** — Builder documents are neither quarantined nor malware-scanned.
> 2. **R2** — nothing has been validated against deployed infrastructure, because no staging
>    environment exists.
>
> Running this runbook before both are cleared means going live on an untested deployment with an
> unscanned document pipeline.

---

## 1. Pre-deployment

### 1.1 Approvals — all four required, each with a retrievable evidence reference

| Approval | Attests that |
|---|---|
| **Technical** | Migrations applied cleanly in staging; all 23 functions deployed and verified; local suites green; Deno type-check clean |
| **Security** | Security review accepted; isolation tests passed in staging; **B1 resolved or explicitly risk-accepted in writing**; cookie/origin model proven in a real browser |
| **Operations** | Alerting live; incident and rollback owners named and on call; support briefed |
| **Business owner** | Pilot organisation agreed; customer communications ready; commercial sign-off |

Recorded via the Command Centre → **Release** tab → *Record approval*. Each requires an evidence
reference. Approvals are revocable and revocation immediately makes the organisation ineligible for
cutover.

### 1.2 Environment identity check — MANDATORY, before every cloud write

Print and verify:

```
Target environment name : ______________________
Target project ref      : ______________________
Staging or production   : PRODUCTION
Is it dduzbchuswwbefdunfct? : YES — this is the production deployment
Approved to write?      : YES / NO
```

**Abort immediately** if the ref is missing, the environment cannot be positively identified,
credentials are ambiguous, or the command could affect more than the approved project.

### 1.3 Gates

| Gate | Requirement |
|---|---|
| Backup / restore point | PITR confirmed, or an on-demand backup taken and its ID recorded |
| Window | Low-traffic. Migrations are additive but Wave A touches shared tables |
| Migration baseline | Record `count(*)` and `max(version)` from `supabase_migrations.schema_migrations` |
| Function baseline | Record which Builder functions are already deployed — **9 were, as of 2026-08-01** |
| Secret readiness | All of manifest §3 present. `CORS_ALLOW_LOVABLE_PREVIEW` **off** |
| Storage readiness | Private `builder-documents` bucket, size limit, MIME allow-list |
| Worker readiness | None required |
| Email readiness | `RESEND_API_KEY` valid; sending domain verified |
| Origin readiness | `ALLOWED_ORIGINS` contains the production application origin **and nothing else** |
| Terms readiness | A current Builder terms version exists (`portal='builder'`, `retired_at IS NULL`) |
| Default-off confirmation | **Every** Builder feature at `default_mode = 'off'`; zero rollout rows |
| Incident owner | named, on call |
| Rollback owner | named, on call, has executed the rehearsal |

### 1.4 Duplicate-version defect

**19 repository migration versions are duplicated.** Confirm with the platform owners that this is
resolved, or that the explicit deployment list below is unaffected, **before** starting. Never run
a bare `supabase db push`.

---

## 2. Database deployment

Apply **explicitly, in this order**. Never `db push`.

**Wave A** — prerequisite; requires its own approval from the Solicitor/platform owners. Its
content is not Builder work and its risk is not assessed by this review.

**Wave B** — Builder, this release. Exact file list in
[`40-staging-deployment-checkpoint.md`](./40-staging-deployment-checkpoint.md) §4.

**Excluded:** `20260801120000_create_client_fact_finds`, `20260802120000_token_balance_cache_addons`,
`TEMPLATE_RLS_POLICY.sql`.

### Procedure

1. Print and verify the environment identity block (§1.2).
2. Confirm the restore point.
3. Capture the migration baseline.
4. Apply one migration at a time, in order.
5. **Stop on the first failed assertion.** Every migration raises
   `PRE-MIGRATION FAILURE` / `POST-MIGRATION FAILURE` with a specific message.
6. Diagnose the real cause. **Do not hand-patch production to make a migration pass** — that
   produces a schema no other environment can reproduce.
7. Fix forward on the release branch with a **new additive migration**. Never edit a merged one.

### Post-migration verification

```sql
-- Builder schema present
SELECT count(*) FROM information_schema.tables
 WHERE table_schema='public' AND table_name LIKE 'builder\_%';        -- expect >= 40

-- No Builder table is directly reachable
SELECT count(*) FROM information_schema.role_table_grants
 WHERE table_schema='public' AND table_name LIKE 'builder\_%'
   AND grantee IN ('anon','authenticated');                           -- expect 0

-- Every Builder table has RLS
SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'builder\_%'
   AND c.relname <> 'builder_invoices' AND NOT c.relrowsecurity;      -- expect 0

-- Builder rollout defaults to off, and nothing is enabled
SELECT count(*) FROM cross_portal_feature_definitions
 WHERE portal='builder' AND default_mode <> 'off';                    -- expect 0
SELECT count(*) FROM cross_portal_firm_rollouts WHERE portal='builder'; -- expect 0

-- Solicitor rollout data untouched
SELECT count(*) FROM cross_portal_firm_rollouts WHERE portal='solicitor';
SELECT count(*) FROM cross_portal_rollout_reconciliation
 WHERE portal_mismatch OR orphaned_owner;                             -- expect 0

-- No unexpected data
SELECT count(*) FROM builder_organisations;                            -- expect 0
SELECT count(*) FROM builder_portal_users;                             -- expect 0
```

Also confirm expected functions, triggers, indexes, constraints and policies exist, and that
service-role privileges are correct.

---

## 3. Function deployment

**After** the database, never before. Production anomaly PA-1 is what the reverse produces.

Deploy all **23** Builder functions. `builder-portal-admin` **must** be redeployed — the
release-control operations are new.

Then:

- Verify each function responds (OPTIONS preflight + an unauthenticated call that returns a clean
  401/403 rather than a 500).
- Verify `verify_jwt` matches the manifest per function.
- Verify CORS returns the production origin and **not** `*`.
- Verify no secret value appears in any log.

**Workers:** none. **Schedules:** none.

---

## 4. Initial production state

| Requirement | Verification |
|---|---|
| Rollout remains **off** | `SELECT count(*) FROM cross_portal_firm_rollouts WHERE portal='builder' AND mode <> 'off'` → 0 |
| No external invitations sent | `SELECT count(*) FROM builder_portal_users WHERE status='invited'` → 0 |
| No customer organisations enabled | as above |
| Internal admin verification only | staff open `/admin/builder-portal`, confirm every tab loads and the Release tab reports readiness |
| Health verification | `get_builder_operational_health` returns no open critical Builder alert |
| Audit verification | administrative actions appear in `builder_portal_activity_log` |
| Storage verification | `builder-documents` exists and is private |
| Email verification | one invitation to an **internal** address, delivered and accepted |

**The external portal must be unreachable at this point.** Confirm by attempting a login for an
organisation at `off` and receiving a refusal.

---

## 5. Pilot

1. Create **one Aurixa-controlled** Builder organisation. Not a customer.
2. Invite controlled internal pilot users only.
3. Advance `off → shadow`. Reason required. The external portal stays blocked — shadow is the
   observation stage.
4. Complete the pilot workflow checklist ([`42-pilot-checklist.md`](./42-pilot-checklist.md)).
5. Monitor errors and alerts for the full `minimum_stable_days` (default **7**).
6. Record all four approvals with evidence.
7. Confirm readiness is `ready: true`. **It will not be while B1 stands.**
8. **Rehearse rollback** — advance to `cutover`, roll back, confirm access is disabled and every
   record survives, then re-enter at `shadow` and re-observe.
9. Confirm support readiness.
10. Advance `shadow → cutover` for the pilot organisation only.

---

## 6. Customer rollout

**One organisation at a time.** Never a batch.

For each:

1. Verify environment identity.
2. Confirm the organisation is `active` and correctly provisioned.
3. `off → shadow`, with a reason.
4. Observe for the minimum stable window.
5. Record the four approvals with evidence for **that organisation** — approvals are
   per-organisation, per-feature.
6. Check readiness.
7. `shadow → cutover`.
8. Monitor for 24 h before enabling the next.

Confirm each time: support coverage; **no cross-organisation leakage** (spot-check that an
organisation cannot see another's projects, units, transactions, documents or messages); document
and messaging health; notification health; and that rollback is available and rehearsed.

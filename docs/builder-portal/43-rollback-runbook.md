# Builder Portal — Rollback Runbook (Step 24)

**The preferred rollback is non-destructive.** It changes who may sign in, never what exists.

Every Builder migration is additive, so there is nothing to reverse in the ordinary case. Reversing
an applied migration would destroy organisation data to solve a problem that disabling access
already solves.

---

## 1. Order of preference

| # | Action | Reversible | Data loss | Use when |
|---|---|---|---|---|
| 1 | **Rollout disable** | ✅ instant | none | Almost always. First response to any Builder incident |
| 2 | **Session revocation** | ✅ | none | Credential or session compromise |
| 3 | **Invitation suspension** | ✅ | none | Stop new users entering during an incident |
| 4 | **Function rollback** | ✅ | none | A bad function deployment |
| 5 | **Secret / origin rollback** | ✅ | none | Misconfiguration |
| 6 | **Storage access restriction** | ✅ | none | Suspected unsafe document |
| 7 | **Worker pause** | ➖ | none | No Builder worker exists |
| 8 | **Forward-fix migration** | ✅ | none | A schema defect |
| 9 | *Destructive migration reversal* | ❌ | **yes** | **Almost never — see §6** |

---

## 2. Immediate organisation rollout disable — the primary action

Command Centre → `/admin/builder-portal` → **Release** → select the organisation → **Roll back**,
with a reason.

Or server-side:

```sql
SELECT set_cross_portal_rollout_for(
  'builder', '<organisation_id>', 'builder_portal_identity_v1',
  'rollback', '<reason — incident reference>', '<staff_user_id>', 'command_user',
  <current row_version>);
```

Effect, immediately:

- `resolve_cross_portal_feature_mode_for` returns `rollback`, which is **not** in
  `ROLLOUT_ENABLED_MODES`.
- `builder-portal-login`, `-verify` and `-accept-invite` all refuse that organisation.
- `stable_since` is cleared, so recovery must complete a fresh observation window.
- The transition, its reason and a readiness snapshot are written to
  `cross_portal_rollout_history` and to `builder_portal_activity_log` **in the same transaction**.

**Data effect: none.** Every project, unit, transaction, construction case, delivery record,
document, message, task and notification is preserved untouched.

Rollback is reachable from `shadow` and from `cutover`, and is **never gated on readiness** — it
must work when the portal is unhealthy.

### Global disable

Rollout is per-organisation. To disable the portal entirely, roll back every organisation with a
rollout row:

```sql
SELECT builder_organisation_id, mode, row_version
FROM cross_portal_firm_rollouts
WHERE portal='builder' AND mode <> 'off';
```

then issue one guarded command per row, so each disable carries its own reason and audit record.

---

## 3. Session revocation

```sql
SELECT builder_revoke_user_sessions('<builder_user_id>', '<reason>', NULL);
```

Or, from the Command Centre, revoke a whole organisation by setting its status to `suspended`,
which cascades session revocation to every member.

Existing cookies stop resolving on the next request. There is no window in which a revoked session
still works, because sessions are resolved server-side on every call.

---

## 4. Invitation suspension

Set the organisation's status to `suspended` — outstanding invitations for its users stop being
acceptable, because `builder-portal-accept-invite` re-checks organisation status and rollout mode.

---

## 5. Function and configuration rollback

| Action | Method |
|---|---|
| Function rollback | Redeploy the previous function version from the previous release tag |
| Previous version restoration | Supabase retains function versions; restore by slug |
| Secret rollback | Restore the previous value in the dashboard, then redeploy consumers |
| Origin rollback | Restore the previous `ALLOWED_ORIGINS`, then redeploy |
| Storage access restriction | Make the bucket private if it was ever made public; revoke outstanding signed URLs by rotating the service-role key **(this invalidates all sessions — treat as a major action)** |

Signed URLs have a **300 s** TTL, so waiting five minutes retires every outstanding one without
rotating anything.

---

## 6. Migration reversal — almost never

Do **not** reverse an applied migration unless **all four** hold:

1. It was explicitly designed to reverse safely.
2. Data preservation is proven, not assumed.
3. The reversal has been rehearsed in a non-production environment.
4. Approval exists.

**No Builder migration meets these conditions**, because none was designed to reverse — they are
additive by design and their rollback strategy is *stop using the new objects*.

If a schema defect must be corrected, **write a new additive forward-fix migration.** Never edit a
merged migration file.

---

## 7. Evidence preservation

Preserve, and do not truncate during an incident:

- `builder_portal_activity_log` — append-only; UPDATE and DELETE raise
- `cross_portal_rollout_history` — insert-only, with a readiness snapshot per transition
- `cross_portal_cutover_approvals` — including revocations, with actor and reason
- `portal_operational_events` / `portal_operational_alerts` — with correlation IDs
- Dead-letter events — ➖ none exist for Builder

Correlation IDs from `record_portal_operational_event` tie a browser action to its function call
and its audit record. Capture them before any remediation.

---

## 8. Data validation after rollback

```sql
-- Domain data survives a rollback intact
SELECT count(*) FROM builder_developments WHERE developer_organisation_id = '<org>';
SELECT count(*) FROM builder_projects;
SELECT count(*) FROM builder_units;
SELECT count(*) FROM builder_transactions;
SELECT count(*) FROM builder_construction_cases;
SELECT count(*) FROM builder_documents;
SELECT count(*) FROM builder_messages;

-- Access is genuinely disabled
SELECT resolve_cross_portal_feature_mode_for('builder', '<org>', 'builder_portal_identity_v1');
-- expect 'rollback' or 'off'

-- No live session remains
SELECT count(*) FROM builder_portal_sessions s
JOIN builder_organisation_memberships m ON m.builder_user_id = s.builder_user_id
WHERE m.organisation_id = '<org>' AND s.revoked_at IS NULL
  AND s.idle_expires_at > now() AND s.absolute_expires_at > now();

-- Approvals survive as evidence
SELECT approval_type, approved_at, revoked_at FROM cross_portal_cutover_approvals
WHERE portal='builder' AND builder_organisation_id = '<org>';

-- Solicitor is unaffected
SELECT count(*) FROM cross_portal_firm_rollouts WHERE portal='solicitor';
```

Counts must match the pre-rollback values exactly. **A rollback that changed a domain count is a
bug, not a rollback.**

---

## 9. Recovery verification and criteria to resume

Before re-enabling an organisation:

1. Root cause identified and fixed, with a forward-fix migration if schema was involved.
2. The fix validated in staging.
3. No open critical Builder alert.
4. Readiness re-evaluated and `ready: true`.
5. Approvals still active — or re-recorded if any were revoked during the incident.
6. **A fresh observation window.** `rollback` clears `stable_since`, and the transition graph
   refuses `rollback → cutover`, so recovery **must** re-enter at `shadow` and observe again.
   This is enforced by the database, not by discipline.
7. Incident review complete, with the correlation IDs and audit records attached.

Then: `rollback → shadow`, observe for `minimum_stable_days`, re-check readiness, and only then
`shadow → cutover`.

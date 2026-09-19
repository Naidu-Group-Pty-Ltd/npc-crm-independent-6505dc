# The script nodes — what is in, what is wrong, and what is left

Base `appFNPL7iYiuQyHAO`. **Three of the four script-bearing automations now
carry their scripts.** One of the three was pasted into the wrong automation and
is described below; the fourth has not been started.

All four are still `undeployed`. Nothing here has ever run.

| Automation | Script node | State |
| --- | --- | --- |
| `wflEQ1wsJH1x7GQhL` Aurixa Lead Capture | `wacH9k8BK7X3AZZSk` | **Correct.** Token script in, bound to the trigger record, one script (the second was correctly omitted), the five recipients trimmed |
| `wflOrWaQohUvhvcFb` Delete Property Intake Records After 30 Days | `wacpsSucgwJXWmGma` | **Correct.** Right script, `tblumTIRYBn92B2ST` in both the finder and the script input |
| `wflz5O9df5UjBzd3X` Delete Records After 30 Days | `wac7vEOnSfX1Pk3kJ` | **Wrong — see below.** Carries the *Property Intake* script and a finder re-pointed at the wrong table |
| `wflIvnXu2Jcs7eQ95` Auto-generate report | — | **Not started.** The placeholder `findRecords` (`wacM5IrEzCPRTTWDy`) is still in the conditional branch |

## The defect: `Delete Records After 30 Days` was pasted from the wrong file

Measured 2026-09-15 against the live base, and cross-checked against both the
legacy source and the as-created rebuild in this directory.

This automation purges **`Properties`**. Its sibling purges **`Property Intake
Master`**. It now holds a mixture of the two, in three places:

| | Legacy source (`wflOUO4qcLHFpMUA8`) | As created (`structure-delete-records-after-30-days.json`) | **Live now** |
| --- | --- | --- | --- |
| `findRecords` table | `tblH9cW4EhVs6D5H1` (Properties) | `tbl7JAawCPdd8QPZP` (Properties) | **`tblumTIRYBn92B2ST` (Property Intake Master)** |
| `findRecords` field | `fldtKYX4KlL42xkVf` | `fld4RX5aE99pzc5R8` (Created) | **`fldp5d8j03aOu74sV` (Created Time)** |
| predicate | `<` `daysAgo` 30 | `<` `daysAgo` 30 | **`>` `daysFromNow` 30** |
| script `inputObj.tableId` | Properties | *(node absent)* | `tbl7JAawCPdd8QPZP` (Properties) |
| script body | the delete | *(node absent)* | the **Property Intake** `PASTE.js`, header and all |

**It is inert today, and that is luck rather than design.** `Created Time >
30 days from now` matches no record, so the loop never runs. The hazard is a
well-meaning repair: correcting the predicate to match its sibling, without also
correcting the table, produces an automation that enumerates `Property Intake
Master` rows and calls `deleteRecordAsync` against `Properties` for each one.

**The fix is in the UI**, for the reason in the next section — the API cannot
edit this automation at all any more. Restore all three:

- `findRecords` → table `tbl7JAawCPdd8QPZP` (Properties), field
  `fld4RX5aE99pzc5R8` (Created), predicate **is before** 30 **days ago**.
- script input `tableId` → `tbl7JAawCPdd8QPZP` (already correct).
- replace the body with
  [`delete-records-after-30-days.PASTE.js`](../../scripts/delete-records-after-30-days.PASTE.js),
  whose header names this automation. The two bodies are functionally identical
  — `base.getTable(tableId).deleteRecordAsync(recordId)` — so only the comment
  header and the finder are actually wrong. Fixing the header matters because
  the header is what the next person reads to decide what the node is for.

## An automation that CONTAINS a script node is read-only in its entirety

This is stronger than what this file used to record, and it was measured rather
than assumed. The earlier probe submitted a customScript node under a *new* key,
which is authoring one. Submitting the automation with its script node's
**persisted key preserved**, changing only the `findRecords` beside it, is
refused too — and the refusal names the graph rather than the node:

```json
{"isValid":false,"errors":[{"node":"graph",
 "message":"This automation contains a read-only node (customScript) that cannot be edited through the API. Edit this automation in the Airtable UI instead.",
 "details":{"kind":"readOnlyNodeType","providedNodeType":"customScript"}}]}
```

`update_automation` is a full replacement, so there is no way to send the rest
of the graph without sending the script node with it. **Once a script is pasted,
every part of that automation — its name, its description, its trigger, and
every other node — can only be changed by hand.** Confirmed non-destructive: a
re-read afterwards returned the prior configuration byte for byte, so validation
is atomic and runs before the write.

Two consequences worth knowing before pasting the fourth script:

- The defect above cannot be repaired from here. It is UI work.
- **The descriptions on the three finished automations are now false.** Each
  still opens `STRUCTURE ONLY — the script is missing`, written when that was
  true, and the API can no longer correct them. Correct them by hand in the same
  sitting, or the next person will read a runbook that contradicts the automation
  it is attached to.

Paid plan is not the variable, and never was: scripting automations exist on
every Airtable tier and this base already has `create` permission. The limit is
in the MCP automation API. Worth recording because the tool *schema* advertises
support — `customScript` is in the creatable `type` enum, `outputSchema` and
`secrets` are both documented "For customScript actions only", and it is absent
from the spec's own "Exists but not creatable here" list. Every readable signal
says yes and the server says no, which is why this is settled by effect.

## The property-intake purge clock is spent

Earlier versions of this file led with a hazard: all 148 migrated
`Property Intake Master` rows carried the same `CREATED_TIME()` stamp of
`2026-08-18T13:20:37`, so they came due together on **2026-09-17** and the first
run would purge every one at once.

**Those 148 rows are gone** — cleared on 2026-09-15, before that date arrived,
because they were empty shells (the migration wrote at most one populated field
on any record, and only 51 of 148 had even that). There is nothing left for that
first run to sweep up.

The clock was only ever wrong for the migrated rows. Anything written after the
copy gets a genuine `CREATED_TIME()`, so **the automation is now correct as
configured** and needs no change. Still leave it off until this base is actually
taking intake — see
[`BASE_BACKFILL.md`](../../../../../../listings/BASE_BACKFILL.md) for where that
stands.

## The id map was never incomplete

[`README.md`](./README.md) says `_id-map.json` "covers 24 of the 54 ids the
bundle references". That is wrong. Counted: `id-references.json` holds **54**
ids — 1 base, 6 tables, 37 fields and **10 automations** — and `_id-map.json`
holds **44**: the base, all 6 tables and all 37 fields. **Zero `tbl…` or `fld…`
ids are unmapped.** The 10 left over are `wfl…` *automation* ids, which are not
remappable references; each rebuilt automation was minted a fresh id, recorded
in this directory's README.

| Table | Legacy | Rebuilt |
| --- | --- | --- |
| `Properties` | `tblH9cW4EhVs6D5H1` | `tbl7JAawCPdd8QPZP` |
| `Property Intake Master` | `tblWIg5cs85O30pcY` | `tblumTIRYBn92B2ST` |
| `Aurixa Waitlist` | `tblHzGiB591W3GpoZ` | `tblaSuqLKa00rqdtu` |

Those three were re-derived independently by reading them back off the live
rebuilt automations, and agree with the map exactly.

## What is left

### 1 — Repair `wflz5O9df5UjBzd3X`

Per the defect section above. Zero risk while it is off, and it targets
`Properties`, which holds 0 records.

### 2 — Finish `wflIvnXu2Jcs7eQ95` · Auto-generate report

Delete the placeholder `findRecords` (`wacM5IrEzCPRTTWDy`) inside the
conditional branch and put a Run script in its place, pasting
[`auto-generate-report.PASTE.js`](../../scripts/auto-generate-report.PASTE.js),
which names all ten input variables including `webhookSecret`.
[`AUTO_GENERATE_REPORT.md`](./AUTO_GENERATE_REPORT.md) carries the longer
reasoning.

**`AUTO_REPORT_WEBHOOK_SECRET` is set. Measured 2026-09-15, not assumed.**

This was recorded for three sessions as the one thing nobody could check from
outside the Supabase project. It is checkable, and the endpoint's own audit
trail is what makes it so.

`auto-report-webhook` reads `x-webhook-secret` and constant-time compares it
against `AUTO_REPORT_WEBHOOK_SECRET`, with `verify_jwt = false` at the gateway.
It answers **401 with an identical body** whether the variable is unset or the
presented secret is merely wrong — so the response tells you nothing. But it
writes a `security_events` row *before* returning, and that row's `reason_code`
is chosen as:

```js
reason_code: expectedSecret.length < 16
  ? 'webhook_secret_unconfigured'
  : (internal.errorCode ?? 'invalid_secret')
```

So the discriminator is a single value: **`webhook_secret_unconfigured` means
unset or shorter than 16 characters; anything else means it is configured.**

The probe: one deliberately-wrong request, then read the newest
`security_events` row for `action = 'auto_report_webhook.invoke'`. Egress from
a developer machine may be blocked, in which case `pg_net` makes the call from
inside the project itself — `net.http_post(...)`, then read `status_code` from
`net._http_response` and the row from `security_events`.

Executed 2026-09-15: HTTP 401, and the row read
`decision: deny, reason_code: missing_credentials, actor_type: webhook` — the
`internal.errorCode` branch, which is only reachable when the expected secret is
at least 16 characters. **The secret is configured**, `security_events` had zero
prior rows for this action (the endpoint had never been invoked), and the probe
cost nothing: it creates no report, calls no model and spends no credential.

What remains unknown from here is the secret's **value**, which is deliberate —
nothing outside the project should be able to read it. Whoever pastes the script
needs to copy it from Supabase → Edge Functions → Secrets into the
`webhookSecret` input. Note the standing caveat that a script input is not a
secret store: anyone who can edit this base can then read it.

### 3 — Correct the three stale descriptions

They say the scripts are missing. The scripts are not missing. UI only, per the
read-only rule above.

### 4 — Then decide about deployment

All four remain `undeployed`. Two of the automations in this base send email to
five real addresses and one deletes permanently. Turn them on one at a time,
after a test run, in the order above.

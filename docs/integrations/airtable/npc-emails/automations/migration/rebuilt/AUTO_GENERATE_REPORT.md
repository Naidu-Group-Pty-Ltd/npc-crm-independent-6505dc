# Finishing `Auto-generate report`

Automation **`wflIvnXu2Jcs7eQ95`** in base `appFNPL7iYiuQyHAO`
([open it](https://airtable.com/appFNPL7iYiuQyHAO/wflIvnXu2Jcs7eQ95)). It exists,
it is **off**, and it is the one automation in this migration that the API cannot
finish. This is the rest of the job.

## What is already there

| | |
| --- | --- |
| Trigger | **When record created** in `Properties` (`tbl7JAawCPdd8QPZP`) |
| Node 1 | **Conditional** — `Address` is not empty |
| Node 1 → branch | a **placeholder `Find records`**, which is not in the source |

The placeholder is scaffolding, not behaviour. `create_automation` refuses an
empty conditional branch outside a loop (`emptyBranchNotNested`) and refuses to
author a script node (`readOnlyNodeType`) — so with the source's exact contents
the automation has zero creatable nodes, and an automation must have at least
one. One inert node is what makes it exist at all. It reads a single `Properties`
row and discards it.

## Two corrections to earlier notes in this bundle

Both were carried from [`../../README.md`](../README.md) and are wrong. They
changed the work, so they are recorded rather than quietly dropped.

**The Supabase URL does not need re-pointing.** `dduzbchuswwbefdunfct` is the
**live** `NPC Property Dashboard` project (`ACTIVE_HEALTHY`), not a project being
migrated away from, and `auto-report-webhook` is deployed there — `ACTIVE`,
version 52, last updated 2026-08-11, `verify_jwt: false` at the gateway. Leave
the URL alone.

**The exported script is broken, for a different reason.** `verify_jwt: false`
is not "open": the function fails closed on its own. Since **2026-08-15**
(commit `c76bcd9`) it accepts an internal service call **or** a constant-time
comparison against `AUTO_REPORT_WEBHOOK_SECRET` presented in `x-webhook-secret`,
and returns **401** to everything else. The exported script sends no credential,
so it is refused — and because it calls `response.json()` and logs whatever comes
back, the 401 is logged as though it were a result and the run still succeeds.
The source automation has been in this state since three days before it was
exported. Nobody noticed because it triggers on `Properties`, which holds **0
records**, so it has never fired.

Use [`../../scripts/auto-generate-report.CORRECTED.js`](../scripts/auto-generate-report.CORRECTED.js),
not the verbatim export beside it.

## Steps

1. Open the automation and select the placeholder **Find records** inside the
   conditional branch. Delete it.
2. Add **Run script** in its place.
3. Add these input variables. Names are what the script reads; every value comes
   from the trigger record unless noted.

   | Variable | Source |
   | --- | --- |
   | `recordId` | Airtable record ID |
   | `address` | `Address` |
   | `suburb` | `Suburb` |
   | `propertyType` | `Property Type` |
   | `price` | `Price` |
   | `beds` | `Beds` |
   | `baths` | `Baths` |
   | `state` | `State` |
   | `propertyName` | `Project Name` |
   | `webhookSecret` | **not a field** — paste the value of `AUTO_REPORT_WEBHOOK_SECRET` |

   `propertyName` reads **`Project Name`**, which is what the source bound. The
   nine field names are unchanged from the source base; only their ids differ.

4. Paste `auto-generate-report.CORRECTED.js`.
5. Get `AUTO_REPORT_WEBHOOK_SECRET` from the Supabase project's Edge Function
   secrets and paste it as the `webhookSecret` value.
6. **Test with a real record before enabling.** The corrected script throws on a
   non-2xx, so a bad secret fails the run visibly instead of logging a 401 as a
   result.

## Before you enable it

**A script input is not a secret store.** Anyone who can edit this base can read
the `webhookSecret` value. That is a real downgrade from the endpoint's own
threat model — it creates investment-report records and invokes the paid report
generator with the service role. If the base's editor list is wider than the
people who should hold that secret, call the endpoint from somewhere that can
hold one (a Make scenario with a connection, or an edge function) and have
Airtable trigger that instead.

**The conditional still does nothing on its own.** Its condition is carried
verbatim from the source, where the branch was empty — so the gate has never
selected anything. Once the script sits inside the branch the gate becomes real
for the first time: reports will only be generated for rows with an `Address`.
That is almost certainly what was intended, but it is new behaviour, not
restored behaviour.

**It cannot fire yet.** `Properties` holds 0 records in this base, and nothing
currently writes to it. Enabling this changes nothing until something does.

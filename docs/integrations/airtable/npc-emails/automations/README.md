# NPC Emails — Airtable automations

All **10 automations** in the `NPC Emails` base (`apptyShYE0yzL4IGB`), exported
**2026-08-18** and prepared for rebuild in a different Airtable account.

9 are deployed, 1 is an empty undeployed stub. `manifest.json` is the index.

## The split that decides the work

**6 of the 10 can be recreated through the API. 4 cannot**, because they contain
`customScript` nodes — 5 script nodes in total.

`customScript` does not appear in the creatable action catalog returned by
`get_create_automation_instructions`, and
[`../../AIRTABLE_RETENTION.md`](../../AIRTABLE_RETENTION.md) records this base's
own experience of it: `create_automation` and `update_automation` both reject
`customScript` with `readOnlyNodeType`, by design. A script node has to be added
in the Airtable UI by hand.

**Re-tested 2026-09-15 on the paid account: it still refuses.** The accounts
being paid does not move this — the limit is in the MCP automation API, not the
licence. The probe, and a paste runbook with every new-base id already resolved,
are in
[`migration/rebuilt/SCRIPT_NODES.md`](./migration/rebuilt/SCRIPT_NODES.md).

That is why every script body is extracted to a real `.js` file under
`scripts/` rather than left inside JSON. A script escaped into a JSON string is
not pasteable; a file is. Each carries a header naming its source automation,
its node key, and the input variables the node declares — those have to be
re-created in the UI too, or `input.config()` returns nothing.

| | Automations |
| --- | --- |
| **API-creatable** | Link Stage 2 detailed response to applicant · Link Stage 2 response to applicant · Link Stage 3 booking to applicant · Notify Aurixa Team on New Business Readiness Submission · Send Confirmation Email on New Business Readiness Response · Automation 1 |
| **Manual script paste** | Aurixa Lead Capture (2 scripts) · Auto-generate report (1) · Delete Records After 30 Days (1) · Delete Property Intake Records After 30 Days (1) |

## Everything here is written in ids

An automation is almost entirely `tbl…` and `fld…` references — in the trigger,
in every filter, in every field mapping, and in the `inputObj` that feeds each
script. **54 distinct ids** are referenced across the ten, and the target base
mints all of them fresh.

`migration/id-references.json` resolves every one of those 54 to the table or
field name it points at. That mapping is the whole job: rebuilding an automation
means replaying its structure with the new ids substituted, and names are the
only thing that survives the move.

Two scripts are already name-based and need no substitution —
`Aurixa Lead Capture` calls `base.getTable("Aurixa Waitlist")` and writes
`"Token"` / `"Bypass URL"` by name. The two purge scripts take their table id
through an input variable, so the id lives in the node config rather than the
script body, and only the config needs remapping.

## Layout

| Path | What it is |
| --- | --- |
| `manifest.json` | Index — trigger, node types, script list, API-creatable flag, referenced ids |
| `source/<slug>.<id>.json` | The automation verbatim, as `get_automation` returned it |
| `scripts/<slug>.<node>.js` | Extracted script bodies, ready to paste |
| `migration/id-references.json` | All 54 referenced ids resolved to table/field names |

## Rebuild order

1. **Migrate the base first.** Tables, fields and records must exist before an
   automation can reference them — see [`../README.md`](../README.md).
2. **Create the 6 API-creatable automations**, substituting new table and field
   ids from `id-references.json`.
3. **Create the 4 script-bearing automations' structure** (trigger, findRecords,
   groups), then in the Airtable UI add each `customScript` node, declare its
   input variables, and paste the matching file from `scripts/`.
4. **Leave everything undeployed until checked.** These automations send email to
   five real addresses and one of them deletes records permanently.

## What the export found

Worth reading before rebuilding any of these — several are not worth carrying
across as they stand.

**`Auto-generate report` has never fired, and cannot.** It triggers on record
creation in `Properties`, which holds **0 records**. It also contains a
`conditionalGroup` whose only branch has an empty node list, so even if it fired
the conditional would do nothing.

> **Corrected 2026-08-18.** This paragraph used to end by saying the script's
> Supabase URL "needs re-pointing at the new project". That was wrong twice
> over, and
> [`migration/rebuilt/AUTO_GENERATE_REPORT.md`](./migration/rebuilt/AUTO_GENERATE_REPORT.md)
> records the checks. `dduzbchuswwbefdunfct` is the **live** NPC Property
> Dashboard project and `auto-report-webhook` is deployed and active there, so
> the URL is correct as written. What is actually broken is the credential: the
> function has failed closed since **2026-08-15** (commit `c76bcd9`), requiring
> `x-webhook-secret`, and the exported script sends none — so it gets a **401**
> which it logs as a result and reports as success. Use
> [`scripts/auto-generate-report.CORRECTED.js`](./scripts/auto-generate-report.CORRECTED.js).

**`Delete Records After 30 Days` has nothing to purge**, for the same reason:
it targets `Properties`, which is empty.

**`Automation 1` is an empty stub** — undeployed, `genericWebhookReceived`, zero
nodes. Its webhook URL is live-looking but nothing consumes it. Do not migrate.

**`Aurixa Lead Capture` has three defects worth fixing during the move.**
Its second script is a **busy-wait loop** that blocks the automation runtime
rather than sleeping; the comment says 60 seconds while the code says
`delayDuration = 10000` (10 seconds), so the comment and the behaviour disagree.
Its token is generated with `Math.random()` while the comment calls it "secure,
pseudo-random" — that token is what gates the Stage-2 questionnaire URL, so it is
a guessable access token, not a secure one. And **four of its five recipient
addresses carry a leading space** (`" rugesh@aurixasystems.com.au"` and three
others); the sibling automation `Notify Aurixa Team…` has the same five addresses
with no spaces, which is what they should look like.

**The three "Link … to applicant" automations are the ones that matter.** They
are what makes the Aurixa funnel's stage tracking work — resolving an Application
ID into a real link so Stage 1 and Stage 2 can see that an applicant progressed.
All three are API-creatable, all three are well documented in their own
`description` field, and all three follow the same shape: `findRecords` on
`Aurixa Waitlist` matching an upper-cased, trimmed Application ID Key, then a
conditional that only writes when a match was found. They carry the base's link
structure, so they should be rebuilt after the link fields exist.

## A correction to the earlier audit

[`../AUDIT.md`](../AUDIT.md) stated that the Property Intake retention purge "is
still a draft with its script step empty, so it has never run". **That is wrong.**
`Delete Property Intake Records After 30 Days` is `deployed`, and its script node
`wacPNnMrRaCKL5iEJ` contains the delete script. The manual step that
`AIRTABLE_RETENTION.md` describes has since been completed, and that document is
now stale on this point.

The audit's conclusion is unaffected: all 148 `Property Intake Master` records
were created between 2026-07-23 and 2026-08-04, so every one of them is still
inside the 30-day window and the purge would not have touched them yet either
way. The records are empty because the pipelines that wrote them wrote nothing,
not because anything deleted their contents. Only the reasoning was wrong; the
finding stands.

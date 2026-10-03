# The CRM this deployment actually is

This deployment is a clone of the NPC property dashboard whose CRM is **its own
database**, not GoHighLevel. This document records what that turned out to
mean, what is built, and — at least as importantly — what is not.

Read it before touching `_shared/crm/*`, the outbound path in
`crm-send-message`, or anything that decides where a contact, conversation,
appointment or opportunity lives.

## A closed system: this line carries none of GoHighLevel

This repository is the head of the **CRM-independent line**, not a pure clone
of the prime. It is a variant that does not depend on the GoHighLevel
integration at all, and since 29 Sep 2026 it does not carry it either.

**What left the tree.** Nineteen edge functions (`backfill-lead-attributions`,
`backfill-message-directions`, `backfill-notes-to-ghl`,
`conversation-sync-cron`, `diagnose-ghl-attribution`, `ghl-calendar`,
`ghl-calendar-proxy`, `ghl-calendar-test`, `ghl-conversations-cron`,
`ghl-webhook-receiver`, `import-clients-from-ghl`,
`one-time-bulk-conversation-sync`, `send-ghl-message`, `sync-client-to-ghl`,
`sync-ghl-conversations`, `sync-ghl-marketing-assets`, `sync-ghl-pipelines`,
`sync-notes-to-ghl`, `update-ghl-opportunity-stage`), the four `_shared/`
modules only they use, the specs whose subject they were, and their
`config.toml` blocks, security-registry entries and baselines.

**Who keeps it out.** Aurixa Mission Control withholds the integration from
this line **by class**, keyed on the clone's recorded `crm_mode`
(`src/server/crmLineFeatures.pure.ts` there). The cascade never writes those
paths here, the deploy lanes never deploy those functions, the fleet sweep
undeploys any that are live and unschedules the crons that call them, and
parity does not count their absence. A conversion to the dependent line
restores them; a conversion to this line removes them. The list is a literal
at each end: `scripts/lib/crmLineFeatures.mjs` here (read by the CI gates),
`WITHHELD_CRM_FUNCTIONS` in `src/lib/crm/crmProvider.ts` (read by the
browser), and `crmLineFeatures.spec.ts` holds the two to each other and to
the tree.

**A deployment the tree no longer carries is removed by a person.** A
project provisioned from the prime still has the nineteen functions deployed
until something deletes them. The fleet sweep does that on a repair; the
`Decommission withheld GoHighLevel functions` workflow
(`decommission-crm-line-functions.yml`) does it on dispatch, reading its list
from `crmLineFeatures.mjs`, refusing any name whose directory is still in the
tree, and resolving the project as the deploy workflow does, so a child of
this head deletes from its own project. On 1 Oct 2026 the head's own project
still ran all nineteen and four crons calling them; the crons were
unscheduled by hand that day, and `finance-portal-reminders-hourly`, which a
cascaded migration had pointed at the PRIME's URL with this project's cron
secret, was re-pointed through `cron_invoke_signed_function`.

**What stayed, deliberately.** The schema: `ghl_conversations` and its
siblings are this CRM's own storage, and a withheld migration is a ledger
hole. The mixed modules the line still reads (`_shared/ghl-account.ts`,
`_shared/ghlConversationMap.pure.ts`). And the three `crm-*` functions, which
ARE this line's CRM.

Five rules carry it.

- **The router is native-only.** `isNativeCrm()` is always true here,
  `crmFunction()` only ever names a `crm-*` function, and the vendor
  reconciliation steps have no name to hand back. A build told `ghl` warns
  once and stays native, because there is nothing on the other side.
- **A browser call to a withheld function never leaves the browser.**
  `invokeSecureFunction` answers it locally with `crm_function_not_carried`,
  not retryable, rather than letting a gateway that has never heard of the
  function answer 404.
- **No server code calls a withheld function either.** The browser refusal
  covers `invokeSecureFunction` only; an edge function posting to
  `/functions/v1/<name>` reaches the gateway directly and reads the 404 as a
  failed sync or an empty calendar. `ai-dashboard-agent`'s calendar tools now
  call `crm-calendar`, its `create_client` and `finance-portal-client-data`
  no longer sync to GoHighLevel, and `crmLineFeatures.spec.ts` fails on any
  server source that names a withheld function by URL or `functions.invoke`.
- **A GoHighLevel control is not drawn.** Every sync toggle, import button,
  "View in GHL" link and pending-sync count is gated on
  `ghlAffordancesAvailable()`, which is false here. Each of those files is a
  head variant and is reconciled by hand rather than overwritten by a prime
  cascade.
- **The one send path carries the vendor path's authorisation.**
  `crm-send-message` now demands `conversations:can_edit` and scopes the
  conversation to the caller's own clients (404, not 403) before the
  idempotency read and the provider call, and
  `check-ghl-message-authz.mjs` holds every send path the tree carries to
  that rule. Before, it checked a signed-in user and nothing else, and the
  vendor function beside it was the only one held to the rule.

## What the coupling actually was

The instinct is that "remove GoHighLevel" is a 64-file job. Measured on this
clone, 19 Sep 2026:

| Reading | Count |
|---|---|
| Edge functions naming GHL | 64 |
| Edge functions reaching `services.leadconnectorhq.com` | 41 |
| `src/` files naming GHL | 73 |
| **`src/` files calling the vendor** | **0** |

**No browser code has ever called GoHighLevel.** Every surface — the clients
page, the client tracker, CRM conversations, the calendar — reads local
`ghl_*` tables. Those tables exist on this clone already: provisioning
replicated the prime's schema exactly (529 tables, 435 functions, 401
triggers, 83 enums, all equal).

So this is not a deployment that is mostly broken. It is a deployment where
**every page renders, every list draws, and nothing fills the tables or
carries a message out.** That is the more dangerous shape, because it looks
like it works.

## The switch, and where it lives

`CRM_PROVIDER` is read in exactly one module — `_shared/crm/crmProvider.pure.ts`
— and every surface reaches a CRM function through `crmFunction(capability)`
rather than by spelling its name. `crmIndependence.spec.ts` asserts that: a
literal at a call site reaches one provider whatever the deployment is set to,
and it keeps working, which is why it is asserted rather than trusted.

The routing table is the whole contract:

| Capability | `ghl` | `native` |
|---|---|---|
| `calendar` | `ghl-calendar` | `crm-calendar` |
| `sendMessage` | `send-ghl-message` | `crm-send-message` |

**Two capabilities and not four, and which two is the finding.**
`conversationSync` and `opportunityStage` were rows of that table, naming
`crm-conversations` and `crm-pipelines`. Neither function exists anywhere in
this repository, so on a native deployment both surfaces would have invoked a
URL that answers 404 — a dead control, which this repository has shipped once
already on the AUSTRAC path card.

Writing the two functions would not have fixed it, because the defect is in the
mapping rather than in the gap. Both are acts that **reconcile this deployment
with GoHighLevel**, and under `native` there is nothing on the other side:

- `conversationSync` **pulls** threads from GoHighLevel into our tables. Under
  `native` the threads are already in our tables — `crm-send-message` wrote
  them there. A `crm-conversations` function could only do nothing, or copy a
  row onto itself.
- `opportunityStage` **pushes** a stage change to GoHighLevel, and both of its
  call sites run it *after* the local write has already succeeded. Read
  `ClientTracker.tsx`: the error branch says "local update succeeded, just log
  GHL failure". Under `native` the local write **is** the act, and a
  `crm-pipelines` function would re-perform a write the page has already made —
  two writes to one row, which is how two writes come to disagree.

So they live in `VENDOR_RECONCILIATION` instead, and
`vendorReconciliationFunction(step)` returns **null** under `native`. A caller
cannot invoke a function it was not given, which makes the absence structural
rather than a rule a test has to police. Null is not an error and is never
reported as one: it means the act is complete without it. The two controls that
reach them — Conversations' **Sync** and the client tab's two refreshes — are
**absent** under `native`, not disabled, because a disabled button claims the
act exists and is briefly unavailable and here it can never become available.

The names still live in the router, so `crmIndependence.spec.ts`'s "one module
spells a CRM function name" rule is unchanged, and five assertions hold the
shape: the router withholds the name under `native`; it may not spell
`crm-conversations` or `crm-pipelines` at all; neither directory may exist;
every call site must **bind** the answer to a name it can test for null,
counted rather than sampled; and no call site may `!` the null away.

That "counted rather than sampled" is not a flourish. The first version of the
binding assertion asked whether the FILE contained a binding, which a file with
two call sites passes while one of them writes
`invokeSecureFunction(vendorReconciliationFunction("…")!, …)`. Planted, it
passed; counted, it fails.

**The browser and the server resolve differently, and that asymmetry is real.**
A bundle cannot see a project secret, so it cannot know whether this deployment
holds a GoHighLevel account; it defaults to `native`. The server reads the
credentials — `resolveCrmProviderFromEnv` — because `DEFAULT_CRM_PROVIDER` is
`native`, and a deployment holding a live account that has simply never set
`CRM_PROVIDER` would otherwise resolve `native` by omission and move a tenant's
conversations to a different system of record. Both halves stamp the provider
that served a request (`x-crm-provider`), because the bundle and the edge
functions deploy separately and a half-flipped deployment must be noticed
rather than rendered.

## Outbound messaging

The waist is narrow: **one capability, two callers** — `Conversations.tsx` and
`ClientConversationsTab.tsx`.

Before this, on a native deployment, every send reached
`send-ghl-message`'s credential check and answered
`500 { error: "GHL API key not configured" }`, **writing nothing**. A 500 for a
settled configuration; no record the operator ever tried; and a sentence naming
a vendor this product is not using.

Worse are the sentences that path *can* produce — *"This contact does not have
a valid mobile number."*, *"This contact has opted out of SMS
communications."* On a deployment with no sender those are libel about
somebody's customer: the number is fine, and the reason nothing was delivered
is that there is nothing here to send with. The location service already paid
for this rule — `geocoder_unavailable` and `geocoder_not_attempted` exist so a
missing provider is never reported as a bad address.

`crm-send-message` answers instead, and `send-ghl-message` is left **byte
identical to the prime's**, so a later prime cascade merges rather than
conflicts.

## Three rules that carry it

**An explicit setting is never overruled by a credential's absence.** A
deployment set to `ghl` with no key stays `ghl` and reports the absence
separately. A CRM must not change identity because a secret expired.

**A word this build has never heard of is not a provider.** The vocabulary is
an allow-list; anything else warns and falls through to what the credentials
say. This is the activation gate's lesson: `reason !== "operator_locked"`
answered yes to every unrecognised word, `unknown` included.

**A refusal is recorded, and never as a delivery.** `planMayRecordDelivery` is
one exported expression, asked rather than trusted. A row claiming delivery
when nothing left the building is undiscoverable from the operator's side and
leaves a client waiting for a reply nobody sent.

## What is built

- `_shared/crm/crmProvider.pure.ts` — the rule, browser-safe.
- `_shared/crm/crmProvider.ts` / `src/lib/crm/crmProvider.ts` — the two runtime
  readers and the router.
- `_shared/crm/nativeOutbound.pure.ts` — what a native deployment does with one
  message, decided before anything is sent or written.
- `_shared/crm/calendarProjection.pure.ts` — the vendor's response shapes, out
  of our own tables, with wall-clock arithmetic asserted across both Australian
  DST transitions.
- `crm-calendar`, `crm-send-message` and `crm-inbound-message`, all three
  refusing when the deployment is not `native`.
- `_shared/crm/nativeInbound.pure.ts` — verify, then place, then write,
  with the order asserted rather than assumed.
- `20261229090000_native_crm_tables.sql` — nine `crm_*` tables, RLS on all of
  them, executed against a real PostgreSQL 16: 9 tables, 36 policies, 0
  unindexed foreign keys, 8 bad-row cases refused, idempotent on re-run.
  It was drafted here as `20261205000000_native_crm_tables.sql`, which no
  database ever ran: Mission Control sends a clone only what the prime's own
  ledger records, so a migration written on a clone never reaches its
  database. The same text was written at the prime (prime #2802), applied
  there on 28 Sep 2026, and drained to every clone, this one included. The
  draft is deleted, so the two cannot both be offered to one database.
- 158 tests across six files, several of them source contracts — the
  guarantees here are ORDERINGS and ABSENCES, which no unit test sees.

## What is NOT built, stated plainly

| Gap | Consequence today |
|---|---|
| **No SMS credentials anywhere** | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` are set on no deployment and carry **no fleet forward policy row**. Native SMS refuses every send with `not_configured` — correctly and legibly, but it refuses. |
| **No WhatsApp sender** | Refused as `not_implemented`, on a ground no credential changes. |
| **Inbound is built but unexercised** | `crm-inbound-message` receives a Twilio SMS and writes the thread. With no `TWILIO_AUTH_TOKEN` on any deployment it refuses every request — correctly, since the token IS the signature key — so the path has never run against a real delivery. |
| **No native pipeline or conversation *reconciliation*** | By design, not by omission — see the routing table above. What a native deployment does NOT yet have is an inbound path to fill the threads in the first place (the row above). |
| **The `sync-ghl-*` workers** | Not carried on this line (see above). The `ghl-migrate-*` account-migration workers are the prime's alone and never reach any clone. |

`RESEND_API_KEY` is `authorised_no_value` on this clone — the fleet policy says
forward it and Mission Control holds no value — so email is in the same
position as SMS.

## The reply, and why it is the one that could hurt

`crm-send-message` closed the outbound half. A client's **reply** had nowhere
to arrive: under `ghl` it reaches `ghl-webhook-receiver`, and under `native`
nothing was listening, so every native thread was one side talking.
`crm-inbound-message` is the other half — and it is the only `crm-*` function a
stranger can reach.

Every other one is called by a signed-in operator behind `verify_jwt`. This one
declares `verify_jwt = false`, because Twilio holds no Supabase JWT. So
`X-Twilio-Signature` is not *part* of the authentication, it **is** the
authentication, and three rules follow.

**A deployment that cannot verify refuses everything.** The verification key is
`TWILIO_AUTH_TOKEN`; without it this endpoint cannot tell Twilio from anybody
who found the URL, and "accept because we cannot check" is an open write
endpoint into customer records. It fails closed, like `STEP_UP_ENFORCED` when
unset and like `osmAllowance` on a counter nobody can read. A test plants the
fail-open and watches it fail.

**Every refusal answers one status and one word.** A webhook that tells one
prober *"no auth token configured"* and another *"bad signature"* has described
its own configuration and confirmed the endpoint is worth grinding at. The
operator gets the distinction in the function log, where the reader is trusted.
The assertion pins the body argument to the shared constant, because the first
version scanned for the names that might carry a reason and a planted
`new Response(reason, …)` went straight through it.

**It creates no client.** A message from a number this deployment does not know
is still recorded, against a conversation carrying the number and a null
`client_id`. Inventing a client from an SMS is how a CRM fills with people
nobody added; linking it is an operator's decision.

Two smaller things the tests hold: it is idempotent on the **provider's**
`MessageSid`, because Twilio retries anything it did not get a 2xx for and a
retry must not become a second copy of one reply; and the TwiML it answers is
empty, because any word inside `<Response>` is delivered to the customer as an
SMS from this deployment.

The signature base — the URL followed by every parameter in key order, name
then value, no separators — is checked against Twilio's own published worked
example rather than against my reading of it.

## Opening a thread, and one address for both ends

Until 3 Oct 2026 the inbound webhook was the only writer of
`ghl_conversations` on a native deployment. Staff could answer a client who had
texted first and could never speak first. `crm-send-message` now answers
`action: 'open_conversation'` through `_shared/crm/openNativeConversation.ts`.
The Conversations page offers it as **New conversation**, and a client's
Conversations tab as **Start conversation**. Both are drawn only where
`isNativeCrm()` holds.

Three rules carry it.

- **One thread per client, whichever end opened it.** A thread is looked up by
  its key first, then by the client. One that already exists is returned, never
  duplicated. A race between two operators resolves through
  `uq_ghl_conversation` to the row that won.
- **A client nobody can reach gets no thread.** With no usable mobile and no
  email there is no channel to speak on. A composer that cannot send is a dead
  control, so the refusal names the record to fix.
- **It asks the send path's own questions.** It runs after the
  `conversations:can_edit` check and asks the same ownership question. It
  answers 404 in the same words, so a client the caller may not reach cannot be
  told apart from one that does not exist.

**Both ends must address the same line, and they did not.** `primary_mobile`
holds whatever a person typed (`0412 345 678`, `+61 412 345 678`). Twilio sends
and accepts E.164 only. So the outbound path handed Twilio a number it rejects.
The inbound path matched the raw string exactly and linked almost nobody, and
filed every reply under a key no operator-opened thread could share.
`australianMobileToE164` (`nativeConversation.pure.ts`) is now the one reading
for all three:

- the number a send goes to;
- the key a thread is filed under (`native-sms-<E.164>`, or
  `native-client-<id>` for a client with no mobile);
- the client an inbound number belongs to.

That last lookup asks for every form a person commonly types, as literal values
in `.in()` rather than a composed filter. It then **confirms** each candidate by
normalising the stored value, and links a client only when exactly one holds the
line. A number shared by two records, or one ending in the same digits in
another country, links nobody. Deciding who somebody is stays a person's call.

A number that names its own country is kept rather than re-read as Australian.
A value that cannot be read as a number is refused by name, as a fault in the
client's record, rather than sent and rejected by the provider.

A sent **email** also failed to reach its history, on both lines.
`Conversations.tsx` recorded it against the thread's provider key, which is
text, in a column that is the thread's uuid foreign key. The row was refused, so
every email reply vanished from the conversation after the refetch. It records
against the row id now. The same defect is on the prime and is fixed there too,
because a clone-side fix to a file the prime also holds is reverted by the next
cascade.

## Calendars a deployment can set up, and bookings that respect them

`crm-calendar` read and wrote appointments from the first native version, but
nothing wrote a **calendar**. GoHighLevel owned calendar setup, so on this line
`crm_calendars`, `crm_calendar_members` and `crm_calendar_availability` had no
writer at all. A fresh deployment had nothing to book into, and the page's
calendar list was empty with no way to fill it.

Five actions on `crm-calendar` are that writer now: `listCalendarSettings`,
`createCalendar`, `updateCalendar`, `setCalendarMembers` and `setAvailability`.
The Calendar page offers them as **Manage calendars**, a dialog with three tabs
(details, team, opening hours). It is drawn only for somebody with edit rights
on the `calendar` module.

The panel (`src/components/calendar/native/CalendarSetup.tsx`) exists only on
this line. `Calendar.tsx` is shared with the prime and finds the panel through
`import.meta.glob`, which answers an empty record for a missing file. So the
prime builds without the panel and draws nothing extra, the page stays
byte-identical on both lines, and a cascade cannot revert it. The same edit
landed on the prime in the same change. `calendarSetup.test.ts` fails if the
glob stops naming a file this line holds, because a rename would otherwise
remove the only way to create a calendar while every other check stayed green.

Four rules carry it.

- **Every action is gated on the `calendar` module permission** the page itself
  reads. Reading needs view; booking, moving, blocking and every setup action
  need edit. A client's appointments tab is also readable with view on
  `client_management`, because it sits on the client's page. Before this, any
  signed-in session could write any calendar.
- **A booking is checked against the calendar, not just the clock.** The time
  must fall inside the calendar's published hours, read in the calendar's own
  time zone, and must not overlap anything already booked or blocked on it. A
  read that failed refuses the booking (503) rather than waving a double-booking
  through. A calendar that was switched off takes no new bookings. A blocked time
  may sit over anything, because that is what blocking is for.
  `overrideAvailability` lets a booking past the hours and the overlap check
  deliberately.
- **The form refuses what the server refuses, in the same words.**
  `calendarSetup.pure.ts` sends the form's hours through the server's own
  `readAvailability` (`_shared/crm/calendarBooking.pure.ts`), not a copy of its
  rules. A time input cannot say "24:00", so an end of 00:00 means the hours run
  to midnight.
- **Nothing is left half-written.** New hours and a new team are written before
  the old ones are removed, and the old ones are removed by id. A failure part
  way leaves the previous hours standing, or too many team members, never none.
  A calendar is never hard-deleted, because that would cascade its appointments
  away. Switched off, it leaves the booking list and keeps its history.

A reschedule also failed silently before this. The page and the dashboard agent
send `newStartTime`/`newEndTime`, the action read only `startTime`/`endTime`, and
it reported success having moved nothing. Both spellings are read now.

## Pipelines for all staff, and a card that stays where it was put

The Client Tracker is where this line keeps its pipelines, and four faults
meant it worked only for an administrator. Even for them, a card could vanish.

- **Staff opened it to "No Pipelines".** Every operation on
  `manage-automation-settings` sat behind one admin-only check. That included
  the board's first two reads (`getPipelines`, `getStages`), so somebody given
  the Client Tracker could open the page and read nothing on it.
- **A moved client vanished from the pipeline they were moved into.** A move
  set `current_stage_id` and never `current_pipeline_id`, and the board filters
  a pipeline by that column. The client still appeared under "All pipelines"
  and disappeared from the pipeline's own view.
- **Nothing wrote a placement.** The board places a card by its
  `ghl_client_opportunities` rows first. On the prime the GoHighLevel sync
  writes them; on this line nothing did. So a client's own stage and the
  board's record of it drifted apart from the first move.
- **A client could not be added to a second pipeline.** The edit form offered
  one flat list of every stage with no pipeline named, so a stage in another
  pipeline looked like a stage in this one.

Native pipeline creation (`createPipeline`, drawn by `NativePipelineCreator`)
has existed since the line became closed, but it was shown only while a
deployment held no pipeline at all. It now sits in the toolbar for anyone who
may edit the tracker, and a new pipeline opens selected.

Five rules carry it.

- **The tracker's operations answer to the tracker's own permission.**
  `TRACKER_PERMISSION` maps the board's reads to view on `client_tracker` and
  every change to edit. The administrator role is still admitted, so nobody who
  reached the board before loses it. Every other operation on the function
  (the report automation settings) is still an administrator's. A move is
  refused for a client the person may not act for (`canAccessClient`), with the
  same not-found the client broker gives.
- **A stage is looked up, never described.** The request names a stage by id.
  Its pipeline and its name come from `ghl_pipeline_stages`, and both are
  written to the client (`clientPipelineUpdate.pure.ts`). An id the table does
  not hold is refused, and the request's own `pipeline_status` beside a stage
  is ignored, because it could store one stage under another's name.
- **Taking a client off a pipeline touches only that pipeline.** The board now
  names the pipeline a card was dragged out of. Where the client's own
  placement is in a different pipeline, their columns are left alone, status
  included. A clear that names no pipeline is the older call and empties
  `current_stage_id` and nothing else. A read that failed is refused (503)
  rather than taken as "placed nowhere", which would clear the wrong pipeline.
- **A placement is written, never deleted.** After the client's row is saved,
  `nativeOpportunityWriter.ts` moves every row the client already holds in that
  pipeline, whoever wrote it, or writes one keyed `native:<pipeline id>`. It
  upserts on the table's own unique key, so two quick moves write one row.
  Leaving a pipeline empties the row's stage and keeps the record. A failed
  read or write is a 503 that says the stage was saved and the board was not,
  never a quiet success.
- **What the board is sent is what the board shows.** `get-client-data` now
  scopes `ghl_client_opportunities` to the clients the person may see, like
  every other client table. Before this, the board was sent every client's
  pipeline history and simply drew fewer cards.

The form says what the server says. A stage is chosen from a list grouped by
pipeline, so a stage in another pipeline is plainly another pipeline, and only
a changed stage is sent. Somebody with view only sees the board, cannot drag,
and gets a disabled form that says why. An optimistic move patches only the
placement in the pipeline being viewed, never every one the client holds.

Two of these files are shared with the prime and one is not.
`clientPipelineUpdate.pure.ts`, its test and the scoping in `get-client-data`
are byte-identical on both lines. The same gate and stage lookup landed on the
prime in the same change, where the GoHighLevel sync still writes placements.
The opportunity writer (`_shared/crm/nativeOpportunity*.ts`) exists only here.
So **`manage-automation-settings` and `src/pages/ClientTracker.tsx` are head
variants**, and they must be recorded as `manual_reconcile` on this clone in
Mission Control, or the next cascade puts the prime's copy back and the board
stops recording moves without anything failing.

One read is still wider than the board's own: RLS on `ghl_client_opportunities`
lets any signed-in session select every row directly (`USING (true)`).
Narrowing that is a migration for the owner to approve, not part of this
change.

## The GoHighLevel leftovers, retired

Five surfaces outside the CRM pages still assumed a vendor. Each one either
did nothing here and said nothing, or said something false.

- **A lead magnet's lead reached no record.** `request-lead-magnet` captured
  the download, answered the visitor and pushed the lead to GoHighLevel. Here
  the push logged "GHL skipped", so no client, tag or pipeline placement was
  ever written, and the captures dialog read "Pending" beside every lead. It
  now files the lead natively (`_shared/crm/fileNativeLead.ts`, rules in
  `nativeLeadCapture.pure.ts`), before the vendor branch and only where the
  deployment is `native`. Four rules:
  - **A client is matched only where exactly one holds the address.** Several
    is left unfiled, with the reason written to the download row.
  - **The address matched is the one the visitor typed.** The capture's
    normalised key drops Gmail dots and `+tags`. That is right for counting
    downloads and wrong for a client's email.
  - **A client already in that pipeline keeps their stage.**
  - **An existing client's own record is not rewritten.** Only a client with
    no placement at all takes the magnet's stage as their own.

  The captures dialog says "Added to CRM", "Not added" (with the reason on
  hover) or "Pending".
- **A finance partner's text or email to a client failed in vendor words.**
  `finance-portal-client-comms` sent everything but the portal message through
  GoHighLevel, so here it answered `no_ghl_conversation`. On `native` it now
  plans first (`financePortalNativeSend.pure.ts`) and refuses before it writes:
  - **A text** goes through `_shared/crm/twilioSms.ts`, the same module
    `crm-send-message` now uses, so the two cannot address Twilio differently.
  - **An email** goes through the white-labelled portal email. It carries the
    same open-tracking pixel the vendor path embeds, so "opened" means the
    same thing on both lines.
  - **WhatsApp** is refused, and the composer does not offer it here.
- **Marketing report distribution** read a stage by its vendor key, which no
  native stage has. It accepts either key now, and it never widens a stage
  target it cannot resolve into "everyone" (shared with the prime).
- **Lead attribution enrichment** failed every scheduled run on a deployment
  with no Meta token. A scheduled run now answers 200 and says it skipped. A
  person who asks is told what is missing (shared with the prime).
- **Call Logs offered "Clean up contact names"**, which writes to GoHighLevel.
  It is not drawn here.

The visible vendor wording on shared screens (calendar, lead magnets, lead
quality, add client, notes, portal configuration, the user guide) was
rewritten so it is true on both lines, identically in both repositories. Two
shared components gained a prop that defaults to showing, and only this
line's Client Management page turns it off:
`ClientAnalyticsDashboard`'s `showCrmSyncStatus` and `ClientFilters`'
`showSyncStatus`. A sync-status card here read "Sync in progress" for ever,
because every client is "pending" a push that has nowhere to go.

**The head variants on this line, all to be recorded as `manual_reconcile`
on this clone in Mission Control**, or the next cascade restores the prime's
copy without anything failing:

| File | Why it differs from the prime |
|---|---|
| `supabase/functions/manage-automation-settings/index.ts` | native pipeline writes |
| `src/pages/ClientTracker.tsx` | native board, no vendor sync |
| `src/pages/ClientManagement.tsx` | vendor sync, import and status hidden |
| `src/pages/CallLogs.tsx` | contact-name clean-up hidden |
| `supabase/functions/request-lead-magnet/index.ts` | native filing branch |
| `supabase/functions/finance-portal-client-comms/index.ts` | native send branch |
| `src/components/finance-portal/ClientCommsInboxTab.tsx` | WhatsApp not offered |
| `scripts/security/check-ghl-message-authz.mjs` | holds `crm-send-message` to the rule |

Every file gated on `ghlAffordancesAvailable()` is a head variant for the same
reason; the table lists the ones this work made or changed.

## Setting a deployment to native

Two variables, and **both** must be set to the same word, because the bundle
and the edge functions deploy separately:

| Where | Name | Value |
|---|---|---|
| Supabase project secrets | `CRM_PROVIDER` | `native` |
| Supabase project secrets | `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` | to send |
| Supabase project secrets | `TWILIO_AUTH_TOKEN` | to *receive* — it is the signature key |
| Build environment (Vercel) | `VITE_CRM_PROVIDER` | `native` |

Only `VITE_`-prefixed names are inlined by Vite, which is why there are two
rather than one. Setting one and not the other is not silent: every native
function stamps `x-crm-provider` on its response and `crmProviderMismatch`
renders a sentence naming both sides and the remedy.

On THIS clone neither is strictly required today — no `GOHIGHLEVEL_*` secret
reaches a clone, so `resolveCrmProviderFromEnv` derives `native` from their
absence and the browser falls to `DEFAULT_CRM_PROVIDER`, which is also
`native`. Set them anyway: a derived answer is one that changes if the
environment changes, and an explicit one is a decision somebody made.

On the **prime**, setting `CRM_PROVIDER=native` would point four live surfaces
at empty tables. Do not.

## The secret policy, measured

Of the 58 secrets the parity report calls missing on this clone:

- **3 are `withheld` and correct** — `AIRTABLE_TOKEN`, `AIRTABLE_BASE_ID`,
  `DIDIT_API_KEY`. Brokered by Mission Control by design; their absence is the
  decision, not a gap.
- **17 are `authorised_no_value`** — policy says forward, Mission Control holds
  no value.
- **38 have no policy row** and were never intended to travel.

`GOHIGHLEVEL_API_KEY`, `GOHIGHLEVEL_LOCATION_ID` and their `_NEW` siblings are
in that last group. **No clone has ever been given them and none ever will
be** — which is why `resolveCrmProvider` derives `native` here rather than
needing to be told.

# The CRM this deployment actually is

This deployment is a clone of the NPC property dashboard whose CRM is **its own
database**, not GoHighLevel. This document records what that turned out to
mean, what is built, and — at least as importantly — what is not.

Read it before touching `_shared/crm/*`, the outbound path in
`send-ghl-message`, or anything that decides where a contact, conversation,
appointment or opportunity lives.

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
- `20261205000000_native_crm_tables.sql` — nine `crm_*` tables, RLS on all of
  them, executed against a real PostgreSQL 16: 9 tables, 36 policies, 0
  unindexed foreign keys, 8 bad-row cases refused, idempotent on re-run.
- 158 tests across six files, several of them source contracts — the
  guarantees here are ORDERINGS and ABSENCES, which no unit test sees.

## What is NOT built, stated plainly

| Gap | Consequence today |
|---|---|
| **No SMS credentials anywhere** | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` are set on no deployment and carry **no fleet forward policy row**. Native SMS refuses every send with `not_configured` — correctly and legibly, but it refuses. |
| **No WhatsApp sender** | Refused as `not_implemented`, on a ground no credential changes. |
| **Inbound is built but unexercised** | `crm-inbound-message` receives a Twilio SMS and writes the thread. With no `TWILIO_AUTH_TOKEN` on any deployment it refuses every request — correctly, since the token IS the signature key — so the path has never run against a real delivery. |
| **No native pipeline or conversation *reconciliation*** | By design, not by omission — see the routing table above. What a native deployment does NOT yet have is an inbound path to fill the threads in the first place (the row above). |
| **The `ghl-migrate-*` / `sync-ghl-*` workers** | Still assume a vendor. They should stand down cleanly under `native` rather than erroring. |

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

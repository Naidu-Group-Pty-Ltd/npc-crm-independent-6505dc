# Make.com blueprints — NPC Services

A point-in-time export of every NPC scenario in the Make organisation
(`eu2.make.com`, org `1620547`, team `528268`), taken **2026-08-18**.

36 scenarios, 26 of them live in Make at the time of export.
`manifest.json` is the machine-readable index — scenario id, module count, apps
used, scheduling, webhook id and last-edit date for each.

This is a **backup and a reading copy**. Make remains the system of record:
editing a file here changes nothing until somebody imports it, and an import
creates a new scenario rather than updating the original.

## What a file here is

Each `.json` is a Make **blueprint object** — `flow`, `metadata`, `name`,
`scheduling`, `interface` — which is exactly what Make's own *Export Blueprint*
button produces and exactly what Make's *Import Blueprint* accepts. It is not
the API's scenario envelope: the surrounding metadata (active state, hook id,
folder, timestamps) lives in `manifest.json` instead, so a blueprint file can be
re-imported without being edited first.

Filenames are `<slug>.<scenarioId>.json`. The numeric id is the Make scenario id
and is the stable identifier — names get renamed, ids do not.

## Credentials are placeholders, not values

Several scenarios hard-code an API key into an HTTP module's `Authorization`
header rather than using a Make connection. Those literals have been replaced
with named placeholders of the form `{{SECRET:NAME}}`.

They are **replaced, never deleted**. A deleted key produces a blueprint that
imports cleanly and then fails at runtime with nothing to point at; a named one
fails loudly and says which key is missing. Re-importing is a find-and-replace
of each placeholder with the live value before you paste the blueprint in.

Scenarios that use a Make *connection* (Airtable, Microsoft 365, OpenAI, Twilio,
Google) are unaffected — those carry only a numeric connection id, never a
secret, and the id is meaningless outside this Make account.

See [`SECRETS.md`](./SECRETS.md) for what each placeholder is and why the
underlying keys should be rotated.

## Scenarios

### `intake/`

Listing intake — the mailbox-to-Airtable pipeline behind the Listings page. `NPC Email 1 New` (9618493) is the scenario that actually ran; `NPC Email 1` (6720116) is the audited predecessor. See [`../../NPC_EMAIL_1_AUDIT.md`](../../NPC_EMAIL_1_AUDIT.md) and [`../../FORWARDED_SENDER.md`](../../FORWARDED_SENDER.md).

| Blueprint | Scenario id | In Make | Modules |
| --- | --- | --- | --- |
| [`intake/npc-email-1.6720116.json`](intake/npc-email-1.6720116.json) | `6720116` | off | 6 |
| [`intake/npc-email-1-new.9618493.json`](intake/npc-email-1-new.9618493.json) | `9618493` | off | 6 |
| [`intake/npc-email-2.9624368.json`](intake/npc-email-2.9624368.json) | `9624368` | live | 7 |
### `voice-agent/`

The Vapi / GoHighLevel / Twilio voice stack — inbound call context, contact resolution, availability and booking intent routers, and the Twilio↔Vapi SIP bridge.

| Blueprint | Scenario id | In Make | Modules |
| --- | --- | --- | --- |
| [`voice-agent/discovery-call-handoff.8306842.json`](voice-agent/discovery-call-handoff.8306842.json) | `8306842` | live | 6 |
| [`voice-agent/ghl-mcp-get-contact-by-phone-via-http.9232675.json`](voice-agent/ghl-mcp-get-contact-by-phone-via-http.9232675.json) | `9232675` | off | 6 |
| [`voice-agent/npc-twilio-store-active-call-context.9263976.json`](voice-agent/npc-twilio-store-active-call-context.9263976.json) | `9263976` | live | 3 |
| [`voice-agent/npc-vapi-get-call-context-v1.9232935.json`](voice-agent/npc-vapi-get-call-context-v1.9232935.json) | `9232935` | live | 3 |
| [`voice-agent/npc-vapi-transfer-caller-to-human-via-twilio-redirect.9264620.json`](voice-agent/npc-vapi-transfer-caller-to-human-via-twilio-redirect.9264620.json) | `9264620` | live | 3 |
| [`voice-agent/npc-vapi-outbound-sandbox.8041133.json`](voice-agent/npc-vapi-outbound-sandbox.8041133.json) | `8041133` | off | 4 |
| [`voice-agent/vapi-ghl-availability-intent-router-native-highlevel-universal-api-cascaded-fina.9216756.json`](voice-agent/vapi-ghl-availability-intent-router-native-highlevel-universal-api-cascaded-fina.9216756.json) | `9216756` | live | 3 |
| [`voice-agent/vapi-ghl-booking-appointment-intent-router-generic-http-pit-import-safe.9219325.json`](voice-agent/vapi-ghl-booking-appointment-intent-router-generic-http-pit-import-safe.9219325.json) | `9219325` | live | 3 |
| [`voice-agent/vapi-ghl-booking-appointment-intent-router-native-highlevel-universal-api-cascad.9218037.json`](voice-agent/vapi-ghl-booking-appointment-intent-router-native-highlevel-universal-api-cascad.9218037.json) | `9218037` | off | 3 |
| [`voice-agent/vapi-ghl-contact-resolver-v3-production-search-first-create-only-if-needed.9216526.json`](voice-agent/vapi-ghl-contact-resolver-v3-production-search-first-create-only-if-needed.9216526.json) | `9216526` | live | 3 |
| [`voice-agent/vapi-ghl-contact-resolver-v4-canonical-variables-search-first-create-only-if-nee.9231443.json`](voice-agent/vapi-ghl-contact-resolver-v4-canonical-variables-search-first-create-only-if-nee.9231443.json) | `9231443` | live | 3 |
| [`voice-agent/vapi-phonenumber-inject-v2-canonical-context-bridge.9231549.json`](voice-agent/vapi-phonenumber-inject-v2-canonical-context-bridge.9231549.json) | `9231549` | live | 2 |
### `call-booking/`

Booking teardown — the webhooks a voice agent calls to cancel or reschedule an existing GHL appointment.

| Blueprint | Scenario id | In Make | Modules |
| --- | --- | --- | --- |
| [`call-booking/npc-delete-booking-test.8167556.json`](call-booking/npc-delete-booking-test.8167556.json) | `8167556` | live | 3 |
| [`call-booking/npc-delete-ifc-session.8253996.json`](call-booking/npc-delete-ifc-session.8253996.json) | `8253996` | live | 3 |
| [`call-booking/npc-delete-ifc-session-zoom.8253983.json`](call-booking/npc-delete-ifc-session-zoom.8253983.json) | `8253983` | live | 3 |
| [`call-booking/npc-delete-opt-in-call.8431843.json`](call-booking/npc-delete-opt-in-call.8431843.json) | `8431843` | live | 4 |
| [`call-booking/npc-delete-quiz-sub-call.8431904.json`](call-booking/npc-delete-quiz-sub-call.8431904.json) | `8431904` | live | 4 |
| [`call-booking/npc-delete-strategy-session.8190549.json`](call-booking/npc-delete-strategy-session.8190549.json) | `8190549` | live | 3 |
| [`call-booking/npc-delete-strategy-session-zoom.8204241.json`](call-booking/npc-delete-strategy-session-zoom.8204241.json) | `8204241` | live | 3 |
### `outreach/`

Outbound and follow-up call campaigns — the scenarios that place scheduled Vapi calls after a form, quiz, opt-in or no-show.

| Blueprint | Scenario id | In Make | Modules |
| --- | --- | --- | --- |
| [`outreach/npc-active-nurturing.8269892.json`](outreach/npc-active-nurturing.8269892.json) | `8269892` | off | 4 |
| [`outreach/npc-active-nurturing-call-report.8268220.json`](outreach/npc-active-nurturing-call-report.8268220.json) | `8268220` | off | 4 |
| [`outreach/npc-discovery-call-live.6226586.json`](outreach/npc-discovery-call-live.6226586.json) | `6226586` | live | 5 |
| [`outreach/npc-discovery-call-no-show-live.8168400.json`](outreach/npc-discovery-call-no-show-live.8168400.json) | `8168400` | live | 7 |
| [`outreach/npc-discovery-call-summary.7893240.json`](outreach/npc-discovery-call-summary.7893240.json) | `7893240` | off | 2 |
| [`outreach/npc-discovery-call-test.8147807.json`](outreach/npc-discovery-call-test.8147807.json) | `8147807` | off | 7 |
| [`outreach/npc-ifc-follow-up-test.8253885.json`](outreach/npc-ifc-follow-up-test.8253885.json) | `8253885` | live | 5 |
| [`outreach/npc-ifc-no-show.8257213.json`](outreach/npc-ifc-no-show.8257213.json) | `8257213` | live | 5 |
| [`outreach/npc-opt-in-follow-up-test.8088302.json`](outreach/npc-opt-in-follow-up-test.8088302.json) | `8088302` | live | 7 |
| [`outreach/npc-quiz-submission-follow-up-test.8097639.json`](outreach/npc-quiz-submission-follow-up-test.8097639.json) | `8097639` | live | 7 |
| [`outreach/npc-strategy-session-follow-up-test.8190416.json`](outreach/npc-strategy-session-follow-up-test.8190416.json) | `8190416` | live | 5 |
| [`outreach/npc-strategy-session-follow-up-zoom.8204271.json`](outreach/npc-strategy-session-follow-up-zoom.8204271.json) | `8204271` | live | 7 |
| [`outreach/npc-strategy-session-no-show.8190705.json`](outreach/npc-strategy-session-no-show.8190705.json) | `8190705` | live | 5 |
### `reports/`

Report generation via PDFMonkey (the `NPC Property Reports` webhook).

| Blueprint | Scenario id | In Make | Modules |
| --- | --- | --- | --- |
| [`reports/integration-webhooks-pdfmonkey.6965830.json`](reports/integration-webhooks-pdfmonkey.6965830.json) | `6965830` | off | 2 |

## One deliberate divergence from live Make

Every file here is a verbatim export **except** the contact-resolution key, which
is corrected in two of them:

| File | Module | Was | Now |
| --- | --- | --- | --- |
| `voice-agent/vapi-ghl-contact-resolver-v4-…9231443.json` | 11, 12 | `…arguments.vapi_call_id` | `{{1.message.customer.number}}` |
| `voice-agent/npc-vapi-get-call-context-v1.9232935.json` | 2 | `…arguments.vapiCallId` | `{{1.message.customer.number}}` |

The `GHL Contact IDs` store had two readers keyed differently — `Discovery Call
Handoff` looked up by `message.customer.number`, `get_call_context v1` by
`vapiCallId` — and a writer can only have one key. The resolver keyed on the
Vapi call id, which is unique per call, so its upsert could never match an
existing row: three contacts had become 74 rows and the phone lookup found
almost nothing. The evidence is in
[`../../datastores/`](../../datastores/README.md).

All three scenarios now key on the same expression. `message.customer.number` is
chosen over the tool arguments deliberately — Vapi fills tool arguments from its
own templating and it demonstrably fails, reaching the store as the literal
`{{ customer.number }}` on 9 rows, with `called_number` still arriving as
`{{ phoneNumber.number }}` today. The envelope value is set by Vapi itself on
every request and cannot arrive uninterpolated. The two phone fields in each
`data` object were pointed at the same expression so a row's key and its stored
phone can never disagree.

Until the same edit is made in Make, these two files describe intended rather
than deployed behaviour. Nothing else in this directory diverges.

## Cached execution samples contain live client data

30 of these blueprints carry `metadata.designer.samples` — the sample bundles
Make caches from real runs so the editor can show field values. They contain
genuine lead names, email addresses, phone numbers, home addresses and call
transcripts, because that is what ran through the scenario.

They are kept because they are part of the blueprint Make exports and because
they are the only record of the shape a webhook actually delivers, which is what
the mapping expressions were written against. If this repository's audience ever
widens, that is the thing to strip — it is confined to
`metadata.designer.samples` and removing it does not affect an import.

## Re-importing a blueprint

1. Substitute any `{{SECRET:*}}` placeholder with the live credential.
2. Make → Scenarios → **Create a new scenario** → ⋯ → **Import Blueprint**.
3. Re-map every connection and webhook. Connection ids and `hook` ids in these
   files refer to objects in the original account; an import into any other
   account (or a re-import after a webhook is deleted) must re-point them.

An import creates a *new* scenario. It does not update the scenario the
blueprint came from, and the new one starts inactive.

## Scope of this export

Every NPC-owned scenario in the account is here, live or not. The account also
holds 23 unrelated legacy scenarios from other engagements (Bartini, Xenochrome,
Mercer Fast Food, a dental clinic, Ehsan Jaya, and a set of generic
`Integration *` experiments). Those were deliberately left out — they are not
NPC work and do not belong in this repository. They remain in Make.

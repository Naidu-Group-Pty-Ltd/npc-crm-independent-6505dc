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

## The one thing that had to change first

Outbound messaging has a narrow waist: **one function, two callers.**

- `supabase/functions/send-ghl-message/index.ts`
- called from `src/pages/Conversations.tsx` and
  `src/components/clients/ClientConversationsTab.tsx`

Before this change, on this clone, every send reached the credential check and
answered `500 { error: "GHL API key not configured" }`, **writing no row at
all**. Three things wrong with that here:

1. A `500` reports a server fault for a settled configuration.
2. The operator got no record they ever tried — a conversation that shows
   nothing is one somebody re-sends by hand.
3. The sentence names a vendor this product is not using.

And the sentences the vendor path *can* produce are all about the contact —
*"This contact does not have a valid mobile number."*, *"This contact has
opted out of SMS communications."* On a deployment with no sender those are
libel about somebody's customer: the number is fine, and the reason nothing
was delivered is that there is nothing here to send with. The location
service already paid for this rule — `geocoder_unavailable` and
`geocoder_not_attempted` exist so a missing provider is never reported as a
bad address.

## Three rules that carry it

**An explicit setting is never overruled by a credential's absence.** A
deployment set to `gohighlevel` with no key stays GoHighLevel and reports the
absence separately. A CRM must not change identity because a secret expired —
the tenant's messages would silently start going to a different system of
record. `credentialled` is a separate field for exactly that reason, and it is
never a veto.

**A word this build has never heard of is not a provider.** `CRM_PROVIDER` is
an allow-list (`gohighlevel` / `ghl` / `native`); anything else is reported as
`unrecognised`, named back to the operator, and falls through to what the
credentials say. This is the activation gate's lesson: `reason !==
"operator_locked"` answered yes to every unrecognised word, `unknown`
included.

**A refusal is recorded, and never as a delivery.** `planMayRecordDelivery` is
one exported expression, asked rather than trusted, so the refuse and send
paths cannot drift into disagreeing about which writes a `sent` row. A row
claiming delivery when nothing left the building is undiscoverable from the
operator's side and leaves a client waiting for a reply nobody sent.

## What is built

- `_shared/crm/crmProvider.pure.ts` — resolves the provider, with the source
  of the answer (`configured` / `derived` / `unrecognised`) and whether the
  resolved provider's credentials are present.
- `_shared/crm/nativeOutbound.pure.ts` — decides what a native deployment does
  with one outbound message, **before** anything is sent or written.
- The native branch in `send-ghl-message`, self-contained and sitting in front
  of the vendor path. Everything below it is byte-identical, because the prime
  runs this same file against a live GoHighLevel account.
- 32 tests over both pure modules.

## What is NOT built, stated plainly

This is a spine and one path, not a finished CRM. Nothing below is started:

| Gap | Consequence today |
|---|---|
| **No SMS credentials anywhere** | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` are set on no deployment and carry **no fleet forward policy row**. Native SMS therefore refuses every send with `not_configured` — correctly and legibly, but it refuses. |
| **No WhatsApp sender** | Refused as `not_implemented`, on a ground no credential changes. |
| **No native inbound** | Nothing fills `ghl_conversations` / `ghl_conversation_messages`. A reply from a client arrives nowhere. Twilio's inbound webhook is unwritten. |
| **Calendar** | `ghl-calendar*` functions still target the vendor. The agreed design (native tables + Outlook sync) is unstarted. `MICROSOFT_*` are absent here too. |
| **Contacts / opportunities / pipelines** | The `ghl-migrate-*` and `sync-ghl-*` workers still assume a vendor. They should stand down cleanly under `native` rather than erroring; today they simply fail. |
| **The four surfaces** | Unchanged. They read local tables, so they render — but nothing tells an operator the CRM is native, and the send button offers WhatsApp this deployment cannot carry. |

`RESEND_API_KEY` is `authorised_no_value` on this clone — the fleet policy says
forward it and Mission Control holds no value — so email is in the same
position as SMS.

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

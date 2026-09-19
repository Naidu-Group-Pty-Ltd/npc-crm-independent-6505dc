# Re-pointing Vapi at the new Make account

Companion to [`webhook-repoint.json`](./webhook-repoint.json), which was created
with **every `newUrl` blank** and is now filled in. This is what the map means and
the order it has to be applied in.

## Verified live on 2026-09-15, not read off the snapshot

`GET /tool` was executed against the live org and all 20 tools read back. **Every
`oldUrl` in the map still matches the live record**, so nothing has drifted since
the 2026-08-18 capture. `NPC Discovery Call Follow Up` also still reports
`updatedAt: 2025-11-26T06:56:48.029Z` — untouched.

There is no Vapi MCP connector on this account. The read went through **Make's own
Vapi app** — a throwaway on-demand scenario running `vapi:makeApiCall` against
connection `10496920`, which carries the credential so the raw key is never
handled. The scenario, its data store and its data structure were deleted
afterwards and the team is back to its three permanent stores. The same module
takes `PATCH`, so it is also how the writes below can be made without a key.

**Connection `10496920` is the NPC org.** `10508414` ("Aurixa Systems") is a
*different* Vapi account: its two bound assistants (`66d3e994…`, `b834610e…`)
appear nowhere in the 28-assistant snapshot. Do not read or write the NPC org
through it. This is the same shape as the two `NPC Emails` Airtable bases.

## Nothing here has been applied, and that is deliberate

**All twelve target scenarios in the new Make account are INACTIVE.** They are
structurally valid (`isinvalid: false` on every one) but not one is switched on.

Re-pointing a tool moves it from a working eu2 hook to a hook that answers
nothing. `ghl_resolve_contact` alone is used by **13 assistants**, and
`NPC Inbound Agent` has taken 37 real calls. Applying the map first would break
contact resolution, availability, booking and cancellation on every live call.

So the order is not interchangeable:

1. **Activate** the twelve target scenarios and test each one against a real
   payload. Activating is safe on its own — a webhook scenario is inert until
   something calls it.
2. **Then** apply the map, tool by tool, checking each on a live call before the
   next.

A tool re-pointed ahead of its scenario is the whole risk in this change.

## The assistant `server.url` is a separate question, and the answer looks decided

Thirteen of the fifteen NPC assistants point their `server.url` at the Supabase
edge function `vapi-call-webhook`, not at Make. One (`NPC Discovery Call Follow
Up Test 2`) has none. **One is still on eu2**:

| Assistant | Current | Suggested |
| --- | --- | --- |
| `NPC Discovery Call Follow Up` | `https://hook.eu2.make.com/xoktvkk0wxyj8weopjeiqrqd914ad1jg` | the Supabase `vapi-call-webhook`, matching its thirteen siblings |

That suggestion is not a migration step — it is the odd one out being brought
into line. The evidence it is right: on **2026-08-18 at 17:28 and 17:29 the
account owner moved `NPC Active Nurturing` and `NPC Inbound Agent` off the new
Make account and back to Supabase**, deliberately, hours after this migration's
own work had re-pointed them there as a side effect of creating Vapi app hooks.
Read with the other thirteen, the owner's pattern is that the **assistant**
webhook belongs to Supabase and only **tool** webhooks belong to Make. Confirm
before applying.

## The map

Ten of thirteen resolve. `confidence` and `basis` are carried per entry in the
JSON; the short version:

| Tool | → new scenario | How it was settled |
| --- | --- | --- |
| `ghl_resolve_contact` | Contact Resolver v4 | name is one-to-one |
| `get_call_context` | get_call_context v1 | name is one-to-one |
| `transfer_to_human` | Transfer Caller to Human | hook minted with the scenario 2026-09-15 |
| `ghl_check_availability` | Availability Router (Native) | only one availability router exists |
| `ghl_delete_event_npc` | Delete Booking Test | used only by the Discovery assistants |
| `ghl_delete_event_npc_2` | Delete Strategy Session | prompt: "delete **phone** session" |
| `ghl_delete_event_npc_2_1` | Delete Strategy Session (Zoom) | prompt: "delete **Zoom** session" |
| `ghl_delete_event_npc_3` | Delete IFC Session | prompt: `original_mode = "phone"` → `_3` |
| `ghl_delete_event_npc_3_1` | Delete IFC Session (Zoom) | prompt: "delete **Zoom** Initial Finance Consult" |
| `phoneNumber_inject` `9789b720` | phoneNumber_inject v2 | the only such scenario; the referenced tool of the two |

**`ghl_create_booking` is the one that does not resolve.** Two booking routers
exist in the target account — `(Native)` and `(Generic HTTP PIT)` — and the eu2
tool carries one URL. Settle it by opening the legacy account and reading which
scenario owns hook `eop70ky2635nobauh7lyof13sctvl0ga`; guessing picks between a
working booking path and a dead one.

Two are not re-pointed at all. `phoneNumber_inject` `c40722f1` is referenced by
**no assistant** (confirmed live) — delete it or leave it dead, but do not give
it a live hook. `checkAvailability` `326c7c81` belongs to `Xenochrome Assistant`,
outside the NPC set.

## A blueprint hit is not evidence of ownership

Worth recording because it produced a wrong row in
[`../../make/MAKE_CUTOVER.md`](../../make/MAKE_CUTOVER.md), now corrected.

Searching the exported blueprints for an eu2 udid finds it — but **every single
occurrence, across every blueprint, sits inside `metadata.designer.samples`**, and
zero sit in live configuration. Samples are cached Vapi test payloads, so a
sample in scenario A routinely carries scenario B's URL. `9inh27jw…`
(`ghl_delete_event_npc`) appears in the samples of **five** different delete
scenarios, which one tool plainly cannot own.

That is how `2ubukyatwc0ig8zinphjjc4dciwhigqg` came to be recorded as
`Discovery Call Handoff`'s old URL. The live API says it is
`phoneNumber_inject`'s (`9789b720`), and six other files in this repository
already agreed. The eu2 hook→scenario binding is readable only from the legacy
Make account, whose token is zone-bound; it cannot be recovered from the exports.

## Before any of this

[`../SECURITY-INCIDENT.md`](../SECURITY-INCIDENT.md) — the Vapi webhook secret and
two `serverUrlSecret` values are in five pushed commits and need rotating. The
clone kit's runbook already puts rotation first, and re-pointing is the moment
the URLs change anyway, so the two belong in the same sitting.

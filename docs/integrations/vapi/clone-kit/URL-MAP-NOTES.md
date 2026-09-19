# url-map.json — how each entry was decided, and the two that need a human

`push.py` refuses a map with any blank value, so every entry below is filled.
Nine are unambiguous. Two carry a caveat, and JSON cannot hold a comment, so
they are recorded here instead.

Every `newUrl` is a hook in Make team **2731020 / us2**, verified against
`hooks_list` for that team on 2026-09-15.

| eu2 hook | Tool | us2 scenario | State |
| --- | --- | --- | --- |
| `2ubukyatwc0i…` | `phoneNumber_inject` | 5978051 phoneNumber_inject v2 bridge | active |
| `3xslmou0jpbw…` | `ghl_check_availability` | 5978159 Availability Router (Native) | active |
| `9inh27jwcxod…` | `ghl_delete_event_npc` | 5977767 NPC Delete Booking Test | **INACTIVE** |
| `db3ws2lmqi4q…` | `ghl_resolve_contact` | 5978434 Contact Resolver v4 | active |
| `eop70ky2635n…` | `ghl_create_booking` | 5978179 Booking Router (Generic HTTP PIT) | **inferred** |
| `jb85m14jchgk…` | `transfer_to_human` | 6279259 Transfer via Twilio Redirect | active |
| `ks0eu13idcgw…` | `ghl_delete_event_npc_3` | 5977925 NPC Delete IFC Session | active |
| `o51u3jb5g1nn…` | `get_call_context` | 5978425 get_call_context v1 | active |
| `u60ggcqrdo9t…` | `ghl_delete_event_npc_3_1` | 5977928 NPC Delete IFC Session (Zoom) | active |
| `ujov89m0me5k…` | `ghl_delete_event_npc_2` | 5977929 NPC Delete Strategy Session | active |
| `w5e69pe59ahu…` | `ghl_delete_event_npc_2_1` | 5977931 NPC Delete Strategy Session (Zoom) | active |

## The two caveats

**`ghl_create_booking` is inferred, not read.** The legacy eu2 account is
deprecated and unreadable, so the eu2 hook cannot be opened to see which
scenario it was. Two active booking routers exist in us2 — 5978137 *(Native
HighLevel, Cascaded FINAL)* and 5978179 *(Generic HTTP PIT, IMPORT SAFE)* — and
the eu2 tool carries one URL. The value here is 5978179 because **the target
Vapi org has already made that choice**: its existing `ghl_create_booking` tool
(`7d6b6d41`) points at `017xspgxrpxqh93feqi7bms3pmxmv19e`. That is the best
available evidence, but it is evidence of somebody's earlier decision rather
than a reading of the original, so it is worth one minute of confirmation.

Getting it wrong does not fail on the first call. It fails on the first real
**booking**, and the caller is told they are booked.

**`ghl_delete_event_npc` points at an inactive scenario.** 5977767 (*NPC Delete
Booking Test*) is switched off, so a tool call would reach a dead hook. Two
things soften it: the live inbound squad's ten tools do not include this one,
and it is reached only from `NPC Discovery Call Follow Up`. Either activate
5977767 before the push or accept that this one tool is inert until it is.

## What is no longer here

`xoktvkk0wxyj8weopjeiqrqd914ad1jg` was a twelfth entry and is gone. It was never
a tool — it was `NPC Discovery Call Follow Up`'s own assistant-level
`server.url`, still pointing at eu2, and the only NPC assistant carrying no
secret header at all, so the product's webhook would have refused it forever as
`secret_not_presented`. It is now repointed at the Supabase `vapi-call-webhook`
with a header, declared in `build_payloads.py`'s `REPAIRS` table rather than by
editing the snapshot.

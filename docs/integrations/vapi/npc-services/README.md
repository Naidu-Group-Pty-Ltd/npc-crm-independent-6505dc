# NPC Services — Vapi snapshot

The state of the NPC voice agents in Vapi org `c9015cd5-3701-4ac5-aa9c-be6cdcaaecdd`,
taken **2026-08-18**, shaped so the set can be rebuilt in a new Vapi account.

**15 assistants · 15 tools (12 managed + 3 inline) · 1 squad · 1 workflow · 4 phone numbers · 2 knowledge files.**

> **The webhook re-point map is filled in now.**
> [`webhook-repoint.json`](./webhook-repoint.json) shipped with every `newUrl`
> blank; ten of its thirteen entries resolve, and
> [`VAPI_REPOINT.md`](./VAPI_REPOINT.md) carries the basis for each, the one that
> does not resolve, and the ordering constraint — **every target scenario in the
> new Make account is inactive, so nothing may be re-pointed until they are
> switched on and tested.** Verified against the live Vapi API on 2026-09-15:
> nothing has drifted since this capture.

## Read this before trusting the scope

**Vapi's API has no folder concept.** `/folder`, `/folders`, `/workspace`, `/workspaces`,
`/project` and `/projects` all return 404, and no assistant carries a folder field — so
"the NPC Services folder" cannot be *read*, only inferred. The org holds **28** assistants
and this snapshot covers **15** of them.

The 15 were selected on three independent signals that all agree:

| Signal | What it gives |
| --- | --- |
| Squad membership | `NPC Sales Force` holds 4 inbound assistants |
| Phone-number names | 4 numbers named `NPC Services` / `Naidu Property Consulting Services` |
| Name prefix | 15 assistants begin `NPC ` |

The other 13 are listed by name in [`manifest.json`](./manifest.json) and are **not**
captured here — they are other businesses (Sham Dental, Bartini Bartenders, JG Facilities
Management, Ramitta Barber, Kamileon Cube, Xenochrome, and a set of first-name agents in two
unnamed squads). Their prompts are their own and do not belong in this repo. If any of them
*is* in the NPC folder, say so and it can be added — the raw export is already taken.

## What is here

| Path | What it is |
| --- | --- |
| `manifest.json` | Counts, scope evidence, excluded assistants, dangling refs, file hashes |
| `assistants/` | 15 assistants, full configuration |
| `tools/` | The 12 managed tools those assistants reference by id |
| `tools-audit.json` | **Every tool the clone needs**, including 3 that are not standalone records |
| `assistant-server-urls.json` | Each assistant's own webhook, and whether it still points at the old account |
| `tools-unreferenced/` | 7 tools in the org that **no** assistant calls — see below |
| `squads/`, `workflows/`, `phone-numbers/` | The rest of the closure |
| `files/` | The 2 knowledge-base documents, downloaded byte-exact, plus Vapi's parsed text |
| `clone-plan.json` | The replay order, and what cannot be carried across |
| `webhook-repoint.json` | Every Vapi tool that calls the old Make account |

Each collection was checked against an individual `GET` before use: the list payload is
byte-identical to the single-resource payload, so nothing is truncated.

## Not every tool is a tool record

Twelve tools are managed objects referenced by `model.toolIds`. **Three more are defined
inline** and would be missed by anything that only reads `/tool` — they are captured inside
their parent payloads, and `tools-audit.json` is the complete list.

| Inline tool | Lives in | Why it matters |
| --- | --- | --- |
| `handoff_to_assistant` | squad → `members[0].assistantOverrides['tools:append']` | The routing brain of the inbound squad. Its **three destination `assistantId`s must be remapped** on clone, or the handoff points at the old org and fails silently. |
| `transferCall` | workflow → `nodes[22]` | `destinations` is an **empty array** — the node cannot transfer to anything. |
| `endCall` | workflow → `nodes[23]` | Says *"Thank you for calling **Wellness Partners**"* — a leftover from the template this workflow was built from. |

The audit was done two ways, because the first was not enough. Matching every UUID in every
string against the `/tool` list proves no *managed* tool hides on an unexpected path. But the
handoff tool sits under the key `tools:append` — a colon in the key name, which a plain
`tools` check skips. The second pass walks every object under any key containing "tool",
and that is what found it.

## Assistants have their own webhooks, separate from their tools

Fourteen of the fifteen set an assistant-level `server.url`, and they are not all in the same
place:

| Where it points | Count | Action |
| --- | ---: | --- |
| Supabase `vapi-call-webhook` | 13 | none — that project is not moving |
| **Old Make account (`eu2`)** | 1 | **re-point** — `NPC Discovery Call Follow Up` |
| No server URL set | 1 | — `NPC Discovery Call Follow Up Test 2` |

**Corrected 2026-08-18.** This table previously read 11 / 2 / 1 and said `NPC Active
Nurturing` and `NPC Inbound Agent` were already on `us2`. They were, for about five hours.
Creating a Vapi *app* hook in Make writes its URL into the bound assistant, so the Make work
repointed those two at 12:44 as a side effect rather than deliberately — and at **17:28 and
17:29 the same day they were pointed back at the Supabase edge function**, not by this
migration. Net effect: no NPC assistant currently targets the new Make account. The whole
sequence is in [`../snapshot/history-index.json`](../snapshot/history-index.json).

The mechanism still matters even though the change was undone: a `vapi2` hook created in
the wrong Make account silently repoints a live assistant.

## Three things this export found

**Thirteen of the fifteen assistants depend on a Make scenario that cannot migrate.**
`transfer_to_human` is wired into 13 of the 15, and it calls
`hook.eu2.make.com/jb85m14jchgktf09sfxt4jmf8yggaw32` — which belongs to
**`NPC Vapi - Transfer Caller to Human via Twilio Redirect`**, one of the two Make scenarios
blocked on the Free plan's data-store limit
([`../../make/MAKE_CUTOVER.md`](../../make/MAKE_CUTOVER.md)). That reframes the Make plan
decision: it is not a peripheral scenario, it is the human-escalation path for almost every
NPC voice agent.

**Three tool references are dangling.** `NPC Discovery Call Follow Up` and
`NPC Discovery Call Follow Up Test 2` both reference tools
`4d3ab4a4-…`, `4aa1a306-…` and `199be122-…`, and all three return **404** — they were
deleted from the org while the assistants kept pointing at them. Carried across as-is and
recorded in `manifest.json` rather than silently dropped; a clone should decide whether to
recreate them or clean the references.

**Live credentials sit in the org, and two are new.** Beyond the Twilio Account SIDs on the
phone numbers, the unreferenced tools carry an **Airtable personal access token**
(`ghl_mcp` → `get_contact_airtable_test`) and a **GoHighLevel PIT token** — neither of which
appears in the Make rotation list. Every credential in this snapshot is replaced with a
`{{REDACTED:…}}` placeholder; nothing here carries a live secret.

`get_contact_airtable_test` is also broken on its own terms: its `server.url` is
`https://airtable.com/apptyShYE0yzL4IGB/tblH9cW4EhVs6D5H1/Lead_Data_Test` — a browser URL for
the **old** Airtable base, not an API endpoint. It would never have worked.

## The webhook problem is the same one as Make's

**13 Vapi tools call `hook.eu2.make.com` — the old Make account.** Cloning the assistants
without re-pointing these produces a new account whose agents still drive the old one.
`webhook-repoint.json` lists each tool, its old URL, and which NPC assistants depend on it,
ordered by blast radius:

| Tool | NPC assistants depending on it |
| --- | ---: |
| `ghl_resolve_contact` | 13 |
| `transfer_to_human` | 13 |
| `ghl_check_availability` | 12 |
| `ghl_create_booking` | 11 |
| `ghl_delete_event_npc` | 3 |
| `ghl_delete_event_npc_2` / `_2_1` / `_3` | 2 each |
| `get_call_context`, `ghl_delete_event_npc_3_1`, `phoneNumber_inject` | 1 each |

This is also the **authoritative** answer to a question the Make cutover could only infer.
That document had to reconstruct external callers from cached Vapi samples in blueprint
metadata and could confirm only five. This is the live configuration, read from Vapi.

## What will not clone

Recorded in `clone-plan.json`, but the two that matter:

- **A Twilio number belongs to the Twilio account, not to Vapi.** The clone cannot carry
  `+61286093299` or `+61281056305` across; re-point them at the new Vapi org instead, and
  supply the Twilio Account SID and auth token again.
- **Vapi-provider numbers get new SIP URIs.** Anything dialling the old `sipUri` breaks.

Call history and analytics do not migrate. No NPC assistant sets a server-URL secret, so
nothing write-only is lost — that applies to 7 assistants in the org, none of them NPC.

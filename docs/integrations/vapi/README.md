# Vapi — org snapshot and migration bundle

> ⚠️ **Two secrets were committed here and need rotating** — the Vapi webhook secret and two
> `serverUrlSecret` values. The working tree is clean; the values remain in five pushed
> commits. See [`SECURITY-INCIDENT.md`](./SECURITY-INCIDENT.md).

Two things live here, and they are not the same thing.

| Directory | What it is |
| --- | --- |
| [`snapshot/`](./snapshot) | **The whole org, as it is now.** All 28 assistants and 20 tools with full configuration, plus every squad, phone number, workflow, test suite and file. Read-only capture; no migration opinion. |
| [`npc-services/`](./npc-services) | **The migration bundle.** Only the 15 NPC assistants and their closure, plus the clone plan, tool audit and webhook re-point map. |

Snapshotting is not migrating. The 13 non-NPC assistants are captured in `snapshot/`
for completeness and are **not** in scope for the clone.

## How this was taken

`GET` requests only, against `https://api.vapi.ai`. Nothing in the Vapi org was created,
updated or deleted to produce it. Each collection was checked against an individual
`GET` first — list payloads are byte-identical to single-resource payloads, so nothing is
truncated — and every committed record is byte-identical to the API response apart from
six redacted credential values.

**What is captured per assistant:** the complete record — system prompt (verified
byte-identical, up to 44,426 characters), LLM provider/model/temperature, voice provider
and voice ID with stability/similarity/speed, transcriber, server URL and timeout, first
message, end-call and voicemail messages, timeouts, tool ids, knowledge-base file ids,
analysis and artifact plans, compliance settings, and every other field the API returns —
134 distinct field paths in all.

**Per tool:** type, server URL and timeout, header *names* (values redacted), the full
function schema with parameters and required list, request/response messages, and which
assistants use it.

`assistants-index.json`, `tools-index.json` and [`snapshot/INDEX.md`](./snapshot/INDEX.md)
are derived views for reading at a glance — every value in them also appears in the full
records.

## The org is being edited while this was taken

Two pulls a few hours apart in the same session are not identical, and the difference is
not noise. **`NPC Active Nurturing` and `NPC Inbound Agent` had their `server.url` changed
at 17:28 and 17:29 on 2026-08-18**, from the new Make account back to the Supabase edge
function. Their version counters went v2 → v3. **The account owner made those changes
deliberately** — they are recorded here because the snapshot spans them, not as an anomaly.

Version history records the whole sequence — for `NPC Active Nurturing`:

| When | Server URL |
| --- | --- |
| 2026-08-18 17:29 | Supabase `vapi-call-webhook` (current) |
| 2026-08-18 12:44 | `hook.us2.make.com/my4fk4f1…` |
| 2026-07-22 and earlier | Supabase `vapi-call-webhook` |

The 12:44 entry is this migration's own footprint: creating a Vapi *app* hook in Make
writes its URL into the bound assistant, so those two were repointed as a side effect of
the Make work rather than deliberately. The 17:29 entry undid it. Net effect: **no NPC
assistant now points at the new Make account.**

Treat this snapshot as a point-in-time capture, not a stable baseline.

## Assistant state is captured four ways

The JSON records are the source of truth; these make them usable.

| Path | What it is |
| --- | --- |
| `snapshot/prompts/<sha16>.md` | **286 distinct system-prompt blocks** as plain text — every prompt in the current state *and* in all 444 historical versions, stored once and readable. |
| `snapshot/state/<assistant>.md` | One card per assistant: model, voice with every parameter, transcriber, server, tools (flagging the ones that 404), messages, behaviour flags, prompt links, call counts. |
| `snapshot/history/<assistant>.json` | Every version's **full** configuration, verbatim, with prompts by reference. |
| `snapshot/COMPARISON.md` | The 15 NPC assistants side by side, plus a tool matrix — built for checking against the dashboard. |

**The prompt store is lossless, and that is verified rather than assumed.** All 444 versions
rehydrate to a byte-identical match against the raw API payload, and every live prompt block
is present unaltered. Storing prompts once turns 11.9 MB of near-duplicate JSON into 7.5 MB
of readable Markdown plus 1.2 MB of configuration.

### Call volume — counts only

`snapshot/call-volume.json` records how many calls each assistant has and when the most
recent was. **No transcript, recording, phone number or any other call content was requested
or stored.** It is there to separate live assistants from dormant ones, and it shows
something worth knowing before migrating: **three of the four `NPC Sales Force` squad members
have never taken a call** — `NPC IFC Inbound`, `NPC Strategy Session Inbound` and
`NPC Opt In Follow Up Inbound` are all at zero. Only `NPC Inbound Agent` (37) has traffic, so
the inbound handoff routing has never actually been exercised in production.

## Assistant fetching is exhaustive, and that was checked

| Question | Answer |
| --- | --- |
| Is the list complete? | Yes — bare array of 28. `limit` works; unknown query params **400**. Only `createdAtGe`/`updatedAtGe` exist as extra filters. |
| Any assistant sub-endpoint missed? | 22 probed; only `/version` and `/versions` exist. `analytics`, `call`, `metrics`, `logs`, `tools`, `files`, `squad`, `usage`, `cost`, `export`, `clone` and 11 more all **404**. |
| Does `?version=vN` retrieve history? | **No — the parameter is ignored.** `v1`, `v2`, `v99` and `bogus` all return the current record, byte-identical to a plain `GET`. Only `/version` and `/versions` serve history. |

That last one produced a false alarm worth recording: `?version=v1` on `NPC IFC Inbound`
appeared to show a tool the version history said was never attached. It was not history — it
was the **live** record, which had changed minutes earlier.

### Assistants can carry inline functions, and six do

`assistant.model.functions[]` holds legacy inline function definitions with their **own
`serverUrl`**, separate from `model.toolIds` and absent from `/tool` entirely. There are
**16 across 6 assistants** — all non-NPC (Sham Dental, Ashwini, Farah, Mandy, Aishu, Raya) —
and all 16 point at `hook.eu2.make.com`. They are additional old-Make webhooks that a tool
inventory alone would never surface.

### `artifactPlan` references two more resource types

Both are now resolved — see
[`snapshot/STRUCTURED-OUTPUTS.md`](./snapshot/STRUCTURED-OUTPUTS.md).

**Structured outputs** live at `GET /structured-output`; six exist and are captured. They are
the post-call extractions Vapi runs over a transcript — `Appointment Booked`,
`Appt Time Selected`, `contact_id` and so on. One, `Zoom Call Booked` `468022e7`, is a
byte-for-byte duplicate of another and no assistant references it.

Their `assistantIds` reverse reference is **stale and should not be trusted** — three of the
six disagree with the assistants, all naming `NPC Opt In Follow Up`, which has referenced no
structured outputs since 2026-01-09. Read the forward reference on the assistant.

**The scorecard exists and is empty.** `cf81945a-c941-46a2-a538-2987abffe521`, referenced by
`NPC Opt In Follow Up` and `NPC Opt In Follow Up Inbound`, resolves at
`GET /observability/scorecard/{id}` — an endpoint found by reading the OpenAPI spec rather
than by guessing, after 13 guessed paths had 404'd and this file had wrongly called it a
dangling reference. The record is org-owned, its `assistantIds` are correct, and its
`metrics` array is **empty**: inert, not dangling. Captured in
[`snapshot/observability/`](./snapshot/observability/) and explained in
[`snapshot/OBSERVABILITY-AND-REPORTING.md`](./snapshot/OBSERVABILITY-AND-REPORTING.md),
which also lists the five other endpoint groups the spec exposed and probing never found.

## Provider credentials — and the one pointing at the old Make account

[`snapshot/CREDENTIALS.md`](./snapshot/CREDENTIALS.md) · `GET /credential` returns the org's
seven connected providers. **Vapi does not return the secret values**, so nothing here needed
redacting and nothing sensitive is committed — verified as 0 credential-shaped values across
all seven full records.

The `make` credential reads `teamId: "528268"`, `region: "eu2"` — the **legacy** Make team and
zone, the same account the 13 tool webhooks still point at. It has to be re-created against
team `2731020` in `us2`, and it is a dependency the tool payloads do not reveal: **no tool or
assistant references a `credentialId`**, so the link is visible only from `/credential`.

`Vapi-Twilio` is a `byo-sip-trunk` with one gateway, `npc-vapi.pstn.twilio.com`, and
**`inboundEnabled: false`**.

## The clone kit — push leg staged, not fired

[`clone-kit/`](./clone-kit/) turns the snapshot into 49 dependency-ordered `POST`
payloads (validated against the Create DTOs, offline) and a pusher, `push.py`, that is
dry-run by default: every write requires `--execute` plus a `VAPI_TARGET_TOKEN` for the
new account, fingerprints the target so it cannot write into the source org, remaps all
104 create-time references as ids are minted and backfills the 13 deferred reverse
references by PATCH once the assistants exist, substitutes secrets from the environment in
memory only, and read-back-diffs every create. Its `probe` subcommand is the experiment
`CLONE-CONTRACT.md` calls for. **Nothing has been executed** — the runbook in that
directory carries the cutover order, starting with rotating the webhook secret.

[`snapshot/FINAL-SWEEP.md`](./snapshot/FINAL-SWEEP.md) closes the capture: every read
path in the spec is now fetched, empty, data-not-config, or credential-gated (`/org`
answers 401 to this key). It also discloses the one thing a read changed: Vapi lazily
materialised its own default "Metrics Overview" board on first `GET` — platform
furniture, excluded from the clone set.

## What a clone can actually carry

[`snapshot/CLONE-CONTRACT.md`](./snapshot/CLONE-CONTRACT.md) ·
[`snapshot/clone-contract.json`](./snapshot/clone-contract.json) — every live record
diffed field by field against the `POST` schema that will have to accept it. **No object in
this account is missing a required field**, so everything here is expressible. The problem
is the other direction.

**Nine assistant fields and three tool fields are returned by the live API and appear
nowhere in the 2 MB spec** — not in the read schema, not in the Create DTO. `serverUrl` is
not in the document at all. Six non-function tools carry a `function` object that only
`CreateFunctionToolDTO` declares, and for `transferCall` and `endCall` that object holds the
description **the model reads to decide when to fire the tool**. Either the spec is
incomplete or a `POST` discards these values; only a write settles it, and this snapshot
makes none. **Create one assistant and one `transferCall` tool in the new account, read them
back, and diff — before cloning the other twenty-six.**

For the NPC fifteen the exposure is small and specific: three assistants carry any of the
nine, none carries `serverUrl`, and the one that bites is `backgroundDenoisingEnabled: true`
on `NPC Active Nurturing` and `NPC Strategy Session (Phone) Follow Up`, neither of which has
a `backgroundSpeechDenoisingPlan` to fall back on.

That file also carries the create order derived from the id references, and the two
blocked prerequisites: the four **Twilio Account SIDs** are `required` by
`CreateTwilioPhoneNumberDTO` and are redacted here by design, and all seven provider
credentials have to be re-authorised by hand because Vapi never returns their values.

## Observability, reporting and evaluation

[`snapshot/OBSERVABILITY-AND-REPORTING.md`](./snapshot/OBSERVABILITY-AND-REPORTING.md) ·
These six endpoint groups were found by reading the OpenAPI spec at
`https://api.vapi.ai/api-json`, not by probing. Four hold data:

| Endpoint | Items | What migrates |
| --- | --- | --- |
| `/observability/scorecard` | 1 | The scorecard both `NPC Opt In Follow Up` assistants reference. `metrics: []` — it exists and scores nothing. |
| `/reporting/insight` | 6 | Six `type: text` counters over the `events` table: voice / model / transcriber request failures, tool failures, call-ended-error, transfer failures. All org-owned. |
| `/reporting/board` | 1 | "Default Dashboard", `items: []`, `layout: {columns: 6}`. Empty. |
| `/eval/simulation/personality` | 7 | **Nothing.** All seven ids begin `a0000000-` and none carries this org's `orgId` — they are Vapi platform defaults. |

`/eval/simulation`, `/eval/simulation/scenario`, `/eval/simulation/run`, `/eval/simulation/suite`
and `/eval/run` all return 0.

**Neither the spec nor probing is sufficient on its own.** The spec exposes
`/observability/*`, `/reporting/*`, `/eval/simulation/*`, `/v2/phone-number` and
`/provider/{provider}/{resourceName}`, none of which a path guess would reach. The live API
serves `/workflow`, `/test-suite`, `/credential`, `/knowledge-base`, `/template`, `/logs` and
all three version endpoints, none of which appear in the spec at all. This snapshot was taken
against both.

## Tool fetching is exhaustive, and that was checked

| Question | Answer |
| --- | --- |
| Is the list complete? | Yes — bare array of 20, no pagination wrapper. `limit` works; unknown query params are **rejected with 400**, so there are no hidden filters or expansions to miss. |
| Does a single `GET` return more? | No — byte-identical to the list entry. |
| Is version history complete? | `/tool/{id}/versions` carries the full per-version payload. `?version=vN` was cross-checked against it for all 20 — **20 match, 0 differ** — so it adds nothing. |
| Can the 4 dangling tools be recovered? | No. Base, `/versions` and `?version=` all **404**. |
| Any adjacent endpoint missed? | A sweep of 33 candidates found `/credential` (7 items, now captured) and `/template` (0). |
| Tool-call analytics? | None exists — `/tool/{id}/analytics`, `/log`, `/metrics` all 404. |

`/logs` is live with 1,198 entries but is the **API access log** — it records requests made
*to* Vapi, not tool invocations, and its most recent rows are this session's own reads. Not
captured.

## Tool state is captured the same four ways

| Path | What it is |
| --- | --- |
| `snapshot/tool-prose/<tool>.md` | **Everything an LLM reads about the tool**: the function description, every parameter description, the spoken `request-start` / `request-complete` / `request-failed` messages, and any transfer destination. Verified verbatim against the JSON. |
| `snapshot/tool-state/<tool>.md` | Server URL, timeout, header names, async flag, function signature, messages, and which assistants use it. |
| `snapshot/tool-versions/<tool>.json` | `GET /tool/{id}/versions`. |
| `snapshot/TOOLS-COMPARISON.md` | All 20 side by side, an assistant × tool matrix, and every orphan and dangling reference. |

**Every scalar value in every raw tool payload is represented in at least one of these views.**
That is asserted, not assumed — the only exclusions are `orgId`, the constant
`function.parameters.type`, and credential header values, which are redacted by design.
The assertion exists because an earlier version of these views silently omitted four things:
**static body fields** (`tool.parameters`), `variableExtractionPlan`, tool `metadata` and
`function.strict`. The raw JSON always carried them; the readable layer did not.

Static body fields matter most of the four. They are what the tool sends on **every** call
regardless of what the model decides — `transfer_to_human` posts `callerPhone`,
`customer_number`, `vapiCallId`, `calledNumber` and `callType`, all filled from Vapi
template variables. Four of the twenty tools use them, and `phoneNumber_inject` sends
thirteen. `variableExtractionPlan.aliases` is the same story in reverse: it binds fields of
the HTTP response back into Vapi variables, which is how `contactId` and `firstName` become
available to later turns.

The prose files matter more than they look. A tool's description is what decides whether the
model calls it at all, and `ghl_create_booking` alone carries a 500-character description
plus ten documented parameters — that text is the contract, and it is easier to review as
Markdown than buried in JSON escapes.

### Correction: tools *do* have version history

An earlier pass in this session reported that they do not. That was wrong, and the cause was
a path assumption: assistants expose `/assistant/{id}/version` (**singular**), so the same
form was tried on tools, where it 404s. The working path is `/versions` (**plural**).

Worse, the two assistant forms are not aliases — they are different systems, and both are
now captured:

| Endpoint | Returns |
| --- | --- |
| `GET /assistant/{id}/version` | 444 auto-snapshots, full config under a `data` key |
| `GET /assistant/{id}/versions` | 33 **named** versions (v1/v2/v3) with `configHash`, `parentVersion` and **`createdBy`** |
| `GET /tool/{id}/versions` | 20 named versions, one per tool |
| `GET /tool/{id}/version` | 404 |

`createdBy` is the useful addition: it attributes each named version to an account. It is
what confirms the 17:29 server-URL change on `NPC Active Nurturing` was made by
`lavan.smi@gmail.com`, and it is blank on versions the platform generated itself.

## Start here for the inbound squad

[`snapshot/SQUAD-NPC-SALES-FORCE.md`](./snapshot/SQUAD-NPC-SALES-FORCE.md) is a deep-dive on
`NPC Sales Force` — the only place in the org where a caller is routed between assistants,
and the part of the estate with the most moving pieces. Call flow, all four members, the
inline handoff tool, seven findings and what migration has to get right. **Every factual
claim in it is asserted against the raw API data by a check that passes 20/20.**

The headline: the handoff wiring itself is correct and complete, but `NPC IFC Inbound` is
instructed 15 times to call a booking tool it does not have, and the whole squad has never
executed a single handoff in production.

## Squads, phone numbers and the workflow

| Path | What it is |
| --- | --- |
| `snapshot/squad-state/<squad>.md` | Every member, every override, and the **inline `handoff_to_assistant` tool expanded** — its destinations, the condition each is chosen on, and the variables it extracts. |
| `snapshot/phone-state/<number>.md` | What each number routes to, plus `sipUri`, `fallbackDestination`, `smsEnabled`, server — and whether it can be carried across at all. |
| `snapshot/workflow-state/<workflow>.md` | The workflow as a **mermaid graph**, plus every conversation-node prompt, first message, tool node and edge condition, verbatim. |

**None of the three has version history.** `/version` and `/versions` both 404 for squad,
phone-number and workflow. `?version=v1` returns 200 but is byte-identical to the current
record — the parameter is ignored rather than serving history. Assistants and tools are the
only versioned resources.

### `NPC Follow Up` is an uncustomised Vapi sample

The one workflow in the org carries an NPC name and no NPC content. Counted across its
whole payload:

| Term | Mentions |
| --- | ---: |
| Wellness Partners | 6 |
| patient | 38 |
| Riley | 3 |
| Naidu / property / discovery call | **0** |
| NPC | 1 — the name on the record |

Its start node opens *"You are Riley, appointment scheduling assistant for Wellness Partners
health clinic."* **Nothing references it** — no phone number, assistant or squad. Its
`transferCall` node has an empty `destinations` array, so it could not transfer even if
reached. Decide what it is for before migrating it.

### Two numbers route nowhere

`+61286093299` (*Naidu Property Consulting Services*) and `+61281056305` (*NPC Services*)
have no `assistantId`, `squadId` or `workflowId`. Inbound calls to them are unrouted. The
`NPC Services` **Vapi** number is the one wired to the `NPC Sales Force` squad.

## Assistant version history

`GET /assistant/{id}/version` returns a full historical configuration per version — **444
versions across the 28 assistants**, 11.9 MB. That raw history is *not* committed;
[`snapshot/history-index.json`](./snapshot/history-index.json) records, for every version,
its timestamp, server URL, LLM model, voice ID and a hash of the system prompt, which is
enough to see when any of those changed and to fetch the full record on demand.

Tools have named versions of their own at `GET /tool/{id}/versions` — see the correction above.

## What is redacted

Every value under a key in a fixed set, replaced with `{{REDACTED:…}}` placeholders and
listed by kind in `snapshot/manifest.json`: the Vapi webhook secret, two `serverUrlSecret`
values, four Twilio Account SIDs, one Airtable personal access token and one GoHighLevel PIT
token. Nothing else is altered.

The rule is an **exact match on the lowercased key**, not a substring or an anchored regex.
That matters in both directions: `maxTokens`, `promptCacheKey`, `isServerUrlSecretSet` and a
static body field literally named `key` must *not* be caught, and `x-vapi-webhook-secret` and
`serverUrlSecret` must be. An earlier anchored pattern (`^secret$`, `^token$`, …) satisfied
the first requirement and failed the second, and both of those values reached five pushed
commits before it was found — [`SECURITY-INCIDENT.md`](./SECURITY-INCIDENT.md) records what
leaked, where, and what still needs rotating. A value-based sweep over the whole tree now
runs as a second line of defence, so a key nobody anticipated cannot leak a value that was
already seen elsewhere.

The Airtable PAT and the GHL PIT sit on tools no assistant calls, and neither appears on the
Make rotation list — both should be rotated regardless.

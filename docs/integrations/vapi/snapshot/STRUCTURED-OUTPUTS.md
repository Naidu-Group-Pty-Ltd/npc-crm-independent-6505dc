# Structured outputs and scorecards

`artifactPlan` on an assistant can reference two further resource types. Both were found only by walking every field of the assistant payloads — nothing in the assistant record names the endpoint, and neither type appears in any tool, squad or phone-number record.

## Structured outputs — `GET /structured-output`

Six exist. These are the post-call extractions Vapi runs over a transcript: each has an AI-evaluated schema and a description that tells the model what to look for.

| Name | Type | Schema | Referenced by | Description |
| --- | --- | --- | ---: | --- |
| `Appointment Booked` | ai | `boolean` | 3 | Tracks successful appointment bookings from customer calls |
| `Appointment Cancelled` | ai | `boolean` | 1 | Monitors appointment cancellations during calls |
| `Appt Time Selected` | ai | `string` | 2 | Capturing the exact appointment time is essential for scheduling. |
| `Zoom Call Booked` | ai | `boolean` | 1 | Tracking whether the call was booked is crucial for measuring the assistant's effectiven |
| `Zoom Call Booked` | ai | `boolean` | **0** | Tracking whether the call was booked is crucial for measuring the assistant's effectiven |
| `contact_id` | ai | `string` | 1 | GHL contact id |

**One is an orphan.** `Zoom Call Booked` `468022e7` is a byte-for-byte duplicate of `a5b2f26a` — same name, same description, same schema — and no assistant references it.

### `assistantIds` on these records is stale — do not trust it

Each structured output carries an `assistantIds` reverse reference, and **three of the six disagree with the assistants themselves**. All three name `NPC Opt In Follow Up`, which has referenced **no** structured outputs since **2026-01-09** — its `artifactPlan.structuredOutputIds` has been empty across every version since. The assistant is right and the reverse reference was never cleaned up.

Worth stating because it is a trap for a migration script: read the forward reference (`assistant.artifactPlan.structuredOutputIds`), never the reverse one.

| Record | `assistantIds` says | assistants actually referencing it |
| --- | --- | --- |
| `Appointment Booked` | NPC Discovery Call Follow Up, NPC Discovery Call No Show Follow Up, NPC Opt In Follow Up, NPC Quiz Follow Up | NPC Discovery Call Follow Up, NPC Discovery Call No Show Follow Up, NPC Quiz Follow Up |
| `Appt Time Selected` | NPC Discovery Call No Show Follow Up, NPC Opt In Follow Up, NPC Quiz Follow Up | NPC Discovery Call No Show Follow Up, NPC Quiz Follow Up |
| `Zoom Call Booked` | NPC Opt In Follow Up, NPC Quiz Follow Up | NPC Quiz Follow Up |

## Scorecards — one exists, and it is empty

`NPC Opt In Follow Up` and `NPC Opt In Follow Up Inbound` both reference scorecard
`cf81945a-c941-46a2-a538-2987abffe521`. **It resolves.** The record is captured at
[`observability/scorecard.scorecard-for-assistant-npc-opt-in-follow-up.cf81945a-c941-46a2-a538-2987abffe521.json`](./observability/scorecard.scorecard-for-assistant-npc-opt-in-follow-up.cf81945a-c941-46a2-a538-2987abffe521.json).

> **Correction.** An earlier pass in this file declared the scorecard unretrievable after
> thirteen candidate paths all returned 404. That conclusion was wrong, and it was wrong
> because the paths were **guessed** rather than read off the spec. The endpoint is
> `GET /observability/scorecard/{id}` — an `/observability/` prefix that no amount of
> guessing at `/scorecard`, `/rubric` or `/evaluation` would have produced. The spec at
> `https://api.vapi.ai/api-json` names it. See
> [`OBSERVABILITY-AND-REPORTING.md`](./OBSERVABILITY-AND-REPORTING.md).

It is org-owned (`orgId` matches), created `2025-11-18T03:40:04.782Z` and never updated
since, and its `assistantIds` reverse reference is — unlike the structured outputs' —
**correct**: both ids name assistants that really do carry `scorecardIds`.

`metrics` is `[]`. So the scorecard is **inert rather than dangling**: it exists, the
assistants point at a real object, and that object scores nothing. A clone must carry it
across for fidelity, but nothing about a call's behaviour depends on it.

## Not fetched because they are empty

`/eval` returns 0 items. `/template` returns 0. `/knowledge-base` returns 0 — the assistants' knowledge bases are `provider: google` file lists on `model.knowledgeBase`, not managed knowledge-base objects.


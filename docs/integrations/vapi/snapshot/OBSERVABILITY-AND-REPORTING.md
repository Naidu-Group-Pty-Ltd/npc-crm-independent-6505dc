# Observability, reporting and simulation

Four collections found only from the **OpenAPI spec** at `https://api.vapi.ai/api-json`. None is reachable from a path anyone would guess: they live under `/observability/`, `/reporting/` and `/eval/simulation/` prefixes.

## The scorecard is not a dangling reference — I had the prefix wrong

An earlier pass reported `cf81945a-c941-46a2-a538-2987abffe521` as unresolvable after 13 candidate paths all 404'd. **It resolves fine at `GET /observability/scorecard/{id}`**, which was not among the 13. The mistake was guessing paths instead of reading the spec.

```json
{
  "id": "cf81945a-c941-46a2-a538-2987abffe521",
  "name": "scorecard for assistant NPC Opt In Follow Up",
  "metrics": [],
  "createdAt": "2025-11-18T03:40:04.782Z",
  "updatedAt": "2025-11-18T03:40:04.782Z",
  "assistantIds": [
    "b3acdd28-558a-4893-9cfe-c3abacdbe6bd",
    "739b47bf-9adb-4ac6-aca4-976d815f673e"
  ]
}
```

It is real, it is org-owned, and its `assistantIds` correctly names **NPC Opt In Follow Up, NPC Opt In Follow Up Inbound** — matching both assistants that reference it. But **`metrics` is an empty array**, so it scores nothing. It was created 2025-11-18 and never updated. Inert rather than missing.

## Insights — 6, all org-owned, all failure counters

| Name | Measures |
| --- | --- |
| Call Ended (Error) Count | `count` on `call.ended` |
| Model Request Failed Count | `count` on `assistant.model.requestFailed` |
| Tool Failed Count | `count` on `assistant.tool.failed` |
| Transcriber Request Failed Count | `count` on `assistant.transcriber.requestFailed` |
| Transfer Failed Count | `count` on `call.transferFailed` |
| Voice Request Failed Count | `count` on `assistant.voice.requestFailed` |

All six are `type: text` counters over the `events` table with no filters — the standard Vapi failure set. `Tool Failed Count` and `Transfer Failed Count` are the two worth watching during a migration, since both failure modes are exactly what a mis-pointed webhook produces.

## Board — 1, and it is empty

`Default Dashboard` has `items: []` and a 6-column layout. Nothing has been added to it.

## Simulation personalities — 7, none of them yours

`Skeptical Sam`, `Impatient Irene`, `Rambling Roger`, `Emotional Eva`, `Multitasking Maya`, `Decisive Derek`, `Confused Carl`. Every id begins `a0000000-` and **none carries this org's `orgId`** — they are Vapi platform defaults visible to every account, not org content. Nothing to migrate. The org's own simulation collections are all empty: `/eval/simulation`, `.../scenario`, `.../run`, `.../suite` and `/eval/run` return 0.

## The spec and the live API disagree, in both directions

Worth recording, because it means neither source alone is sufficient:

**In the spec, absent from my probing** — `/observability/scorecard`, `/reporting/insight`, `/reporting/board`, `/eval/simulation/*`, `/v2/phone-number`, `/provider/{provider}/{resourceName}`. Guessing path names would never have found these prefixes.

**Live, but absent from the spec** — `/workflow`, `/test-suite`, `/credential`, `/knowledge-base`, `/template`, `/logs`, and every version endpoint (`/assistant/{id}/version`, `/assistant/{id}/versions`, `/tool/{id}/versions`). All return 200 and carry real data, and none appears among the spec's 64 paths.

So the published spec is a **subset** of what the API serves, and probing is a subset of what the spec documents. This capture used both.


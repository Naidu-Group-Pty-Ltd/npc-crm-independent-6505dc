# What a clone can actually carry

Machine-readable companion: [`clone-contract.json`](./clone-contract.json).

The snapshot in this directory records what the current Vapi account *holds*. This file
records what the Vapi API will *accept* when we write it into the new one, and where the
two disagree. It is derived from the OpenAPI document at `https://api.vapi.ai/api-json`
(OpenAPI 3.0.0, 2,090,067 bytes) checked field by field against the live records — no
writes were made to the current account to produce it.

The method is the same for every resource: take the `POST` request-body schema, resolve
its `oneOf` against each live record's discriminator (`type` for tools, `provider` for
phone numbers), and diff the record's keys against the schema's properties. Three
outcomes:

- **server-side only** — `id`, `orgId`, `createdAt`, `updatedAt`, `latestVersion`,
  `isServerUrlSecretSet`, `status`. Assigned by the API. Nothing is lost.
- **not accepted on create** — the record carries it and the Create DTO does not declare
  it. This is the interesting column.
- **missing required** — required by the DTO and absent from the record. **There are
  none, anywhere.** Every object in this account is expressible.

## The finding: the spec under-documents what the API stores

Nine assistant fields and three tool fields are returned by the live API on real records
and appear in **neither** the read schema **nor** the Create/Update DTO for that
resource. They are not deprecated-and-documented; they are absent from the entire
2 MB spec.

| Assistant field | Carriers | Present anywhere in the spec? |
| --- | --- | --- |
| `backgroundDenoisingEnabled` | 14 | No. Superseded in the DTO by `backgroundSpeechDenoisingPlan`. |
| `backchannelingEnabled` | 11 | No. |
| `hipaaEnabled` | 10 | Only on `CompliancePlan` / `Org`, not on an assistant. |
| `endCallFunctionEnabled` | 9 | No. Superseded by an `endCall` tool. |
| `serverUrl` | 7 | **Nowhere in the spec at all.** Superseded by `server.url`. |
| `recordingEnabled` | 7 | Only on `ArtifactPlan`. |
| `dialKeypadFunctionEnabled` | 7 | No. Superseded by `keypadInputPlan`. |
| `voicemailDetectionEnabled` | 7 | No. Superseded by `voicemailDetection`. |
| `silenceTimeoutSeconds` | 3 | Only on `TransferAssistant`, not on an assistant. |

| Tool field | Carriers | Types that carry it |
| --- | --- | --- |
| `function` | 6 | `mcp`, `transferCall`, `endCall`, `gohighlevel.contact.get` ×2, `google.sheets.row.append` |
| `async` | 2 | `transferCall`, `endCall` |
| `metadata` | 1 | `gohighlevel.contact.get` |

`function` is declared only on `CreateFunctionToolDTO`. The other six tools are not
function tools, yet they carry a `function` object — and it is not decoration:

> `transferCall` / `transfer_to_human` — *"Trigger this tool when a caller asks to speak
> to a human/real person"*
> `endCall` / `end_call_tool` — *"This tool should be called only after the agent has
> completed the closing sequence and said goodbye to the caller."*

**Those descriptions are what the model reads to decide when to fire the tool.** A clone
that drops them changes behaviour rather than metadata.

**So the spec cannot be used on its own to decide what to send.** Either it is incomplete
and the API accepts these fields, or a `POST` silently discards them. Both are consistent
with the evidence here, and the difference is only settleable by writing — which this
snapshot deliberately does not do. **Verification step for the cutover: create one
assistant and one `transferCall` tool in the new account carrying these fields, read them
back, and diff.** Do that before cloning the other twenty-six.

## What this means for the fifteen NPC assistants

Three of the fifteen carry any of the nine fields, and no NPC assistant carries
`serverUrl`:

| Assistant | Fields | Value |
| --- | --- | --- |
| `NPC Active Nurturing` | `backgroundDenoisingEnabled` | `true` |
| `NPC Strategy Session (Phone) Follow Up` | `backgroundDenoisingEnabled` | `true` |
| `NPC Discovery Call Follow Up` | `backgroundDenoisingEnabled` / `hipaaEnabled` / `endCallFunctionEnabled` | `false` / `false` / `true` |

None of the three declares a `backgroundSpeechDenoisingPlan`, so if the field is dropped
on create, **denoising turns off on two live NPC assistants** and nothing reports it.
`NPC Discovery Call Follow Up` has an empty `model.tools` and four `toolIds`, so its
`endCallFunctionEnabled: true` is the only thing ending its calls — the `endCall` tool
`bbbf6fb6` is a separate record it does not reference.

The seven `serverUrl` carriers — `Unstructured Assistant New`, `JG Facilities
Management`, `Ramitta Barber`, `Kamileon Cube`, `Bartini Bartenders`, `Aishu`, `Raya` —
are all **outside** the migration set, and six of the seven have no `server` object at
all, so for them the legacy field is the only webhook destination there is. They are all
VoiceGlow endpoints (`na-runtime.voiceglow.org`, `na-gcp-api.vg-stuff.com`). If any of
them is ever migrated, that URL has to be moved to `server.url` by hand.

## Required fields, and the two that are blocked

| Resource | `POST` requires | Note |
| --- | --- | --- |
| assistant | *nothing* | Every field optional. |
| tool | `type` | Per variant. |
| squad | `members` | Member `assistantId`s must be remapped first. |
| workflow | `name`, `nodes`, `edges` | See below. |
| structured output | `name`, `schema` | |
| scorecard | `metrics` | Ours is `[]`. Required means present, not non-empty. |
| board | `name`, `layout` | |
| insight | `type`, `queries` | |
| phone number (`vapi`) | `provider` | |
| phone number (`twilio`) | `provider`, `number`, **`twilioAccountSid`** | ⚠️ |
| phone number (`byo`) | `provider`, **`credentialId`** | Nothing here uses it. |

⚠️ **The four Twilio Account SIDs are redacted in this snapshot and are required to
recreate the four Twilio numbers.** They are in the Vapi dashboard and in Twilio; they
are deliberately not in this repo. That is a dependency to satisfy at cutover, not a gap
in the capture.

The same shape applies to credentials: `GET /credential` returns the seven connected
providers but never their secret values, so every one has to be re-authorised by hand in
the new account before anything that depends on it is created. The `make` credential
still reads `teamId: "528268"`, `region: "eu2"` — the legacy team.

## Create order

Derived from the id references, not assumed:

1. **Credentials** — re-authorise all seven by hand. Nothing references a `credentialId`,
   so nothing will fail loudly if this is skipped; it will fail at call time.
2. **Tools** (20) — depend on nothing. New ids.
3. **Structured outputs** (6) and the **scorecard** (1) — depend on nothing.
4. **Assistants** (15 NPC) — remap `model.toolIds`, `artifactPlan.structuredOutputIds`
   and `artifactPlan.scorecardIds` onto the ids from steps 2–3.
5. **Squads** — `members[].assistantId` onto step 4.
6. **Workflows** — `nodes`/`edges` are self-contained.
7. **Phone numbers** — `assistantId` / `squadId` onto steps 4–5.

## `/workflow` is defined but not routed

The spec declares `Workflow`, `CreateWorkflowDTO` and `UpdateWorkflowDTO` in
`components.schemas` and then declares **no `/workflow` path at all** — not `GET`, not
`POST`. The live API serves `GET /workflow` and returns one record. The schemas are
orphaned from the path list rather than absent, and the one live workflow maps onto
`CreateWorkflowDTO` with nothing left over: only `id`, `orgId`, `createdAt` and
`updatedAt` fall outside it, all four server-assigned.

This is the mirror image of the `/observability/scorecard` mistake recorded in
[`OBSERVABILITY-AND-REPORTING.md`](./OBSERVABILITY-AND-REPORTING.md): there, probing
missed a path the spec named; here, the spec omits a path that probing found. **Check
both, every time.**

# Aurixa Systems org — live NPC prompts

Org `453f00c2-cb26-43f0-8da3-2eb13b578e15`. This is **where the live NPC line
answers**, and it is not the org the sibling directories capture:
[`snapshot/`](../snapshot) and [`npc-services/`](../npc-services) are the
*source* org `c9015cd5-…`, taken before the migration.

Only the assistants changed by
[`TRANSFER_TO_HUMAN.md`](../TRANSFER_TO_HUMAN.md) are here — all twelve NPC
assistants that carry a transfer protocol. This is not an org snapshot and does
not try to be one.

| file | assistant | id | MD5 of the live prompt |
|---|---|---|---|
| `prompts/npc-inbound-agent.b834610e.md` | NPC Inbound Agent (Angela) | `b834610e-469e-4f9f-9130-01a1fa751064` | `f24069d0eb68752fc38166e93aa58a7c` |
| `prompts/npc-ifc-inbound.ed0aa90f.md` | NPC IFC Inbound | `ed0aa90f-e5ea-439d-b086-f694cf5f978d` | `764c54fa5b7a7b32645373b738d3d8c3` |
| `prompts/npc-strategy-session-inbound.f958ec93.md` | NPC Strategy Session Inbound | `f958ec93-6f41-4507-a7b1-f8c8d54e775e` | `0db3dc62dfbc616b25634976128fc2c6` |
| `prompts/npc-opt-in-follow-up-inbound.fdb1ecde.md` | NPC Opt In Follow Up Inbound (Monica) | `fdb1ecde-e884-4650-abd3-8c19a2a006dd` | `01f166d09486a3447b92c7c8158f26bf` |
| `prompts/npc-discovery-call-no-show-follow-up.9013efd8.md` | NPC Discovery Call No Show Follow Up | `9013efd8-c662-4466-99f9-bb9597b44cfb` | `78b365c8a70de6c5f4bcd6eb5e6b14ee` |
| `prompts/npc-active-nurturing.66d3e994.md` | NPC Active Nurturing | `66d3e994-32c4-4d38-90af-2351078ad0f7` | `4b975ac4d3b0543cf5abdc23247e2394` |
| `prompts/npc-discovery-call-follow-up-test.6930782c.md` | NPC Discovery Call Follow Up Test | `6930782c-fc21-4b0b-9e38-97d508cc413d` | `5afd30a72d207af8dc5464933c9e538c` |
| `prompts/npc-ifc-follow-up.55685df0.md` | NPC IFC Follow Up | `55685df0-3ab8-4b8b-8695-6640e4e06fc1` | `c599bc3a8545ce4498d5aa2b6435b709` |
| `prompts/npc-ifc-no-show-follow-up.209964e0.md` | NPC IFC No Show Follow Up | `209964e0-9b0c-48b1-a190-9b462de21462` | `b7bbc56f1f374c2d7d5542f99a9b9851` |
| `prompts/npc-strategy-session-phone-follow-up.f8abe39e.md` | NPC Strategy Session (Phone) Follow Up | `f8abe39e-0944-4a53-afa6-95ac1852f892` | `8d8e9ffca34382582521c7c00194f584` |
| `prompts/npc-strategy-session-phone-no-show.5aa70a8e.md` | NPC Strategy Session (Phone) No Show | `5aa70a8e-01fb-4bcb-b275-6822b4e7e3da` | `a6ba2ab87ece3ea6ceb15be6a5c1fa01` |
| `prompts/npc-quiz-follow-up.044329e5.md` | NPC Quiz Follow Up | `044329e5-4709-49f9-81f7-d1e25ea28213` | `a1f627a1b20436aa33b26359f64601f5` |

The first four are the squad behind the inbound line; the rest are outbound
follow-ups.

Each file is the `model.messages[0].content` string exactly as Vapi returned it
after the change, byte for byte. The MD5 above is what a `GET /assistant/<id>`
computes over that field today; it is how you tell whether the live prompt has
drifted from this record.

## What this is for

**It is the rollback.** The *previous* text of all twelve is already in git —
each was byte-identical to its `snapshot/` copy before the edit, verified by
length and MD5 — so a revert is a `PATCH` back to the snapshot's string. There
was no forward record until this directory existed.

**And the forward text is checkable rather than transcribed.** Each of these
files was rebuilt locally by applying the same edit to the committed snapshot,
and kept only because its MD5 equalled what Vapi returned on the read-back. A
mistyped character would have produced a different digest and been refused. So
these bytes are the live bytes by proof, not by careful copying.

## Three things to know before editing a prompt here

**Vapi `PATCH` replaces a whole top-level key.** Changing the prompt means
sending the entire `model` object — `provider`, `model`, `toolIds`,
`knowledgeBase`, `temperature`, `maxTokens`, `promptCacheKey`,
`promptCacheRetention` and `messages` together. Sending `messages` alone drops
the tool bindings and the knowledge base, silently, and the assistant keeps
answering.

**Every one of these twelve carries a different `model` object, and the
snapshot goes stale.** Three have no `knowledgeBase` key at all; one carries
`promptCacheKey`/`promptCacheRetention`; `maxTokens` ranges from 450 to 10000;
two different knowledge-base file ids appear (`1e87753e-…` and `a9c4f938-…`,
against `9fff4149-…` in `snapshot/`); and every one runs `gpt-5.6-luna` where
the snapshot says `gpt-5.2-chat-latest`. Read the whole `model` object live and
send it back; copying any of it from the source-org capture writes a stale
value over a current one.

**A Make mapper resolves `{{firstName}}`.** These prompts contain 5–56 such
tokens, in the very sentences instructing the assistant never to say a raw
variable aloud. Anything that carries a prompt through Make must not expose it
as a mapper literal, or those tokens are silently replaced with nothing.

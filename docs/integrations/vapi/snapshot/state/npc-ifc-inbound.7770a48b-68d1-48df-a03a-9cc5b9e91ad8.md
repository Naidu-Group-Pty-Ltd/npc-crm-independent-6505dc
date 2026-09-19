# NPC IFC Inbound

`7770a48b-68d1-48df-a03a-9cc5b9e91ad8` · org `c9015cd5-3701-4ac5-aa9c-be6cdcaaecdd` · created 2025-12-15 · updated 2026-08-18 18:22:26 · version `v2`

## Model

- **Provider / model**: openai · `gpt-5.6-luna`

## Voice

- **Provider / voice ID**: 11labs · `02y4x5i9YrzYlFvGo1pp`
- **model**: `eleven_flash_v2_5`
- **stability**: `0.5`
- **similarityBoost**: `0.75`

## Transcriber

- **Provider / model**: deepgram · `flux-general-en` · language `en`

## Server

- **URL**: `https://dduzbchuswwbefdunfct.supabase.co/functions/v1/vapi-call-webhook`
- **Timeout**: 20s · **header names**: `x-vapi-webhook-secret`
- **Server URL secret set**: no
- **serverMessages**: —
- **clientMessages**: —

## Tools

| Tool | ID | Resolves | Server URL |
| --- | --- | --- | --- |
| ghl_delete_event_npc_3 | `006be564-14c2-4db9-9c90-6821d363b123` | yes | `https://hook.eu2.make.com/ks0eu13idcgwr9wf8tp4ak7a1gqj8e6i` |
| end_call_tool | `bbbf6fb6-685d-411e-b0e1-bec5acc4fa8e` | yes | `—` |
| ghl_resolve_contact | `3e116e74-0dda-4277-ae38-468bdd3464e6` | yes | `https://hook.eu2.make.com/db3ws2lmqi4qh9ozsyt1tvn3j8tbeahm` |
| ghl_check_availability | `6587bc7d-7382-4e33-a38d-95f5740df52a` | yes | `https://hook.eu2.make.com/3xslmou0jpbwxbutg8we362f9jsh96q0` |
| transfer_to_human | `5c0c334c-6bbf-4399-b748-a3c50207e754` | yes | `https://hook.eu2.make.com/jb85m14jchgktf09sfxt4jmf8yggaw32` |
| ghl_create_booking | `f195a817-8346-475d-ad0e-8033f1d2e283` | yes | `https://hook.eu2.make.com/eop70ky2635nobauh7lyof13sctvl0ga` |

**Knowledge base files**: `9fff4149-3aec-48f0-9378-d56760390216`

## Messages

- **firstMessage**: 

  > Hi {{firstName}}. I'm Sandra, from Naidu Property Consulting Services. How can I help you today?

- **endCallMessage**: 

  > Goodbye.

- **voicemailMessage**: 

  > Hi, this is Sandra from Naidu Property Consulting Services, just a quick reminder about your upcoming initial finance consult. If you're unable to attend, please call us back on this number so we can schedule a new slot that works for you.

- **firstMessageMode**: `assistant-speaks-first`
- **endCallPhrases**: —

## Behaviour

- **maxDurationSeconds**: `1444`

## System prompt

- `system` — 41,511 chars → [`prompts/73574a0312d5a231.md`](../prompts/73574a0312d5a231.md)

## Call history (counts only — no call content captured)

- **calls returned** (window of 100): 0
- **most recent**: never called

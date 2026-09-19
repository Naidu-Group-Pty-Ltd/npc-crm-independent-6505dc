# NPC IFC Follow Up

`a4ddecba-df99-49e4-8e47-4c4b57f4a991` · org `c9015cd5-3701-4ac5-aa9c-be6cdcaaecdd` · created 2025-12-07 · updated 2026-07-22 05:53:32 · version `v1`

## Model

- **Provider / model**: openai · `gpt-5.2-chat-latest`

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
| ghl_delete_event_npc_3_1 | `ba13974d-8005-487d-81b9-4dc569a9f6d4` | yes | `https://hook.eu2.make.com/u60ggcqrdo9tq4gbiwabe67w9nwg255m` |
| transfer_to_human | `5c0c334c-6bbf-4399-b748-a3c50207e754` | yes | `https://hook.eu2.make.com/jb85m14jchgktf09sfxt4jmf8yggaw32` |
| ghl_create_booking | `f195a817-8346-475d-ad0e-8033f1d2e283` | yes | `https://hook.eu2.make.com/eop70ky2635nobauh7lyof13sctvl0ga` |
| ghl_check_availability | `6587bc7d-7382-4e33-a38d-95f5740df52a` | yes | `https://hook.eu2.make.com/3xslmou0jpbwxbutg8we362f9jsh96q0` |
| ghl_resolve_contact | `3e116e74-0dda-4277-ae38-468bdd3464e6` | yes | `https://hook.eu2.make.com/db3ws2lmqi4qh9ozsyt1tvn3j8tbeahm` |

**Knowledge base files**: —

## Messages

- **firstMessage**: 

  > Hi there. I'm Sandra, calling from Naidu Property Consulting Services. Am I speaking to {{fullName}} ?

- **endCallMessage**: 

  > Goodbye.

- **voicemailMessage**: 

  > Hi, this is Sandra from Naidu Property Consulting Services, just a quick reminder about your upcoming initial finance consult. If you're unable to attend, please call us back on this number so we can schedule a new slot that works for you.

- **firstMessageMode**: `assistant-waits-for-user`
- **endCallPhrases**: —

## Behaviour


## System prompt

- `system` — 40,878 chars → [`prompts/e944028308fae22e.md`](../prompts/e944028308fae22e.md)

## Call history (counts only — no call content captured)

- **calls returned** (window of 100): 4
- **most recent**: 2025-12-08

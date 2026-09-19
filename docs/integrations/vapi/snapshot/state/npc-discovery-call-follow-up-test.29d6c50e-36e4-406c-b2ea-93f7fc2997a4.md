# NPC Discovery Call Follow Up Test

`29d6c50e-36e4-406c-b2ea-93f7fc2997a4` · org `c9015cd5-3701-4ac5-aa9c-be6cdcaaecdd` · created 2025-11-24 · updated 2026-07-22 05:50:14 · version `v1`

## Model

- **Provider / model**: openai · `gpt-5.2-chat-latest`
- **temperature**: `0.9`
- **maxTokens**: `450`

## Voice

- **Provider / voice ID**: 11labs · `jBzLvP03992lMFEkj2kJ`
- **model**: `eleven_turbo_v2_5`
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
| ghl_delete_event_npc | `5934c762-0223-4112-bfb7-88931da17652` | yes | `https://hook.eu2.make.com/9inh27jwcxodgecrbwvjosx7i5xedm67` |
| end_call_tool | `bbbf6fb6-685d-411e-b0e1-bec5acc4fa8e` | yes | `—` |
| transfer_to_human | `5c0c334c-6bbf-4399-b748-a3c50207e754` | yes | `https://hook.eu2.make.com/jb85m14jchgktf09sfxt4jmf8yggaw32` |
| ghl_create_booking | `f195a817-8346-475d-ad0e-8033f1d2e283` | yes | `https://hook.eu2.make.com/eop70ky2635nobauh7lyof13sctvl0ga` |
| ghl_check_availability | `6587bc7d-7382-4e33-a38d-95f5740df52a` | yes | `https://hook.eu2.make.com/3xslmou0jpbwxbutg8we362f9jsh96q0` |
| ghl_resolve_contact | `3e116e74-0dda-4277-ae38-468bdd3464e6` | yes | `https://hook.eu2.make.com/db3ws2lmqi4qh9ozsyt1tvn3j8tbeahm` |

**Knowledge base files**: `9fff4149-3aec-48f0-9378-d56760390216`

## Messages

- **firstMessage**: 

  > Hi there. I'm Rita, calling from Naidu Property Consulting Services. Am I speaking to {{fullName}} ?

- **endCallMessage**: 

  > Goodbye.

- **voicemailMessage**: 

  > Hi, this is Rita from Naidu Property Consulting Services, just a quick reminder about your upcoming discovery call. If you're unable to attend, please call us back on this number so we can schedule a new slot that works for you.

- **firstMessageMode**: `assistant-waits-for-user`
- **endCallPhrases**: —

## Behaviour

- **maxDurationSeconds**: `929`
- **backgroundSound**: `https://youtu.be/EK_LN3XEcnw?si=w86ZMR0qSR_yqiRl`

## System prompt

- `system` — 30,100 chars → [`prompts/e7eff72e1a361515.md`](../prompts/e7eff72e1a361515.md)

## Call history (counts only — no call content captured)

- **calls returned** (window of 100): 44
- **most recent**: 2026-01-07

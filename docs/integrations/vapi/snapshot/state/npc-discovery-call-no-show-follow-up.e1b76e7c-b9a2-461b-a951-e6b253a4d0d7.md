# NPC Discovery Call No Show Follow Up

`e1b76e7c-b9a2-461b-a951-e6b253a4d0d7` · org `c9015cd5-3701-4ac5-aa9c-be6cdcaaecdd` · created 2025-11-26 · updated 2026-07-22 05:50:56 · version `v1`

## Model

- **Provider / model**: openai · `gpt-5.2-chat-latest`
- **temperature**: `0.9`
- **maxTokens**: `10000`

## Voice

- **Provider / voice ID**: 11labs · `xgnMn9p1V1XVuxuyuuMC`
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
| end_call_tool | `bbbf6fb6-685d-411e-b0e1-bec5acc4fa8e` | yes | `—` |
| transfer_to_human | `5c0c334c-6bbf-4399-b748-a3c50207e754` | yes | `https://hook.eu2.make.com/jb85m14jchgktf09sfxt4jmf8yggaw32` |
| ghl_create_booking | `f195a817-8346-475d-ad0e-8033f1d2e283` | yes | `https://hook.eu2.make.com/eop70ky2635nobauh7lyof13sctvl0ga` |
| ghl_check_availability | `6587bc7d-7382-4e33-a38d-95f5740df52a` | yes | `https://hook.eu2.make.com/3xslmou0jpbwxbutg8we362f9jsh96q0` |
| ghl_resolve_contact | `3e116e74-0dda-4277-ae38-468bdd3464e6` | yes | `https://hook.eu2.make.com/db3ws2lmqi4qh9ozsyt1tvn3j8tbeahm` |

**Knowledge base files**: `9fff4149-3aec-48f0-9378-d56760390216`

## Messages

- **firstMessage**: 

  > Hi there. I'm Tina, calling from Naidu Property Consulting Services. Am I speaking to {{fullName}} ?

- **endCallMessage**: 

  > Goodbye.

- **voicemailMessage**: 

  > Hi, this is Tina from Naidu Property Consulting Services; we weren’t able to reach you for your discovery call earlier. If you'd like to book a new slot, feel free to call us back on this number and we'll find one that works for you.

- **firstMessageMode**: `assistant-waits-for-user`
- **endCallPhrases**: —

## Behaviour


## System prompt

- `system` — 34,672 chars → [`prompts/8853dbb50f69b9f1.md`](../prompts/8853dbb50f69b9f1.md)

## Call history (counts only — no call content captured)

- **calls returned** (window of 100): 60
- **most recent**: 2026-02-03

# NPC Quiz Follow Up

`72cebdc8-8ea2-4ed3-8ae5-bbbeb5fa782f` · org `c9015cd5-3701-4ac5-aa9c-be6cdcaaecdd` · created 2025-11-18 · updated 2026-07-22 05:49:31 · version `v1`

## Model

- **Provider / model**: openai · `gpt-5.2-chat-latest`
- **temperature**: `0.9`
- **maxTokens**: `10000`

## Voice

- **Provider / voice ID**: 11labs · `TcAStCk0faGcHdNIFX23`
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

  > Hi there. I'm Erica, calling from Naidu Property Consulting Services. Am I speaking to {{fullName}} ?

- **endCallMessage**: 

  > Goodbye.

- **voicemailMessage**: 

  > Hi, this is Erica from Naidu Property Consulting Services following up on the quiz you completed. Feel free to call us back on this number so we can book your complimentary discovery call.

- **firstMessageMode**: `assistant-waits-for-user`
- **endCallPhrases**: —

## Behaviour

- **maxDurationSeconds**: `929`

## System prompt

- `system` — 43,388 chars → [`prompts/7137db62edcf31e7.md`](../prompts/7137db62edcf31e7.md)

## Call history (counts only — no call content captured)

- **calls returned** (window of 100): 100 (capped — there are more)
- **most recent**: 2026-03-11

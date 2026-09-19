# NPC Opt In Follow Up

`b3acdd28-558a-4893-9cfe-c3abacdbe6bd` · org `c9015cd5-3701-4ac5-aa9c-be6cdcaaecdd` · created 2025-11-18 · updated 2026-08-18 18:03:28 · version `v2`

## Model

- **Provider / model**: openai · `gpt-5.6-luna`
- **maxTokens**: `10000`

## Voice

- **Provider / voice ID**: 11labs · `cJi4iYb9fQ8QIRKkX8Fd`
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

  > Hi there. I'm Monica, calling from Naidu Property Consulting Services. Am I speaking to {{fullName}} ?

- **endCallMessage**: 

  > Goodbye.

- **voicemailMessage**: 

  > Hi, this is Monica from Naidu Property Consulting Services calling because you recently submitted a form on Facebook to book a discovery call. Feel free to call us back on this number so we can arrange that for you.

- **firstMessageMode**: `assistant-waits-for-user`
- **endCallPhrases**: —

## Behaviour

- **maxDurationSeconds**: `929`
- **backgroundSound**: `office`

## System prompt

- `system` — 36,698 chars → [`prompts/8ec1d1a040db24f7.md`](../prompts/8ec1d1a040db24f7.md)

## Call history (counts only — no call content captured)

- **calls returned** (window of 100): 100 (capped — there are more)
- **most recent**: 2026-05-21

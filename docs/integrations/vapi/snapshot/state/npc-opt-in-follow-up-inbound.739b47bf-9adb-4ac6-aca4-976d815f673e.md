# NPC Opt In Follow Up Inbound

`739b47bf-9adb-4ac6-aca4-976d815f673e` · org `c9015cd5-3701-4ac5-aa9c-be6cdcaaecdd` · created 2025-12-15 · updated 2026-07-28 05:34:11 · version `v1`

## Model

- **Provider / model**: openai · `gpt-5.6-luna`

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
| ghl_resolve_contact | `3e116e74-0dda-4277-ae38-468bdd3464e6` | yes | `https://hook.eu2.make.com/db3ws2lmqi4qh9ozsyt1tvn3j8tbeahm` |
| ghl_check_availability | `6587bc7d-7382-4e33-a38d-95f5740df52a` | yes | `https://hook.eu2.make.com/3xslmou0jpbwxbutg8we362f9jsh96q0` |
| ghl_create_booking | `f195a817-8346-475d-ad0e-8033f1d2e283` | yes | `https://hook.eu2.make.com/eop70ky2635nobauh7lyof13sctvl0ga` |
| transfer_to_human | `5c0c334c-6bbf-4399-b748-a3c50207e754` | yes | `https://hook.eu2.make.com/jb85m14jchgktf09sfxt4jmf8yggaw32` |

**Knowledge base files**: `b3b1fdd2-8784-48af-aa1a-cc20740b72ff`

## Messages

- **firstMessage**: 

  > Hi {{firstName}}. I'm Monica, from Naidu Property Consulting Services. How can I help you today?

- **endCallMessage**: 

  > Goodbye.

- **voicemailMessage**: 

  > Hi, this is Monica from Naidu Property Consulting Services calling because you recently submitted a form on Facebook to book a discovery call. Feel free to call us back on this number so we can arrange that for you.

- **firstMessageMode**: `assistant-speaks-first`
- **endCallPhrases**: —

## Behaviour

- **maxDurationSeconds**: `1444`
- **backgroundSound**: `office`

## System prompt

- `system` — 44,426 chars → [`prompts/fa048ebb37a17a1b.md`](../prompts/fa048ebb37a17a1b.md)

## Call history (counts only — no call content captured)

- **calls returned** (window of 100): 0
- **most recent**: never called

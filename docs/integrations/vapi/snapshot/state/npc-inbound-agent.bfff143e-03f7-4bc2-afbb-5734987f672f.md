# NPC Inbound Agent

`bfff143e-03f7-4bc2-afbb-5734987f672f` · org `c9015cd5-3701-4ac5-aa9c-be6cdcaaecdd` · created 2025-12-09 · updated 2026-08-18 17:28:37 · version `v3`

## Model

- **Provider / model**: openai · `gpt-5.6-luna`

## Voice

- **Provider / voice ID**: 11labs · `M7ya1YbaeFaPXljg9BpK`
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
| phoneNumber_inject | `9789b720-ee13-4389-ba33-678883eaa891` | yes | `https://hook.eu2.make.com/2ubukyatwc0ig8zinphjjc4dciwhigqg` |
| get_call_context | `0bd36de8-6d3a-43e5-9c3f-25ca6de97662` | yes | `https://hook.eu2.make.com/o51u3jb5g1nn1lxiluziezpr7gh5vvt8` |
| transfer_to_human | `5c0c334c-6bbf-4399-b748-a3c50207e754` | yes | `https://hook.eu2.make.com/jb85m14jchgktf09sfxt4jmf8yggaw32` |

**Knowledge base files**: `9fff4149-3aec-48f0-9378-d56760390216`

## Messages

- **firstMessage**: 

  > Hi there. Angela from Naidu Property Consulting Services speaking. How can I help you today?

- **endCallMessage**: 

  > Goodbye.

- **voicemailMessage**: 

  > Please call back when you're available.

- **firstMessageMode**: `—`
- **endCallPhrases**: —

## Behaviour

- **maxDurationSeconds**: `16562`

## System prompt

- `system` — 43,970 chars → [`prompts/990ad3462f25e212.md`](../prompts/990ad3462f25e212.md)

## Call history (counts only — no call content captured)

- **calls returned** (window of 100): 37
- **most recent**: 2025-12-15

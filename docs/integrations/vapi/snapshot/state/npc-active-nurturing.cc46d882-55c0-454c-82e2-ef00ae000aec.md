# NPC Active Nurturing

`cc46d882-55c0-454c-82e2-ef00ae000aec` · org `c9015cd5-3701-4ac5-aa9c-be6cdcaaecdd` · created 2025-12-09 · updated 2026-08-18 17:29:07 · version `v3`

## Model

- **Provider / model**: openai · `gpt-5.2-chat-latest`

## Voice

- **Provider / voice ID**: 11labs · `cgSgspJ2msm6clMCkdW9`
- **model**: `eleven_flash_v2_5`
- **stability**: `0.5`
- **similarityBoost**: `0.75`

## Transcriber

- **Provider / model**: deepgram · `flux-general-en` · language `en`

## Server

- **URL**: `https://dduzbchuswwbefdunfct.supabase.co/functions/v1/vapi-call-webhook`
- **Timeout**: 20s · **header names**: `x-vapi-webhook-secret`
- **Server URL secret set**: no
- **serverMessages**: end-of-call-report
- **clientMessages**: conversation-update, function-call, hang, model-output, speech-update, status-update, transfer-update, transcript, tool-calls, user-interrupted, voice-input, workflow.node.started, assistant.started, metadata

## Tools

| Tool | ID | Resolves | Server URL |
| --- | --- | --- | --- |
| transfer_to_human | `5c0c334c-6bbf-4399-b748-a3c50207e754` | yes | `https://hook.eu2.make.com/jb85m14jchgktf09sfxt4jmf8yggaw32` |
| ghl_create_booking | `f195a817-8346-475d-ad0e-8033f1d2e283` | yes | `https://hook.eu2.make.com/eop70ky2635nobauh7lyof13sctvl0ga` |
| ghl_check_availability | `6587bc7d-7382-4e33-a38d-95f5740df52a` | yes | `https://hook.eu2.make.com/3xslmou0jpbwxbutg8we362f9jsh96q0` |
| ghl_resolve_contact | `3e116e74-0dda-4277-ae38-468bdd3464e6` | yes | `https://hook.eu2.make.com/db3ws2lmqi4qh9ozsyt1tvn3j8tbeahm` |
| end_call_tool | `bbbf6fb6-685d-411e-b0e1-bec5acc4fa8e` | yes | `—` |

**Knowledge base files**: `b3b1fdd2-8784-48af-aa1a-cc20740b72ff`

## Messages

- **firstMessage**: 

  > Hi there. I'm Mary, calling from Naidu Property Consulting Services. Am I speaking to {{fullName}} ?

- **endCallMessage**: 

  > Goodbye.

- **voicemailMessage**: 

  > Hi, this is Mary calling from Naidu Property Consulting Services. I was just reaching out to check in, as you’d looked into property strategy with us some time ago. There’s no urgency at all — I simply wanted to see if this is still something you’d like to explore, or if you’d prefer to leave it for now. Feel free to call us back on this number so we can arrange that for you.

- **firstMessageMode**: `assistant-waits-for-user`
- **endCallPhrases**: —

## Behaviour

- **backgroundDenoisingEnabled**: `True`

## System prompt

- `system` — 37,089 chars → [`prompts/a70200392b91d1e5.md`](../prompts/a70200392b91d1e5.md)

## Call history (counts only — no call content captured)

- **calls returned** (window of 100): 16
- **most recent**: 2026-05-14

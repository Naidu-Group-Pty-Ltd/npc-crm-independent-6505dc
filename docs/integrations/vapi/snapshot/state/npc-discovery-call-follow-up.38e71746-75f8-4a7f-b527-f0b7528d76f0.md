# NPC Discovery Call Follow Up

`38e71746-75f8-4a7f-b527-f0b7528d76f0` · org `c9015cd5-3701-4ac5-aa9c-be6cdcaaecdd` · created 2025-07-10 · updated 2025-11-26 06:56:48 · version `v1`

## Model

- **Provider / model**: openai · `gpt-5.1-chat-latest`
- **temperature**: `0.9`
- **maxTokens**: `450`

## Voice

- **Provider / voice ID**: 11labs · `jBzLvP03992lMFEkj2kJ`
- **model**: `eleven_turbo_v2_5`
- **stability**: `0.5`
- **similarityBoost**: `0.75`

## Transcriber

- **Provider / model**: deepgram · `nova-2` · language `en`

## Server

- **URL**: `https://hook.eu2.make.com/xoktvkk0wxyj8weopjeiqrqd914ad1jg`
- **Timeout**: 20s · **header names**: —
- **Server URL secret set**: no
- **serverMessages**: conversation-update, end-of-call-report, function-call, hang, speech-update, status-update, tool-calls, transfer-destination-request, user-interrupted
- **clientMessages**: conversation-update, function-call, hang, model-output, speech-update, status-update, transfer-update, transcript, tool-calls, user-interrupted, voice-input, workflow.node.started

## Tools

| Tool | ID | Resolves | Server URL |
| --- | --- | --- | --- |
| **MISSING** | `4d3ab4a4-2662-4b5a-9089-068faf7a2b00` | **404** | `—` |
| **MISSING** | `4aa1a306-b057-4b0a-bcc0-f38749637ee0` | **404** | `—` |
| **MISSING** | `199be122-72f1-4bbb-ada3-aedba74b59b1` | **404** | `—` |
| ghl_delete_event_npc | `5934c762-0223-4112-bfb7-88931da17652` | yes | `https://hook.eu2.make.com/9inh27jwcxodgecrbwvjosx7i5xedm67` |

**Knowledge base files**: —

## Messages

- **firstMessage**: 

  > Hi there. I'm Rita, calling from Naidu Property Consulting Services. Am I speaking to {{fullName}} ?

- **endCallMessage**: 

  > Perfect! Your appointment has been scheduled. You'll receive a confirmation email shortly. Have a great day!

- **voicemailMessage**: 

  > Hello, this is Riley from Wellness Partners. I'm calling about your appointment. Please call us back at your earliest convenience so we can confirm your scheduling details.

- **firstMessageMode**: `assistant-waits-for-user`
- **endCallPhrases**: —

## Behaviour

- **hipaaEnabled**: `False`
- **backgroundSound**: `office`
- **backgroundDenoisingEnabled**: `False`
- **endCallFunctionEnabled**: `True`

## System prompt

- `system` — 16,725 chars → [`prompts/086601c9de2e8026.md`](../prompts/086601c9de2e8026.md)

## Call history (counts only — no call content captured)

- **calls returned** (window of 100): 70
- **most recent**: 2026-01-07

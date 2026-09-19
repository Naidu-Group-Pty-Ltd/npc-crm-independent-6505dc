# NPC Discovery Call Follow Up Test 2

`c0bc54fd-a9fb-4970-822b-b471c198e43b` · org `c9015cd5-3701-4ac5-aa9c-be6cdcaaecdd` · created 2026-01-07 · updated 2026-03-04 08:07:50 · version `v1`

## Model

- **Provider / model**: openai · `gpt-5.2-chat-latest`
- **temperature**: `0.9`
- **maxTokens**: `450`

## Voice

- **Provider / voice ID**: 11labs · `jBzLvP03992lMFEkj2kJ`
- **model**: `eleven_flash_v2_5`
- **stability**: `0.5`
- **similarityBoost**: `0.75`

## Transcriber

- **Provider / model**: deepgram · `flux-general-en` · language `en`

## Server

- **URL**: `(none set)`
- **Timeout**: —s · **header names**: —
- **Server URL secret set**: no
- **serverMessages**: —
- **clientMessages**: —

## Tools

| Tool | ID | Resolves | Server URL |
| --- | --- | --- | --- |
| end_call_tool | `bbbf6fb6-685d-411e-b0e1-bec5acc4fa8e` | yes | `—` |
| **MISSING** | `4d3ab4a4-2662-4b5a-9089-068faf7a2b00` | **404** | `—` |
| **MISSING** | `199be122-72f1-4bbb-ada3-aedba74b59b1` | **404** | `—` |
| **MISSING** | `4aa1a306-b057-4b0a-bcc0-f38749637ee0` | **404** | `—` |
| ghl_delete_event_npc | `5934c762-0223-4112-bfb7-88931da17652` | yes | `https://hook.eu2.make.com/9inh27jwcxodgecrbwvjosx7i5xedm67` |

**Knowledge base files**: `b3b1fdd2-8784-48af-aa1a-cc20740b72ff`

## Messages

- **firstMessage**: 

  > Hi there. I'm Rita, calling from Naidu Property Consulting Services. Am I speaking to {{fullName}} ?

- **endCallMessage**: 

  > Goodbye.

- **voicemailMessage**: 

  > Please call back when you're available.

- **firstMessageMode**: `assistant-waits-for-user`
- **endCallPhrases**: —

## Behaviour

- **maxDurationSeconds**: `929`

## System prompt

- `system` — 29,284 chars → [`prompts/ed3d59115281981f.md`](../prompts/ed3d59115281981f.md)

## Call history (counts only — no call content captured)

- **calls returned** (window of 100): 80
- **most recent**: 2026-03-09

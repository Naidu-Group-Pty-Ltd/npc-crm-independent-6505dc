# Xenochrome Assistant

`1f907ea6-adc6-41c4-accc-9ae3cd0739ab` · org `c9015cd5-3701-4ac5-aa9c-be6cdcaaecdd` · created 2024-07-16 · updated 2025-05-20 13:53:21 · version `v1`

## Model

- **Provider / model**: openai · `gpt-4.1`
- **temperature**: `0.7`
- **maxTokens**: `1000`
- **emotionRecognitionEnabled**: `True`

## Voice

- **Provider / voice ID**: 11labs · `nWxiGsP4eBrWk3QtVY6K`
- **model**: `eleven_turbo_v2_5`
- **stability**: `0.5`
- **similarityBoost**: `0.75`

## Transcriber

- **Provider / model**: deepgram · `nova-2` · language `en`

## Server

- **URL**: `https://na-gcp-api.vg-stuff.com/v2/agents/NE4wWwtA5BGy5Cm/vapi-event`
- **Timeout**: —s · **header names**: —
- **Server URL secret set**: no
- **serverMessages**: end-of-call-report, status-update, hang, function-call, conversation-update
- **clientMessages**: transcript, hang, function-call, speech-update, metadata, conversation-update

## Tools

| Tool | ID | Resolves | Server URL |
| --- | --- | --- | --- |
| checkAvailability | `326c7c81-e4c2-4bcb-bcf3-134a1af73f49` | yes | `https://hook.eu2.make.com/9hr5vgh78dqq4sl19lpgsfji716rtu1o` |

**Knowledge base files**: —

## Messages

- **firstMessage**: 

  > Hi there! My name is Khan. I'm a virtual assistant at Xenochrome Technologies. How can I help you today?

- **endCallMessage**: —
- **voicemailMessage**: —
- **firstMessageMode**: `—`
- **endCallPhrases**: —

## Behaviour

- **hipaaEnabled**: `False`
- **backgroundDenoisingEnabled**: `False`
- **backchannelingEnabled**: `False`
- **endCallFunctionEnabled**: `True`

## System prompt

- `system` — 4,816 chars → [`prompts/feb9196375b98c44.md`](../prompts/feb9196375b98c44.md)

## Call history (counts only — no call content captured)

- **calls returned** (window of 100): 100 (capped — there are more)
- **most recent**: 2025-12-17

# JG Facilities Management

`54df9863-2f00-4504-b25f-8f3b3881523a` · org `c9015cd5-3701-4ac5-aa9c-be6cdcaaecdd` · created 2025-02-02 · updated 2025-04-26 15:14:54 · version `v1`

## Model

- **Provider / model**: openai · `gpt-4o-mini`
- **temperature**: `0.7`
- **emotionRecognitionEnabled**: `True`

## Voice

- **Provider / voice ID**: 11labs · `2zRM7PkgwBPiau2jvVXc`
- **model**: `eleven_turbo_v2_5`
- **stability**: `0.5`
- **similarityBoost**: `0.75`

## Transcriber

- **Provider / model**: deepgram · `nova-2` · language `en`

## Server

- **URL**: `https://na-gcp-api.vg-stuff.com/v2/agents/ye77v6945104xe1y/vapi-event`
- **Timeout**: —s · **header names**: —
- **Server URL secret set**: yes
- **serverMessages**: end-of-call-report, status-update, hang, function-call, conversation-update
- **clientMessages**: transcript, hang, function-call, speech-update, metadata, conversation-update

## Tools

_none_

**Knowledge base files**: —

## Messages

- **firstMessage**: 

  > Hi, this is Nisha speaking, how can I help you today?

- **endCallMessage**: —
- **voicemailMessage**: —
- **firstMessageMode**: `—`
- **endCallPhrases**: —

## Behaviour

- **silenceTimeoutSeconds**: `14`
- **backgroundDenoisingEnabled**: `False`
- **backchannelingEnabled**: `False`

## System prompt

- `system` — 4,300 chars → [`prompts/9b9d69174a8977b3.md`](../prompts/9b9d69174a8977b3.md)

## Call history (counts only — no call content captured)

- **calls returned** (window of 100): 14
- **most recent**: 2025-02-03

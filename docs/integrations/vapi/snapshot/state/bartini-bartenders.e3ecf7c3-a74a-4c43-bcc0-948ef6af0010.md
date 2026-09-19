# Bartini Bartenders

`e3ecf7c3-a74a-4c43-bcc0-948ef6af0010` · org `c9015cd5-3701-4ac5-aa9c-be6cdcaaecdd` · created 2024-09-25 · updated 2025-02-02 17:37:03 · version `v1`

## Model

- **Provider / model**: openai · `gpt-4o`
- **temperature**: `0.7`
- **emotionRecognitionEnabled**: `True`

## Voice

- **Provider / voice ID**: 11labs · `mActWQg9kibLro6Z2ouY`
- **model**: `eleven_turbo_v2_5`
- **stability**: `0.5`
- **similarityBoost**: `0.75`

## Transcriber

- **Provider / model**: deepgram · `nova-2` · language `en`

## Server

- **URL**: `https://na-runtime.voiceglow.org/v2/agents/h23l1g4pwl3pmlht/vapi-event`
- **Timeout**: —s · **header names**: —
- **Server URL secret set**: yes
- **serverMessages**: end-of-call-report, status-update, hang, function-call, conversation-update
- **clientMessages**: transcript, hang, function-call, speech-update, metadata, conversation-update

## Tools

_none_

**Knowledge base files**: —

## Messages

- **firstMessage**: 

  > Hi, I am your virtual assistant, how can I help you today?

- **endCallMessage**: —
- **voicemailMessage**: —
- **firstMessageMode**: `—`
- **endCallPhrases**: —

## Behaviour

- **silenceTimeoutSeconds**: `14`
- **backgroundDenoisingEnabled**: `False`
- **backchannelingEnabled**: `False`

## System prompt

- `system` — 3,673 chars → [`prompts/5c687dca51331ee3.md`](../prompts/5c687dca51331ee3.md)

## Call history (counts only — no call content captured)

- **calls returned** (window of 100): 50
- **most recent**: 2024-11-05

# Mandy

`aacc0bb6-1761-4571-9216-bd751ecce218` · org `c9015cd5-3701-4ac5-aa9c-be6cdcaaecdd` · created 2024-07-22 · updated 2024-07-22 21:20:18 · version `v1`

## Model

- **Provider / model**: openai · `gpt-4o`
- **temperature**: `1`
- **maxTokens**: `500`
- **emotionRecognitionEnabled**: `True`

## Voice

- **Provider / voice ID**: 11labs · `pZOOamJ2G2xHhyr7HQ85`
- **model**: `eleven_turbo_v2_5`
- **stability**: `0.6`
- **similarityBoost**: `0.75`
- **style**: `0.2`
- **optimizeStreamingLatency**: `1`

## Transcriber

- **Provider / model**: deepgram · `nova-2` · language `zh-CN`

## Server

- **URL**: `(none set)`
- **Timeout**: —s · **header names**: —
- **Server URL secret set**: no
- **serverMessages**: end-of-call-report, status-update, hang, function-call
- **clientMessages**: transcript, hang, function-call, speech-update, metadata, conversation-update

## Tools

_none_

**Knowledge base files**: —

## Messages

- **firstMessage**: 

  > 大家好，我是来自 Sham 牙科诊所的 Mandy。今天我能为您提供什么帮助？

- **endCallMessage**: 

  > Thank you for contacting Mary's Dental. Have a great day!

- **voicemailMessage**: 

  > You've reached Mary's Dental voicemail. Please leave a message after the beep, and we'll get back to you as soon as possible.

- **firstMessageMode**: `—`
- **endCallPhrases**: `goodbye`, `talk to you soon`

## Behaviour

- **recordingEnabled**: `True`
- **hipaaEnabled**: `False`
- **backgroundSound**: `office`
- **backgroundDenoisingEnabled**: `True`
- **backchannelingEnabled**: `True`
- **endCallFunctionEnabled**: `True`
- **dialKeypadFunctionEnabled**: `False`
- **voicemailDetectionEnabled**: `False`

## System prompt

- `system` — 4,593 chars → [`prompts/329cc3d9aad74f19.md`](../prompts/329cc3d9aad74f19.md)

## Call history (counts only — no call content captured)

- **calls returned** (window of 100): 5
- **most recent**: 2024-07-29

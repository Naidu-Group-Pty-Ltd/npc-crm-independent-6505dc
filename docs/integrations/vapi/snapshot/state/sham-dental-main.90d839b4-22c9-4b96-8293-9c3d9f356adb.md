# Sham Dental Main

`90d839b4-22c9-4b96-8293-9c3d9f356adb` · org `c9015cd5-3701-4ac5-aa9c-be6cdcaaecdd` · created 2024-07-22 · updated 2024-07-22 20:19:23 · version `v1`

## Model

- **Provider / model**: openai · `gpt-4o`
- **temperature**: `1`
- **maxTokens**: `500`
- **emotionRecognitionEnabled**: `True`

## Voice

- **Provider / voice ID**: 11labs · `2zRM7PkgwBPiau2jvVXc`
- **model**: `eleven_turbo_v2_5`
- **stability**: `0.6`
- **similarityBoost**: `0.75`
- **style**: `0.2`
- **optimizeStreamingLatency**: `1`

## Transcriber

- **Provider / model**: deepgram · `nova-2` · language `en`

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

  > Welcome to Sham's Dental Clinic. Please select your preferred language. English, Malay, Chinese or Tamil.

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
- **endCallFunctionEnabled**: `False`
- **dialKeypadFunctionEnabled**: `False`
- **voicemailDetectionEnabled**: `False`

## System prompt

- `system` — 2,222 chars → [`prompts/25c1ec9b85fe5650.md`](../prompts/25c1ec9b85fe5650.md)

## Call history (counts only — no call content captured)

- **calls returned** (window of 100): 0
- **most recent**: never called

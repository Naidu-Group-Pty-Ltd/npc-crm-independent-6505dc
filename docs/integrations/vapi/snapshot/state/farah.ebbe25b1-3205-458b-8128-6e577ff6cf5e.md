# Farah

`ebbe25b1-3205-458b-8128-6e577ff6cf5e` · org `c9015cd5-3701-4ac5-aa9c-be6cdcaaecdd` · created 2024-07-22 · updated 2024-07-24 12:14:53 · version `v1`

## Model

- **Provider / model**: openai · `gpt-4o`
- **temperature**: `1`
- **maxTokens**: `500`
- **emotionRecognitionEnabled**: `True`

## Voice

- **Provider / voice ID**: 11labs · `q6bboItSc3laqmM0fge1`
- **model**: `eleven_turbo_v2_5`
- **stability**: `0.6`
- **similarityBoost**: `0.75`
- **style**: `0.2`
- **optimizeStreamingLatency**: `1`

## Transcriber

- **Provider / model**: deepgram · `nova-2` · language `ms`

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

  > Hello, ini Farah dari Klinik Pergigian Sham. Bagaimanakah saya boleh membantu anda hari ini?

- **endCallMessage**: 

  > Thank you for contacting Mary's Dental. Have a great day!

- **voicemailMessage**: 

  > You've reached Mary's Dental voicemail. Please leave a message after the beep, and we'll get back to you as soon as possible.

- **firstMessageMode**: `—`
- **endCallPhrases**: —

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

- `system` — 4,637 chars → [`prompts/567ebe4509ea53a9.md`](../prompts/567ebe4509ea53a9.md)

## Call history (counts only — no call content captured)

- **calls returned** (window of 100): 7
- **most recent**: 2024-07-29

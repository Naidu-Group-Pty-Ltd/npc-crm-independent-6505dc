# Aishu

`aa1a4037-720f-4bf4-b9c1-9826647a59b2` · org `c9015cd5-3701-4ac5-aa9c-be6cdcaaecdd` · created 2024-05-03 · updated 2025-06-20 16:26:19 · version `v1`

## Model

- **Provider / model**: openai · `gpt-4.1`
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

- **URL**: `https://na-runtime.voiceglow.org/v2/agents/r0x0zyb31z7qsimc/vapi-event`
- **Timeout**: 20s · **header names**: —
- **Server URL secret set**: yes
- **serverMessages**: end-of-call-report, status-update, hang, function-call, conversation-update
- **clientMessages**: transcript, hang, function-call, speech-update, metadata, conversation-update

## Tools

_none_

**Knowledge base files**: —

## Messages

- **firstMessage**: 

  > Hello, this is Aishu from Sham's Dental Clinic. How can I assist you today?

- **endCallMessage**: 

  > Thank you for contacting Sham's Dental. Have a great day!

- **voicemailMessage**: 

  > You've reached Mary's Dental voicemail. Please leave a message after the beep, and we'll get back to you as soon as possible.

- **firstMessageMode**: `—`
- **endCallPhrases**: —

## Behaviour

- **silenceTimeoutSeconds**: `16`
- **recordingEnabled**: `True`
- **hipaaEnabled**: `False`
- **backgroundSound**: `office`
- **backgroundDenoisingEnabled**: `True`
- **backchannelingEnabled**: `True`
- **endCallFunctionEnabled**: `True`
- **dialKeypadFunctionEnabled**: `False`
- **voicemailDetectionEnabled**: `False`

## System prompt

- `system` — 4,576 chars → [`prompts/45f0c848af754408.md`](../prompts/45f0c848af754408.md)

## Call history (counts only — no call content captured)

- **calls returned** (window of 100): 100 (capped — there are more)
- **most recent**: 2025-06-07

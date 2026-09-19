# Raya

`7beabed3-6bbb-430d-8648-29718e9cd647` · org `c9015cd5-3701-4ac5-aa9c-be6cdcaaecdd` · created 2024-04-29 · updated 2024-07-22 22:34:12 · version `v1`

## Model

- **Provider / model**: openai · `gpt-3.5-turbo`
- **temperature**: `0.7`
- **maxTokens**: `400`

## Voice

- **Provider / voice ID**: 11labs · `5Bjl83PFj5Nlg71jt4oW`
- **stability**: `0.5`
- **similarityBoost**: `0.75`

## Transcriber

- **Provider / model**: deepgram · `nova-2` · language `en`

## Server

- **URL**: `https://na-runtime.voiceglow.org/v2/agents/6ebv93sfgm2pdcvx/vapi-event`
- **Timeout**: —s · **header names**: —
- **Server URL secret set**: yes
- **serverMessages**: end-of-call-report, status-update, hang, function-call, conversation-update
- **clientMessages**: transcript, hang, function-call, speech-update, metadata, conversation-update

## Tools

_none_

**Knowledge base files**: —

## Messages

- **firstMessage**: 

  > Hi there! I'm Raya, your go-to for any queries regarding AutoFlow. How can I assist you today?

- **endCallMessage**: 

  > Thanks for reaching out to us. It was great assisting you. Have a wonderful day!

- **voicemailMessage**: 

  > Hi, you've reached Leo at SmartHome Innovations. Sorry I missed your call. Please leave a message, and I'll get back to you as soon as possible.

- **firstMessageMode**: `—`
- **endCallPhrases**: `bye for now`, `talk soon`

## Behaviour

- **recordingEnabled**: `True`
- **hipaaEnabled**: `False`
- **backgroundSound**: `office`
- **endCallFunctionEnabled**: `False`
- **dialKeypadFunctionEnabled**: `False`
- **voicemailDetectionEnabled**: `False`

## System prompt

- `system` — 21,970 chars → [`prompts/85336f75206b160d.md`](../prompts/85336f75206b160d.md)

## Call history (counts only — no call content captured)

- **calls returned** (window of 100): 20
- **most recent**: 2025-06-07

# `transfer_to_human` — prose

Everything in this tool that an LLM reads when deciding whether and how to call it, plus everything the tool sends and reads back. Extracted from the committed JSON; nothing added.

`3a6a892d-2907-4da0-b2f8-a55d5b404a84` · type `transferCall`

## Description

Trigger this tool when a caller asks to speak to a human/real person

## Parameters (what the model fills in)

_none_

## Static body fields (sent on every call, the model does not choose these)

_none_

## Variable extraction (what comes back out of the response)

_none — nothing from the response is bound to a variable_

## Spoken messages

**request-start** (blocking=False)

> _empty — the caller hears nothing_

## Transfer destinations

- **number** `+61433005110` · callerId `+61286093299`
  - spoken: > Got it — I’ll connect you with a team member now.
  - plan `warm-transfer-twiml` · sipVerb `refer`
  - twiml: `<Say>Hi, this is NPC Services. A caller has asked to speak with a team member. You will be connected now.</Say>`
  - numberE164CheckEnabled: `True`

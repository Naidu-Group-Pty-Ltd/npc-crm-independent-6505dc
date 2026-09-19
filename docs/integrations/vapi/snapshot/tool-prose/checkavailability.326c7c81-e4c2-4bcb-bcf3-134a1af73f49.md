# `checkAvailability` — prose

Everything in this tool that an LLM reads when deciding whether and how to call it, plus everything the tool sends and reads back. Extracted from the committed JSON; nothing added.

`326c7c81-e4c2-4bcb-bcf3-134a1af73f49` · type `function`

## Description

Check the availability on the business calendar for a requested time by the customer. If all the slots are available, respond by saying we're available all day. If there are busy slots, make sure the requested time slot is available. If not, suggest alternative slots.

## Parameters (what the model fills in)

### `times` — `string`

Requested time for appointment booking

## Static body fields (sent on every call, the model does not choose these)

_none_

## Variable extraction (what comes back out of the response)

_none — nothing from the response is bound to a variable_

## Spoken messages

_none_


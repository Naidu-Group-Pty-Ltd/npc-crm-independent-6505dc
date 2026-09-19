# `get_contact_airtable_test` — prose

Everything in this tool that an LLM reads when deciding whether and how to call it, plus everything the tool sends and reads back. Extracted from the committed JSON; nothing added.

`11317eb2-1b44-4e9e-ae7f-e6baaee0d77b` · type `function`

## Description

Extract lead data such as full name, phone number, discovery call time

## Parameters (what the model fills in)

### `discovery_call_time` — `string` · default ``

_no description_

### `full_name` — `string` · default ``

Lead full name

### `phone_number` — `string` · default ``

_no description_

## Static body fields (sent on every call, the model does not choose these)

_none_

## Variable extraction (what comes back out of the response)

_none — nothing from the response is bound to a variable_

## Spoken messages

**request-start** (blocking=False)

> _empty — the caller hears nothing_


# `phoneNumber_inject` — prose

Everything in this tool that an LLM reads when deciding whether and how to call it, plus everything the tool sends and reads back. Extracted from the committed JSON; nothing added.

`9789b720-ee13-4389-ba33-678883eaa891` · type `function`

## Description

This tool should be fired only once when a caller asks to one of three calls (discovery call, strategy session, initial finance consult)

## Parameters (what the model fills in)

### `{{contactId}}` — `string` · **required** · default ``

_no description_

### `{{firstName}}` — `string` · **required** · default ``

_no description_

### `{{fullName}}` — `string` · **required** · default ``

_no description_

## Static body fields (sent on every call, the model does not choose these)

_none_

## Variable extraction (what comes back out of the response)

_none — nothing from the response is bound to a variable_

## Spoken messages

**request-start** (blocking=False)

> _empty — the caller hears nothing_


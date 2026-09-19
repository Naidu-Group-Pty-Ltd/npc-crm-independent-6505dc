# `ghl_delete_event_npc` — prose

Everything in this tool that an LLM reads when deciding whether and how to call it, plus everything the tool sends and reads back. Extracted from the committed JSON; nothing added.

`5934c762-0223-4112-bfb7-88931da17652` · type `function`

## Description

This tool should be used to delete events through a separate automation by retrieving the contact name and existing booking time they made previously.

## Parameters (what the model fills in)

### `discoveryCallTime` — `string` · **required** · default ``

_no description_

### `fullName` — `string` · **required** · default ``

_no description_

**Strict schema**: `True`

## Static body fields (sent on every call, the model does not choose these)

_none_

## Variable extraction (what comes back out of the response)

_none — nothing from the response is bound to a variable_

## Spoken messages

**request-start** (blocking=False)

> _empty — the caller hears nothing_


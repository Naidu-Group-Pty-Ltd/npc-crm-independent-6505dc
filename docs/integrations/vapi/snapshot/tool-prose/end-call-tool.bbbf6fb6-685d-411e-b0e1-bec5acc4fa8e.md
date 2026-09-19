# `end_call_tool` — prose

Everything in this tool that an LLM reads when deciding whether and how to call it, plus everything the tool sends and reads back. Extracted from the committed JSON; nothing added.

`bbbf6fb6-685d-411e-b0e1-bec5acc4fa8e` · type `endCall`

## Description

This tool should be called only after the agent has completed the closing sequence 
and said goodbye to the caller.

## Parameters (what the model fills in)

_none_

## Static body fields (sent on every call, the model does not choose these)

_none_

## Variable extraction (what comes back out of the response)

_none — nothing from the response is bound to a variable_

## Spoken messages

**request-start** (blocking=True)

> _empty — the caller hears nothing_


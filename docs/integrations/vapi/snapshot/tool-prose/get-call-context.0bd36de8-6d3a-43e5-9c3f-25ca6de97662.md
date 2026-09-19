# `get_call_context` — prose

Everything in this tool that an LLM reads when deciding whether and how to call it, plus everything the tool sends and reads back. Extracted from the committed JSON; nothing added.

`0bd36de8-6d3a-43e5-9c3f-25ca6de97662` · type `function`

## Description

Retrieves the stored live call context for the current Vapi call from the external session store. Use this tool after contact resolution and at the start of downstream assistant flows to recover contactId, firstName, fullName, phone, contactState, confirmedIntent, and callerReason. This tool does not search GHL, create contacts, book calls, or update calendars.

## Parameters (what the model fills in)

_none_

## Static body fields (sent on every call, the model does not choose these)

| Key | Value |
| --- | --- |
| `vapiCallId` | `{{ call.id }}` |
| `callerPhone` | `{{ customer.number }}` |
| `phone` | `{{ customer.number }}` |

## Variable extraction (what comes back out of the response)

**Aliases**

| Variable | From response |
| --- | --- |
| `contextFound` | `{{ $.contextFound }}` |
| `contactId` | `{{ $.contactId }}` |
| `firstName` | `{{ $.firstName }}` |
| `fullName` | `{{ $.fullName }}` |
| `phone` | `{{ $.phone }}` |
| `callerPhone` | `{{ $.callerPhone }}` |
| `contactState` | `{{ $.contactState }}` |
| `contactFound` | `{{ $.contactFound }}` |
| `contactCreated` | `{{ $.contactCreated }}` |
| `confirmedIntent` | `{{ $.confirmedIntent }}` |
| `callerReason` | `{{ $.callerReason }}` |
| `handoffReady` | `{{ $.handoffReady }}` |
| `vapiCallId` | `{{ $.vapiCallId }}` |

## Spoken messages

**request-start** (blocking=False)

> _empty — the caller hears nothing_


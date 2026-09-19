# `phoneNumber_inject` — prose

Everything in this tool that an LLM reads when deciding whether and how to call it, plus everything the tool sends and reads back. Extracted from the committed JSON; nothing added.

`c40722f1-a359-42e1-ba80-e99ef706a916` · type `function`

## Description

Context bridge tool fired once before Angela hands off to a downstream assistant. This tool preserves resolved caller context such as contactId, firstName, fullName, phone, contactState, confirmedIntent, and callerReason. It must not search GHL, create contacts, book calls, or choose the downstream assistant by itself.

## Parameters (what the model fills in)

### `callerReason` — `string`

A short plain-English summary of why the caller is being handed off.

### `confirmedIntent` — `string` · **required** · enum: `discovery`, `strategy`, `finance`

The confirmed downstream pathway. Must be one of: discovery, strategy, or finance.

## Static body fields (sent on every call, the model does not choose these)

| Key | Value |
| --- | --- |
| `contactId` | `{{ contactId }}` |
| `firstName` | `{{ firstName }}` |
| `fullName` | `{{ fullName }}` |
| `phone` | `{{ phone }}` |
| `contactState` | `{{ contactState }}` |
| `callerPhone` | `{{ customer.number }}` |
| `vapiCallId` | `{{ call.id }}` |
| `callType` | `{{ call.type }}` |
| `ghlContactId` | `{{ ghlContactId }}` |
| `ghlFirstName` | `{{ ghlFirstName }}` |
| `ghlFullName` | `{{ ghlFullName }}` |
| `ghlContactPhone` | `{{ ghlContactPhone }}` |
| `ghlContactState` | `{{ ghlContactState }}` |

## Variable extraction (what comes back out of the response)

**Aliases**

| Variable | From response |
| --- | --- |
| `contactId` | `{{ $.contactId }}` |
| `firstName` | `{{ $.firstName }}` |
| `fullName` | `{{ $.fullName }}` |
| `phone` | `{{ $.phone }}` |
| `contactState` | `{{ $.contactState }}` |
| `confirmedIntent` | `{{ $.confirmedIntent }}` |
| `callerReason` | `{{ $.callerReason }}` |
| `handoffReady` | `{{ $.handoffReady }}` |
| `vapiCallId` | `{{ $.vapiCallId }}` |

## Spoken messages

**request-start** (blocking=False)

> _empty — the caller hears nothing_


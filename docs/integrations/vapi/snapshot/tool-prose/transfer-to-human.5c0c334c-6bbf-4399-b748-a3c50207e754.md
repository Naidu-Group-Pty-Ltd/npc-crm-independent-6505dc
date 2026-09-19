# `transfer_to_human` — prose

Everything in this tool that an LLM reads when deciding whether and how to call it, plus everything the tool sends and reads back. Extracted from the committed JSON; nothing added.

`5c0c334c-6bbf-4399-b748-a3c50207e754` · type `function`

## Description

Trigger this tool only when the caller clearly asks to speak to a human, real person, team member, manager, or live representative. This tool does not perform a native Vapi transfer. It calls Make.com, which redirects the active Twilio parent call to the human team member.

## Parameters (what the model fills in)

### `callerContext` — `string`

Brief context about the call so far, such as whether the caller wanted a discovery call, strategy session, initial finance consult, or had a support issue.

### `transferReason` — `string` · **required**

Short reason for the transfer request. Example: Caller asked to speak with a human team member.

## Static body fields (sent on every call, the model does not choose these)

| Key | Value |
| --- | --- |
| `callerPhone` | `{{ customer.number }}` |
| `customer_number` | `{{ customer.number }}` |
| `vapiCallId` | `{{ call.id }}` |
| `calledNumber` | `{{ phoneNumber.number }}` |
| `callType` | `{{ call.type }}` |

## Variable extraction (what comes back out of the response)

_none — nothing from the response is bound to a variable_

## Spoken messages

**request-start** (blocking=False)

> _empty — the caller hears nothing_

**request-failed** (endCallAfterSpokenEnabled=False)

> Sorry, I couldn’t connect you through right now. The team will still be able to help if you call back on this number.


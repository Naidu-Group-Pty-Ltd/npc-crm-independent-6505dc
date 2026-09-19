# transfer_to_human

`5c0c334c-6bbf-4399-b748-a3c50207e754` · type `function` · async `False` · version `v1`
· created 2026-05-20 · updated 2026-05-20 11:15:24
· org `c9015cd5-3701-4ac5-aa9c-be6cdcaaecdd`

## Server

- **URL**: `https://hook.eu2.make.com/jb85m14jchgktf09sfxt4jmf8yggaw32`
- **timeoutSeconds**: `20`
- **staticIpAddressesEnabled**: `False`
- **headers**: none
- **credential**: no authentication

## Function

- **name**: `transfer_to_human`
- **strict**: `—`
- **model-supplied parameters** (2): `callerContext`, `transferReason`
- **required**: `transferReason`
- **description**: 273 chars → [prose](../tool-prose/transfer-to-human.5c0c334c-6bbf-4399-b748-a3c50207e754.md)

## Static body fields

| Key | Value |
| --- | --- |
| `callerPhone` | `{{ customer.number }}` |
| `customer_number` | `{{ customer.number }}` |
| `vapiCallId` | `{{ call.id }}` |
| `calledNumber` | `{{ phoneNumber.number }}` |
| `callType` | `{{ call.type }}` |

## Variable extraction

_none_

## Messages

- `request-start`: (empty)
- `request-failed`: Sorry, I couldn’t connect you through right now. The team will still be able to help if you call back on this 

## Used by 13 assistant(s)

- NPC Active Nurturing
- NPC Discovery Call Follow Up Test
- NPC Discovery Call No Show Follow Up
- NPC IFC Follow Up
- NPC IFC Inbound
- NPC IFC No Show Follow Up
- NPC Inbound Agent
- NPC Opt In Follow Up
- NPC Opt In Follow Up Inbound
- NPC Quiz Follow Up
- NPC Strategy Session (Phone) Follow Up
- NPC Strategy Session (Phone) No Show
- NPC Strategy Session Inbound

# ghl_resolve_contact

`3e116e74-0dda-4277-ae38-468bdd3464e6` · type `function` · async `False` · version `v1`
· created 2026-05-11 · updated 2026-05-14 06:15:49
· org `c9015cd5-3701-4ac5-aa9c-be6cdcaaecdd`

## Server

- **URL**: `https://hook.eu2.make.com/db3ws2lmqi4qh9ozsyt1tvn3j8tbeahm`
- **timeoutSeconds**: `20`
- **staticIpAddressesEnabled**: `False`
- **headers**: none
- **credential**: no authentication

## Function

- **name**: `ghl_resolve_contact`
- **strict**: `—`
- **model-supplied parameters** (3): `first_name`, `full_name`, `last_name`
- **required**: —
- **description**: 368 chars → [prose](../tool-prose/ghl-resolve-contact.3e116e74-0dda-4277-ae38-468bdd3464e6.md)

## Static body fields

| Key | Value |
| --- | --- |
| `phone` | `{{ customer.number }}` |
| `customer_number` | `{{ customer.number }}` |
| `called_number` | `{{ phoneNumber.number }}` |
| `vapi_call_id` | `{{ call.id }}` |
| `call_type` | `{{ call.type }}` |

## Variable extraction

| Variable | From response |
| --- | --- |
| `contactId` | `{{ $.contactId }}` |
| `firstName` | `{{ $.firstName }}` |
| `fullName` | `{{ $.fullName }}` |
| `phone` | `{{ $.phone }}` |
| `contactState` | `{{ $.contactState }}` |
| `contactFound` | `{{ $.contactFound }}` |
| `contactCreated` | `{{ $.contactCreated }}` |
| `requiresName` | `{{ $.requiresName }}` |
| `requiresPhone` | `{{ $.requiresPhone }}` |
| `ghlContactId` | `{{ $.contactId }}` |
| `ghlFirstName` | `{{ $.firstName }}` |
| `ghlFullName` | `{{ $.fullName }}` |
| `ghlContactPhone` | `{{ $.phone }}` |
| `ghlContactState` | `{{ $.contactState }}` |

- schema: `{"type": "object", "required": [], "properties": {}}`

## Messages

- `request-start`: (empty)

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

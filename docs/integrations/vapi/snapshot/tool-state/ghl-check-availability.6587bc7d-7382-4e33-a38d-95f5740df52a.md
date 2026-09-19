# ghl_check_availability

`6587bc7d-7382-4e33-a38d-95f5740df52a` · type `function` · async `None` · version `v1`
· created 2026-05-11 · updated 2026-05-14 16:50:42
· org `c9015cd5-3701-4ac5-aa9c-be6cdcaaecdd`

## Server

- **URL**: `https://hook.eu2.make.com/3xslmou0jpbwxbutg8we362f9jsh96q0`
- **timeoutSeconds**: `20`
- **staticIpAddressesEnabled**: `False`
- **headers**: none
- **credential**: no authentication

## Function

- **name**: `ghl_check_availability`
- **strict**: `—`
- **model-supplied parameters** (8): `booking_intent_text`, `caller_context`, `duration_minutes`, `endDateMs`, `preferred_date_text`, `search_reason`, `startDateMs`, `timezone`
- **required**: `booking_intent_text`, `duration_minutes`, `endDateMs`, `startDateMs`, `timezone`
- **description**: 489 chars → [prose](../tool-prose/ghl-check-availability.6587bc7d-7382-4e33-a38d-95f5740df52a.md)

## Static body fields

_none_

## Variable extraction

- schema: `{"type": "object", "required": [], "properties": {}}`

## Messages

- `request-start`: Let me check the available times for you.

## Used by 12 assistant(s)

- NPC Active Nurturing
- NPC Discovery Call Follow Up Test
- NPC Discovery Call No Show Follow Up
- NPC IFC Follow Up
- NPC IFC Inbound
- NPC IFC No Show Follow Up
- NPC Opt In Follow Up
- NPC Opt In Follow Up Inbound
- NPC Quiz Follow Up
- NPC Strategy Session (Phone) Follow Up
- NPC Strategy Session (Phone) No Show
- NPC Strategy Session Inbound

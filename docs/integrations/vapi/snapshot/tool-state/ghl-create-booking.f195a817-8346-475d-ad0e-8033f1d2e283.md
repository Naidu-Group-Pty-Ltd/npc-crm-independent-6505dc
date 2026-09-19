# ghl_create_booking

`f195a817-8346-475d-ad0e-8033f1d2e283` · type `function` · async `False` · version `v1`
· created 2026-05-12 · updated 2026-05-14 17:53:57
· org `c9015cd5-3701-4ac5-aa9c-be6cdcaaecdd`

## Server

- **URL**: `https://hook.eu2.make.com/eop70ky2635nobauh7lyof13sctvl0ga`
- **timeoutSeconds**: `20`
- **staticIpAddressesEnabled**: `False`
- **headers**: none
- **credential**: no authentication

## Function

- **name**: `ghl_create_booking`
- **strict**: `—`
- **model-supplied parameters** (10): `booking_intent_text`, `caller_context`, `contactId`, `endTime`, `locationId`, `notes`, `preferred_date_text`, `search_reason`, `startTime`, `timezone`
- **required**: `booking_intent_text`, `contactId`, `endTime`, `locationId`, `startTime`, `timezone`
- **description**: 540 chars → [prose](../tool-prose/ghl-create-booking.f195a817-8346-475d-ad0e-8033f1d2e283.md)

## Static body fields

_none_

## Variable extraction

- schema: `{"type": "object", "required": [], "properties": {}}`

## Messages

- `request-start`: Perfect, I’ll go ahead and book that in for you now.
- `request-complete`: All set, your appointment has been booked.

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

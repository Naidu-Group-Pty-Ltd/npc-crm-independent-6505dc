# NPC Services

`61e6c684-6f5a-4567-aeeb-50c1552fb223` · **(no PSTN number — Vapi SIP)** · provider `vapi` · status `active`

## Routing

- assistant → NPC Discovery Call Follow Up

## Configuration

- **sipUri**: `sip:npc-services@sip.vapi.ai`
- **fallbackDestination**: `{"type": "number", "number": "+60182548567"}`

- created 2025-07-11 · updated 2025-07-11

## Migration note

A Vapi-provider number is re-provisioned on clone and receives a **new `sipUri`**. Anything dialling the old SIP address breaks.

# NPC Services

`f53c1661-29e9-4d8c-b595-b9da28cb46dc` · **+61281056305** · provider `twilio` · status `active`

## Routing

- **nothing — inbound calls are unrouted**

## Configuration

- **twilioAccountSid**: `{{REDACTED:TWILIO_ACCOUNT_SID}}`
- **fallbackDestination**: `{"type": "number", "number": "+61433005110"}`

- created 2025-11-12 · updated 2026-05-07

## Migration note

A Twilio number belongs to the **Twilio account**, not to Vapi. The clone cannot carry it: re-point the number at the new Vapi org and supply the Account SID and auth token again.

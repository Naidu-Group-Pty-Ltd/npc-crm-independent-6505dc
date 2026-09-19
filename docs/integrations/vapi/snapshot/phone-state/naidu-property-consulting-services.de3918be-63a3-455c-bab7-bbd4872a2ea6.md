# Naidu Property Consulting Services

`de3918be-63a3-455c-bab7-bbd4872a2ea6` · **+61286093299** · provider `twilio` · status `active`

## Routing

- **nothing — inbound calls are unrouted**

## Configuration

- **twilioAccountSid**: `{{REDACTED:TWILIO_ACCOUNT_SID}}`
- **server**: `{"url": "https://dduzbchuswwbefdunfct.supabase.co/functions/v1/vapi-call-webhook", "timeoutSeconds": 20}`

- created 2026-02-02 · updated 2026-02-02

## Migration note

A Twilio number belongs to the **Twilio account**, not to Vapi. The clone cannot carry it: re-point the number at the new Vapi org and supply the Account SID and auth token again.

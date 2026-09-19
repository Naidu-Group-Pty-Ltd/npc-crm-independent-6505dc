# Twilio Test

`3a3a507e-ede7-44dd-bd01-262011467a4e` · **+12184132393** · provider `twilio` · status `None`

## Routing

- **nothing — inbound calls are unrouted**

## Configuration

- **smsEnabled**: `True`
- **twilioAccountSid**: `{{REDACTED:TWILIO_ACCOUNT_SID}}`

- created 2024-06-23 · updated 2024-06-24

## Migration note

A Twilio number belongs to the **Twilio account**, not to Vapi. The clone cannot carry it: re-point the number at the new Vapi org and supply the Account SID and auth token again.

# Credentials referenced by these blueprints

No secret value is stored in this repository. Each row below is a placeholder
that appears in one or more blueprint files; the live value has to come from the
owning vendor console or from the Make scenario it was taken from.

| Placeholder | What it is |
| --- | --- |
| `{{SECRET:GHL_PIT_TOKEN_BOOKING}}` | GoHighLevel private integration token — booking/appointment router |
| `{{SECRET:GHL_PIT_TOKEN_CONTACTS}}` | GoHighLevel private integration token — contact resolver / MCP |
| `{{SECRET:TWILIO_ACCOUNT_SID}}` | Twilio Account SID (blocked by GitHub push protection) |
| `{{SECRET:VAPI_API_KEY}}` | Vapi private API key |

The `TWILIO_ACCOUNT_SID` placeholder is not an API key — it is an account
identifier that appears in a Twilio REST URL and in 43 cached sample bundles.
It is substituted because GitHub's push protection classes it as a secret and
refuses the push otherwise; it needs restoring on import but not rotating.

**The remaining keys were found hard-coded in live Make scenarios and should be rotated.**
A key pasted into an HTTP module is visible to anyone with read access to the
Make organisation and travels inside every blueprint export, which is how it
reached this export in the first place. Rotating it means issuing a new key in
the vendor console, updating the Make scenarios, and revoking the old one.

The durable fix is to stop hard-coding: Make's **Connections** hold a credential
outside the blueprint, so an export carries a connection id rather than a key.
Where a vendor has no Make app, a scenario-level or organisation-level variable
keeps the value out of the module and out of the export.

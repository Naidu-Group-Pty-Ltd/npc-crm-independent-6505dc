# Incident runbook — partner domain pilot

## Severity classes
- **SEV-1**: restricted-information exposure (anything in the prohibited
  list reaching a partner/client surface), cross-tenant/cross-organisation
  access, evidence object reachable without full authorisation, a partner
  write mutating origin case/gate state.
- **SEV-2**: authorisation gate failing closed too widely (legitimate
  partner locked out), backlog growth with no consumer, disposal failure
  loop, sanctions staleness during active screening statements.
- **SEV-3**: UI defects, notification copy issues, SLA breaches.

## First moves (any SEV-1)
1. Disable the narrowest responsible flag (layer-4 flag first; if surface
   compromise, the portal surface flag; if systemic, the workspace master).
   Server-side gates make this effective immediately.
2. Revoke affected deliveries/manifests/grants (revocation is never
   flag-gated).
3. Preserve evidence: access log, case events, outbox rows, delivery
   attempts — none are deleted by any rollback path.
4. Record in the incident register with timestamps and actors; notify the
   MLRO and security owner (`support-escalation-matrix.md`).
5. Do NOT communicate hold/investigation existence to partners — reuse the
   generic "temporarily unavailable" wording.

## Standing rules
- A stale sanctions source must never yield a "clear" screening statement —
  readiness shows `attention` and issuance policy follows it.
- Legal holds keep blocking disposal during any incident.
- No incident response may enable `aml_partner_service_blocking`.
- Privacy incidents involving the biometric vault or `aml-documents`
  bucket escalate to the privacy owner regardless of severity.

# Rollback runbook (E10)

Every level below states what was PROVEN and where. "Local" = the
disposable rehearsal DB (`supabase/tests/aml-local-rehearsal/`); staging
proofs cannot exist until a staging deployment occurs.

## Feature flags — PROVEN (local)
Disable the latest write flag → the write op answers 409 server-side (flag
contract tests) and authoritative records are preserved (`14-flag-order.sql`
drill). Order: reverse of enablement; layer-4 flags are independent.

## Portal routes — PROVEN (source contracts)
Turning a surface flag off removes the nav entry AND the server answers
404/409 regardless of the hidden UI (`workspace_disabled` gate precedes
every workspace op). UI hiding is never the enforcement.

## Worker — PROVEN (local, DB layer)
Stop invoking the worker → events accumulate VISIBLY (pending count +
oldest age in ops card/readiness; "operator action required" wording).
Restore → idempotent processing (duplicate-enqueue collapse and
notification UNIQUE proven in the rehearsal battery; consumer holds no
authoritative writes, so replay cannot mutate state).

## Evidence access — PROVEN (local, DB+source layers)
`aml_partner_evidence_delivery_write` → false stops recording AND
retrieval (409). Revoking a delivery blocks NEW access immediately
(`delivery_revoked` before storage resolution); an already-issued URL
lapses within its ≤300-second lifetime — URLs are never persisted, so
nothing must be purged. Staging re-proof: revoke a synthetic delivery and
confirm both behaviours end-to-end.

## Attestation v2 — PARTIALLY PROVEN
The v1 reader path is untouched since Phase 3 (byte-identical while
`aml_attestation_v2` off; source-contract coverage). NOT proven: disabling
v2 in an environment where v2 attestations already exist. Constraint
recorded: a superseded/refresh-flagged v2 attestation must NEVER become
servable again by flag rollback — the state machine reads row state, not
the flag, so old content stays withheld; staging must verify this exact
case before any v2 rollback is exercised.

## Migrations — PROVEN for the two new files (local)
`20260828000000` + `20260828000100` rolled back exactly per their headers
(catalogue restored to seed values, SMR row removed, access-log shape
restored, flags deleted) with Phase 1–8 objects verified intact, then
reapplied cleanly and re-verified. Phase 1–8 migrations: rollback headers
exist and are parsed, but **must not be rolled back after material data
exists** without: data export, dependency scan, retention review, and
explicit rollback-owner approval. No destructive rollback is authorised by
this pack.

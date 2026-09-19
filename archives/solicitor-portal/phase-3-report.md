# Solicitor Cross-Portal Programme — Phase 3 Report

## Scope and decision

Phase 3 introduces server-enforced, versioned portal governance and explicit audience data contracts. It is additive: legacy governance booleans and all operational legal tables remain in place for compatibility. No Phase 4 state-transition or link-integrity work is included.

## Architecture

- `portal_terms_versions` and `portal_terms_acceptances` prove which effective Solicitor terms version a user accepted.
- Three mandatory `solicitor_onboarding_steps` are seeded for existing users and by trigger for future users; completion records the authenticated session.
- The shared session resolver derives current-version acceptance and mandatory-step completion. All five legal resource Edge Functions reject access until password rotation, terms, onboarding, user activity and firm activity pass.
- Legal matter selects are audience-specific. Practice `internal_notes` is limited to the Solicitor detail contract; Command Centre receives its separately owned `npc_internal_notes`; Finance and Client contracts contain neither.
- `client_legal_case_summary` is a sanitised read model maintained from legal matters and read by the Client Portal using the verified session's `client_id`.

## Migration and preservation

Migration: `20260730190000_solicitor_governance_contracts_phase3.sql`.

The migration is expansion-only, seeds governance rows, backfills the projection, enables RLS, revokes browser roles, and explicitly grants only `service_role`. Existing terms/onboarding booleans are dual-written but are not trusted by the new authorization gate.

Run `scripts/solicitor-portal/phase-3-reconciliation.sql` after migration. It reports users missing current terms/onboarding and missing, cross-client, or stale client projections. No ambiguous relationships are inferred.

## Security and privacy review

- Governance is checked server-side before any matter, document, communication, intelligence, or compliance operation.
- Acceptance and onboarding mutations retain CSRF/custom-header and strict-origin enforcement.
- Browser callers cannot directly query the governance or projection tables.
- Client reads are scoped to the session-derived client, never a body-supplied client ID.
- Financial-position, AML/SMR, practice notes, NPC notes, risk notes and conflict details are absent from the Client projection.

## Rollback

Disable deployment of the Phase 3 Edge/frontend bundle and redeploy Phase 2 functions. Leave additive tables, column, triggers and projection data in place. This preserves all captured acceptance evidence and avoids destructive rollback. The old booleans remain available during the rollback window.

## Known risks and follow-ups

- The projection trigger is an interim Phase 3 synchronisation mechanism; Phase 6 replaces it with transactional outbox projections.
- `case_id` remains nullable until the Phase 5 transaction-case backbone exists.
- Existing users must accept the newly seeded terms and complete mandatory steps at first login; reconciliation quantifies impact.
- Phase 4 must add guarded legal state transitions and link integrity without broadening these contracts.

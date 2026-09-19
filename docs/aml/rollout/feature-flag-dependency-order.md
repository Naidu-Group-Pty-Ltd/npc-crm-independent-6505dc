# Feature-flag dependency order (E3)

Fifteen switches, five layers. A dependent flag must never be enabled
before its prerequisite; layer 4 is one capability at a time with evidence
between steps. The full order was rehearsed on the disposable local DB
(`supabase/tests/aml-local-rehearsal/14-flag-order.sql`) including the
one-at-a-time layer-4 sequence and a flag rollback with records preserved.
All fifteen are seeded/left **false** everywhere.

**Layer 1 — foundation (internal only, no partner-visible change)**
1. `aml_partner_identity`
2. `aml_arrangement_governance`
3. `aml_attestation_v2`

**Layer 2 — read-only workspace**
4. `aml_partner_compliance_workspace` (master)
5. `aml_partner_operations_reporting`
6. Portal surfaces individually, one at a time:
   `aml_partner_workspace_finance` → `aml_partner_workspace_builder` →
   `aml_partner_workspace_solicitor`.
   `aml_partner_workspace_developer` **stays false**: no standalone
   Developer Portal authentication/assignment foundation exists; the flag
   gates nothing and enabling it would be a false promise. Developer-type
   organisations use the existing Builder/Developer surface where that
   authenticated model genuinely applies.

**Layer 3 — event and records infrastructure**
7. Schedule and VERIFY the outbox worker (backlog must drain — a growing
   pending count means it is not being invoked).
8. `aml_partner_event_outbox`
9. Approve retention schedule configuration (decision register items).
10. `aml_partner_records_retention`

**Layer 4 — controlled writes, ONE at a time with UAT + preflight between**
11. `aml_partner_grants_write`
12. `aml_partner_records_requests_write`
13. `aml_partner_evidence_delivery_write`
14. `aml_partner_determinations_write`

**Layer 5 — not authorised in this run**
15. `aml_partner_service_blocking` — remains false; enforced nowhere; no
    service or settlement blocking exists or may be added under this
    programme.

Rollback at any point: disable the most recent flag first; layer-4 flags
disable independently; disabling a layer-2 prerequisite closes every
dependent surface (server-side 404/409, not hidden buttons).

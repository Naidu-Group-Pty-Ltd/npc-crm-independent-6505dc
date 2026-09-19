# Migration manifest — AML/CTF partner domain release candidate

Full order for a from-scratch environment: the 60-file list in
`supabase/tests/aml-local-rehearsal/migration-order.list` (58 committed
migrations referencing the `aml` schema, in filename order, plus the two
below). An existing environment that already carries the pre-Phase-1 AML
baseline applies only the nine programme migrations.

| Migration | Phase | Local rehearsal | Staging | Production | Rollback |
|---|---|---|---|---|---|
| `20260805100000_aml_partner_identity_phase1.sql` | 1 | applied ✔ | not applied | not applied | header of file |
| `20260805110000_aml_arrangement_governance_phase2.sql` | 2 | applied ✔ | not applied | not applied | header of file |
| `20260805120000_aml_attestation_v2_manifests_phase3.sql` | 3 | applied ✔ | not applied | not applied | header of file |
| `20260805130000_aml_partner_workspace_phase4.sql` | 4 | applied ✔ | not applied | not applied | header of file |
| `20260805140000_aml_partner_events_phase6.sql` | 6 | applied ✔ | not applied | not applied | header of file |
| `20260805150000_aml_partner_records_retention_phase7.sql` | 7 | applied ✔ | not applied | not applied | header of file |
| `20260805160000_aml_partner_operations_phase8.sql` | 8 | applied ✔ | not applied | not applied | header of file |
| `20260828000000_aml_record_classification_correction.sql` | 9-A | applied ✔ · **rolled back ✔ · reapplied ✔** | not applied | not applied | header of file — rehearsed verbatim |
| `20260828000100_aml_partner_action_flags.sql` | 9-E2 | applied ✔ · **rolled back ✔ · reapplied ✔** | not applied | not applied | header of file — rehearsed verbatim |

Rules restated: all additive/widening; superset CHECK swaps only; no
committed migration is ever edited; Phase 1–8 migrations must not be rolled
back after material data exists without export + dependency scan +
retention review + explicit rollback-owner approval (`rollback-runbook.md`).

Ownership fields (complete before staging): migration owner ______,
rollback owner ______, executed by ______, date ______, snapshot ref ______.

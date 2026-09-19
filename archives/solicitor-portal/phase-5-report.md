# Solicitor Cross-Portal Programme — Phase 5 Report

## Scope

Phase 5 introduces the transaction-case backbone without merging Command Centre deals, Finance purchase files, or Solicitor legal matters. It stops before Phase 6 field ownership, outbox, and portal projections.

## Architecture

`transaction_cases` owns shared identity, lifecycle, risk and aggregate version only. `transaction_case_links` connects at most one legal matter, purchase file and client deal to a case. Unique constraints prevent a domain record joining multiple cases, while the database guard verifies every link shares the case client. Link removal is preserved in append-only `transaction_case_link_history` rather than silently erased.

Service-role-only commands create cases, link or unlink domain records, and retrieve health. Commands lock the case, enforce `expected_version`, validate domain ownership, increment the case version, append link history, and maintain legacy link columns through one compatibility adapter. Edge Functions do not independently dual-write.

## Backfill and reconciliation

The migration uses only deterministic evidence: `legal_matters.purchase_file_id`, `legal_matters.client_deal_id`, `purchase_files.legal_matter_id`, `purchase_files.client_deal_id`, and `client_deals.purchase_file_id`. Address values are normalized for display but never used to infer a relationship. Unlinked active records receive standalone cases. Invalid, duplicate, null-client, or conflicting relationships are surfaced in `transaction_case_reconciliation_issues`.

Run `scripts/solicitor-portal/phase-5-reconciliation.sql` after migration. It reports cases created, records linked per domain, open ambiguity/conflict counts, cross-client conflicts and remaining active orphans.

## Command Centre workspace

The Solicitor Portal administration area includes a Transaction Cases workspace showing the client, property, case type/version, linked-domain count, lifecycle/risk health, reconciliation issues, domain statuses and link history. All data is loaded through the existing authenticated Command Centre legal administration function.

## Feature flag and rollback

`TRANSACTION_CASES_V1=false` disables case workspace and commands without changing domain reads. Roll back application code first while leaving the additive case tables and history intact. Legacy columns remain populated by the compatibility adapter, so Phase 4 behavior can resume. Never drop case or history data during rollback.

## Known risks and follow-ups

- Static migration contracts passed, but the migration must be rehearsed against a production-shaped snapshot before merge.
- Standalone cases may represent the same real transaction; they must be reconciled explicitly and must not be merged by address.
- Existing cross-client or duplicate links remain visible as issues and are not silently corrected.
- Phase 6 must publish case changes through a transactional outbox and build deterministic portal projections.

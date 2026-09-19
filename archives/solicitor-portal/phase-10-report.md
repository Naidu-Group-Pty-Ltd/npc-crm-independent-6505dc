# Phase 10 delivery report — Client Legal Workspace

## Architecture
The Client Portal now has list/detail legal routes backed by a sanitised case projection and governed milestone, conversation and immutable-document APIs. No browser query reaches operational legal tables.

## Data and migration
The additive migration expands `client_case_read_model` with safe legal/practice contact fields and adds sanitised activity plus immutable document acknowledgements. Backfill uses explicit transaction-case links only. No legacy row, route, or storage object is removed.

## Privacy review
The workspace contract explicitly permits friendly status, shared summary, property, settlement, contacts, client-visible runway, granted documents and the client's canonical legal conversation. It excludes `internal_notes`, `risk_notes`, conflict details, intelligence, restricted AML, Finance private data, raw audit metadata, storage paths and scan details.

## Rollback and risks
Set `CLIENT_LEGAL_WORKSPACE` to anything other than `true` to return 404 and hide the navigation/routes. Existing projections and acknowledgements remain intact. Enablement depends on transaction-case reconciliation, Phase 8 canonical conversations, Phase 9 immutable documents and a healthy outbox worker.

# Phase 11 delivery report — Finance and Solicitor collaboration

## Architecture
Finance and Solicitor collaboration is anchored to the transaction case. Audience-specific projections, shared runway tasks, explicitly granted documents and canonical conversations are composed by trusted Edge Functions; neither browser queries another domain's operational tables.

## Privacy
Finance DTOs exclude private legal notes, conflicts, privileged intelligence and evidentiary audit metadata. Solicitor DTOs expose only finance status, lender, finance-clause state, assigned Finance contact, shared tasks and provenance; financial-position and restricted AML/SMR fields remain forbidden.

## Command Centre controls
Case health now includes unlinked records, mismatch and stale-projection indicators, access-grant and conversation-participant inspection, delivery attempts, reconciliation issues and durable projection refresh/replay controls. Client options for legal administration are server-mediated.

## Rollback and dependencies
Disable `FINANCE_SOLICITOR_COLLABORATION` to hide both portal panels and return 404 from the collaboration APIs. Additive projections and audit history remain. Enablement depends on reconciled Phase 5 links, Phase 6 outbox health, Phase 7 runway, Phase 8 conversations and Phase 9 document grants.

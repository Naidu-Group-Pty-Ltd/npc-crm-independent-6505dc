# ADR 011: Client Legal Workspace uses sanitised projections

- **Status:** Accepted for Phase 10
- **Date:** 2026-07-30

## Context
Clients currently receive isolated legal notifications and a small case summary. Direct reads from operational legal tables would expose practice-private notes, conflict details, privileged analysis, scanner internals, or audit metadata.

## Decision
`/client/legal` and `/client/legal/:caseId` read through a single server-mediated Client Legal Workspace contract. Case identity, friendly progress, shared summary, property, settlement, practice contact and solicitor contact come only from `client_case_read_model`. Milestones/tasks use the client audience of `get_case_runway`; messages use canonical `client_solicitor` participant APIs; documents use clean, reviewed immutable versions with active client grants.

Document acknowledgements are immutable, case-scoped evidence written by a trusted RPC. Client uploads are accepted only for an explicitly client-owned requested document, use a server-generated immutable version/path, and enter quarantine/scanning before they can be downloaded.

`CLIENT_LEGAL_WORKSPACE` is opt-in. The browser never receives service-role credentials and never directly queries legal operational tables.

## Consequences
- Practice notes, conflict data, privileged intelligence, raw audit data, storage paths and scan internals are absent by construction.
- Solicitor changes reach the workspace through the transactional outbox projection.
- Client replies retain the canonical conversation and message IDs.
- Phase 11 may reuse the case identity while retaining Finance and Legal privacy boundaries.

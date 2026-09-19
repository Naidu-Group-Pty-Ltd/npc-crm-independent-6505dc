# Solicitor cross-portal architecture — current state

**Baseline:** `ed101b6ed3e0d1a5aedc4d8eefe37e214a193647`  
**Phase:** 0 (documentation and regression harness only)

## Architectural strengths to preserve

1. **Shared legal domain helpers.** `_shared/legalMatters.ts`,
   `_shared/legalCriticalDates.ts`, and `_shared/legalComms.ts` centralise matter
   statuses and selections, critical-date definitions, document concepts, and
   communication scopes. Command Centre and Solicitor handlers reuse these
   definitions rather than inventing incompatible enums. Later phases must extend
   this pattern with explicit cross-domain ownership; they must not duplicate it.
2. **Deliberate Finance and AML separation.** `SOLICITOR_FORBIDDEN_KEYS` hard-denies
   income, expenses, assets, liabilities, employment, borrowing capacity,
   commissions, SMR, and restricted AML data. This is a permanent invariant,
   independent of any future stored allow policy.
3. **Command Centre authorization controls.** `solicitor-portal-admin` resolves a
   Command Centre session, checks the Solicitor Portal module permission, applies
   CSRF protection to mutations, and mediates privileged database access on the
   server. Browser role claims are not authoritative.
4. **Private document delivery.** Legal objects stay in a private bucket and are
   downloaded with short-lived signed URLs rather than public object URLs.
5. **Compliance-oriented concepts.** Conflict checks, closure checklists,
   retention classes, audit events, and hash-chain verification already exist.
   They require transactional enforcement and strict verification, not removal.

## Current trust and access path

```text
Solicitor browser
  -> anon-key Edge Function request + raw portal token in header and JSON
  -> resolve token against solicitor_portal_users.session_token
  -> list solicitor_portal_client_assignments.client_id
  -> load legal matters for all assigned clients
  -> permit firm_id = caller firm OR firm_id IS NULL
  -> OR-merge baseline and client permission matrices (missing = allow)
```

Although an assignment has `legal_matter_id`, uniqueness and lookup use
`(solicitor_user_id, client_id)`. Matter listing and resource loading do not use
that matter ID as the access boundary. Responsibility
(`assigned_solicitor_user_id`) is also not an access grant.

## Existing domain records and ownership assumptions

| Record/data | Current owner | Current cross-portal behaviour |
| --- | --- | --- |
| `clients` identity/contact | Command Centre | Referenced by all portals |
| `client_deals` and NPC stage | Command Centre | Sometimes created as a Finance side effect |
| `purchase_files`, lender/loan state | Finance | Direct optional matter link; separate dates/tasks |
| `legal_matters`, searches, requisitions, conflicts | Solicitor/legal | Direct optional file/deal links; private and shared fields mixed in broad selection |
| `legal_matter_critical_dates` | Solicitor/legal | Duplicates some Finance dates |
| `purchase_file_settlement_tasks` | Finance | Separate from legal settlement tasks |
| `legal_matter_threads/messages` | Solicitor/legal | Messages mirrored best-effort into other portal tables |
| `legal_matter_documents` | Solicitor/legal | Same row updated and earlier object deleted on replacement |
| Client legal progress | No governed owner | No dedicated sanitised legal projection |

## P0 gap register

| ID | Gap | Architectural impact |
| --- | --- | --- |
| AUTHZ-01 | Access is client-scoped, not matter-scoped | A repeat client's unrelated matter can be exposed |
| AUTHZ-02 | Permissions default allow and are OR-merged | An override cannot reduce a baseline allow |
| SESS-01 | Raw token is in browser storage/request JSON/plaintext user column | XSS/replay risk, one session, weak revocation visibility |
| GOV-01 | Boolean terms/onboarding state is not a server access gate | Incomplete users can reach legal data |
| PRIV-01 | Practice-only/client-visible labels do not match audience DTOs | Private notes can cross boundaries; client data is incomplete |
| LINK-01 | Matter/file/deal links are not uniformly same-client and atomic | Links can mismatch or drift |
| STATE-01 | Workflow status and closure are separate writable state machines | Terminal/open/blocker contradictions are possible |
| COMMS-01 | Messages are copied best-effort between portal stores | Ghost/lost messages and wrong recipients are possible |

## P1 and P2 gap register

| ID | Gap | Architectural impact |
| --- | --- | --- |
| DATA-01 | Dates/property/financial fields overlap | No deterministic authority |
| RUNWAY-01 | Finance and legal settlement tasks are separate | Conflicting completion and ownership |
| EVENT-01 | Cross-portal effects are not transactional | Partial completion and silent divergence |
| DOC-01 | Replacement deletes earlier object versions | Weak chain of custody |
| AUDIT-01 | Audit failure is non-blocking; verification is tolerant | A mutation can lack trustworthy evidence |
| CLIENT-01 | No governed Client Legal read model | Client legal experience is incomplete |
| AI-01 | No visible firm/document AI processing gate | Governance, provenance, residency, and cost risk |
| SCALE-01 | Fixed limits, post-fetch filtering, no optimistic locking | Omissions and last-write-wins conflicts |
| UI-01 | Large pages, repeated wrappers, manual fetch/polling | Harder maintenance and testing |
| QA-01 | No dedicated portal gates; application TypeScript is non-strict | Contract regressions are easier |

## Failure scenarios captured by fixtures

- One client with one matter (normal legacy access).
- One client with two matters where one client assignment exposes both.
- Two firms acting for the same client, including the unsafe null-firm wildcard.
- Multiple Finance users where “first assignment” is not a governed recipient.
- Solicitor, conveyancer, paralegal, and practice administrator roles.
- Client-visible summaries beside private legal notes.
- Linked, mismatched, one-sided, and unlinked matter/file/deal records.

The executable Phase 0 tests intentionally reproduce these current behaviours.
They are characterization tests, not statements that unsafe behaviour is correct.

## Detailed evidence and required correction map

| Finding | Repository evidence | Required correction phase |
| --- | --- | --- |
| AUTHZ-01 | Assignment uniqueness and admin lookup use user + client; matter loaders use assigned client IDs and allow null firm | Phase 1 exact matter grants; ownership remains separate |
| AUTHZ-02 | `DEFAULT_ALLOW_KEYS` and boolean OR expressions determine effective policy | Phase 1 tri-state policy with explicit matter decision precedence |
| SESS-01 | Client persists token in both web-storage mechanisms and sends header + JSON; resolver queries plaintext user column | Phase 2 hashed multi-session cookie model |
| GOV-01 | Invite state starts false; protected route checks authentication/password only | Phase 3 versioned terms plus frontend and server policy gates |
| PRIV-01 | `MATTER_SELECT` contains `internal_notes` and `shared_summary`; no Client legal projection exists | Phase 3 named audience selects/DTOs and sanitised materialisation |
| LINK-01 | Direct matter/file link is trigger-synchronised; matter/deal link has no universal same-client command | Phases 4–5 transactional validation and case backbone |
| STATE-01 | Status accepts enum values while closure mutations are separate; blocker calculation does not form one locked command | Phase 4 transition graph, blockers, version, history, audit, outbox transaction |
| COMMS-01 | Solicitor communication handler mirrors to target stores before/around legal message persistence | Phase 8 canonical conversation with explicit participants |
| DATA/RUNWAY | Finance purchase-file dates/tasks and legal dates/tasks coexist | Phase 7 authoritative milestones and shared case tasks |
| EVENT-01 | Cross-portal handlers use sequential best-effort writes | Phase 6 transactional outbox, idempotent consumers, reconciliation |
| DOC-01 | Upload increments the same row version and removes the earlier object | Phase 9 immutable version rows, hashes, scanning, grants |
| AUDIT-01 | Recorder catches insertion errors; verifier conditionally tolerates content hash mismatch; portal exposes `audit_record` | Phases 6/14 atomic evidence, strict canonical hashing, no generic insertion |
| CLIENT-01 | General Client data contract has no governed legal workspace DTO | Phase 10 sanitised Client Legal projection |
| AI-01 | Intelligence sends document/context externally without a visible firm/document policy gate | Phase 13 policy, provenance, budgets, residency, review |
| SCALE/UI/QA | Limits of 500/200, post-fetch search, 500-message reads, polling, non-strict app config | Phases 12/14 plus Phase 0 dedicated gates |

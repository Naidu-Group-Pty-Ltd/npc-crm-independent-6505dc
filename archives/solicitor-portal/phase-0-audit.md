# Solicitor Portal Cross-Portal Programme — Phase 0 Audit

**Baseline requested:** `main` at `ed101b6ed3e0d1a5aedc4d8eefe37e214a193647`  
**Inspected commit:** `ed101b6ed3e0d1a5aedc4d8eefe37e214a193647`  
**Audit date:** 2026-07-30  
**Phase gate:** documentation and regression harness; no runtime/schema changes

## Repository and rebase evidence

The checkout was clean on branch `work` at the reviewed baseline. The environment
contained no Git remote. `origin` was configured for the supplied repository, but
the required fetch was rejected by the environment's CONNECT proxy with HTTP 403.
Consequently the branch could not be independently refreshed; it remains exactly
at the user-supplied reviewed baseline. This limitation must be resolved before a
production merge.

## Current architecture inventory

The detailed evidence and ownership inventory lives in
`docs/architecture/solicitor-cross-portal-current-state.md`; the intended domain
boundaries, audience DTOs, shared backbone, and delivery model live in
`docs/architecture/solicitor-cross-portal-target-state.md`.

### Strengths retained

- Shared matter, critical-date, document, and communication helpers remain the
  common legal vocabulary for Solicitor and Command Centre code.
- The hard-coded financial and AML forbidden-key set remains a permanent
  invariant which no stored permission may override.
- Command Centre administration retains authenticated module authorization,
  CSRF checks, and server-only service-role mediation.
- Legal documents remain private and are delivered through expiring signed URLs.
- Conflict, closure, retention, audit-chain, and verification concepts are kept;
  later phases strengthen their atomicity rather than replacing them.

### Schema lineage

| Migration | Existing responsibility |
| --- | --- |
| `20260730110751_…` | Firms, portal users, default permissions, client assignments, activity log, raw single-session columns |
| `20260730115003_…` | Legal matters/parties/status history and bidirectional purchase-file link |
| `20260730120646_…` | Critical dates and settlement runway tasks |
| `20260730122443_…` | Documents, searches, requisitions, and disbursements |
| `20260730124921_…` | Participant threads, copied messages, and notifications |
| `20260730131401_…` | Intelligence outputs and contract reviews |
| `20260730133231_…` | Hash-chained legal audit, conflicts, closure/retention, compliance exports |

All listed portal tables are service-role mediated and RLS-enabled. Phase 0 adds
no migration because it changes no database object. Generated Supabase types are
therefore intentionally unchanged.

### Server/API inventory

Fourteen `solicitor-portal-*` Edge Functions cover authentication, invitation and
password recovery, administration, matters, documents, communications,
intelligence, and compliance. Gateway JWT verification is disabled for these
custom-session functions; authorization is expected inside each handler.

The shared `solicitorPortalAuth.ts` helper currently:

- resolves a raw token against `solicitor_portal_users.session_token`;
- validates user, expiry, revocation, and firm state;
- grants access through a solicitor-to-**client** assignment;
- OR-merges baseline and per-client booleans; and
- defaults all known permission keys to view, with most edit permissions allowed.

### Frontend inventory

The Solicitor Portal has dedicated auth, dashboard, matters, pipeline, deal-room,
documents, communications, intelligence, and compliance surfaces. Its typed
client calls Edge Functions rather than querying legal tables directly. The
compatibility auth client currently accepts response-body session tokens and can
persist them in browser storage. No Phase 0 UI change is made.

### Cross-portal relationship inventory

| Relationship | Current key/path | Baseline issue |
| --- | --- | --- |
| Solicitor user → accessible work | `solicitor_portal_client_assignments.client_id` | Client scope can expose every matter for a client |
| Matter ↔ finance file | `legal_matters.purchase_file_id` plus `purchase_files.legal_matter_id` | Trigger-synchronised pair; no shared aggregate or same-client constraint |
| Matter ↔ deal | No canonical link | Ambiguous; must not be inferred from address |
| Legal workflow ↔ finance/client workflow | Independent tables and side effects | No atomic command/outbox contract |
| Messages | Legal thread/message copies | Not yet canonical participant-based conversations |
| Documents | Mutable document records with supersession pointer | No immutable version/hash/scan/grant contract |
| Client legal data | No formal sanitised projection | Direct/ad-hoc expansion would risk privileged leakage |

## Security and correctness gap register

| ID | Finding | Severity | Owning phase / acceptance criterion |
| --- | --- | --- | --- |
| AUTHZ-01 | Authorization is client-scoped rather than explicit matter-scoped | Critical | Phase 1: exact non-null-firm matter grants |
| AUTHZ-02 | Missing policies default allow and policy layers are OR-merged | Critical | Phase 1: tri-state matter policy with explicit deny precedence |
| SESS-01 | Raw token is stored in JavaScript storage and a plaintext user column | Critical | Phase 2: hashed multi-session rows and HttpOnly cookies |
| GOV-01 | Terms/onboarding are unversioned booleans and not complete access gates | High | Phase 3: versioned acceptance and server/frontend gates |
| PRIV-01 | Broad selections do not express separate audience contracts | Critical | Phase 3: Solicitor/Command Centre/Finance/Client DTO allow-lists |
| LINK-01 | Matter/file/deal links lack uniform same-client atomic commands | Critical | Phases 4–5: validation, reconciliation, transaction case |
| STATE-01 | Status and closure are contradictory writable state machines | High | Phase 4: versioned transactional transition commands returning 409 |
| COMMS-01 | Portal messages are lossy best-effort copies | Critical | Phase 8: canonical participant conversations |
| DATA-01 | Dates and property/financial fields overlap without declared authority | High | Phases 5–7: ownership registry and shared milestones |
| RUNWAY-01 | Finance and legal settlement tasks are separate | High | Phase 7: shared case tasks with private domain tasks retained |
| EVENT-01 | Cross-portal side effects have no transactional outbox | Critical | Phase 6: durable outbox and idempotent consumers |
| DOC-01 | Document replacement deletes prior objects | High | Phase 9: immutable hashed/scanned versions and grants |
| AUDIT-01 | Audit failure is non-blocking and verification can tolerate hash mismatch | Critical | Phase 6/14: transactional trusted audit and strict verification |
| CLIENT-01 | Client Portal has no governed legal read model | High | Phase 10: sanitised projection |
| AI-01 | External AI processing lacks firm/document policy and full provenance | High | Phase 13: governance and human review |
| SCALE-01 | Fixed limits, post-fetch filters, and last-write-wins updates | High | Phases 4/12: pagination, server search, expected versions |
| UI-01 | Large pages, repeated wrappers, and polling impede maintenance | Medium | Phase 12: frontend architecture |
| QA-01 | Portal-specific strict, contract, security, and E2E gates were absent | High | Phase 0: dedicated harness added |

## Compatibility and feature-flag register

Do not remove `solicitor_portal_client_assignments`, raw session columns, direct
matter/file links, legacy message/document tables, or current endpoints during
expansion. Each replacement must ship behind a default-off server-evaluated flag,
dual-read where required, record mismatches without leaking payloads, and retain a
fast rollback to the prior read path. Flags do not bypass authorization.

## Backfill and reconciliation baseline

`scripts/solicitor-portal/phase-0-reconciliation.sql` is read-only and reports:

1. assignment rows with missing users/clients or cross-firm matter references;
2. assignments whose optional matter belongs to another client;
3. one-sided or cross-client legal-matter/purchase-file links;
4. duplicate direct links;
5. mismatched/duplicate deal links; and
6. matters, purchase files, and deals that remain unlinked candidates.

The report deliberately produces candidates rather than inferred mappings.
Operators must resolve ambiguity using stable IDs or explicit business evidence;
an address match alone is prohibited.

## Baseline check results

| Command | Result |
| --- | --- |
| `git status --short --branch` | Pass: clean `work` branch before edits |
| `git fetch origin main` | Environment warning: CONNECT proxy returned HTTP 403 |
| `npx vitest run src/security/solicitorPortalComplianceAuthz.security.test.ts` | Environment warning: dependencies absent and npm registry returned HTTP 403 |
| `npx tsc -b --pretty false` | Environment warning: dependency type declarations absent |
| `npm run security:static` | Pass: 578 files scanned |
| `npm run test:solicitor-portal` | Pass: 4 characterization tests |
| `npm run test:cross-portal-contracts` | Pass: 4 boundary contract tests |
| `npm run security:solicitor-portal` | Pass: 14 Edge Functions and browser credential boundary checked |
| `node -e "…JSON.parse…"` | Pass: fixture and strict tsconfig JSON valid |
| `npm run typecheck:portals` | Environment warning: dependency type declarations absent |
| `npm run test:e2e:solicitor-portal` | Environment warning: Playwright executable absent |
| `npm run lint` / `npm run build` | Environment warning: project dependencies absent |

## Phase 0 regression and decision artifacts

- Six focused ADRs decide the transaction backbone, matter access, session
  security, outbox, conversations, and immutable document direction.
- `tsconfig.portals-strict.json` opts the Solicitor pages/components and
  `solicitor*`/`legal*` libraries into strict checking without changing the
  application-wide compiler configuration.
- The named `typecheck:portals`, `test:solicitor-portal`,
  `test:cross-portal-contracts`, `test:e2e:solicitor-portal`, and
  `security:solicitor-portal` commands form the later-phase gate surface.
- The fixture includes one- and two-matter clients, two firms, multiple Finance
  users, all four portal roles, private/shared data, and linked/unlinked/mismatched
  relationships. Tests intentionally prove the current client-scope, null-firm,
  and OR-merge behaviours so Phase 1 changes are explicit.

## Phase 0 exit criteria

- [x] Current schema, functions, clients, links, boundaries, and gaps inventoried.
- [x] Current/target architecture and six focused ADRs record the decisions.
- [x] Read-only backfill/reconciliation report supplied; no ambiguous links made.
- [x] Static contract harness covers the baseline and forbidden credential/data patterns.
- [x] No schema, generated type, Edge Function, or frontend runtime change.
- [ ] Fresh-main fetch/rebase (blocked by environment network policy; required before merge).

**Stop gate:** Phase 0 is complete. Phase 1 must be a separate branch and PR.

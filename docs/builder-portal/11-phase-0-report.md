# Builder / Developer Portal — Phase 0 completion report

| Field | Value |
| --- | --- |
| Phase | 0 — Baseline, existing-architecture assessment, ADRs and regression harness |
| Baseline commit | `a2ec188faa806ff97cb272f7f5a8bcf56b984cb1` |
| Branch | `claude/builder-developer-portal-arch-lq16u6` |
| Position at start | 0 ahead, 0 behind `origin/main` |
| Production behaviour changed | None |
| Migrations added | None |
| Edge Functions added | None |
| Routes added | None |
| Status | Complete. Phase 1 not started. |

## 1. Findings

### 1.1 The Solicitor Portal separates portals at the route tree and the transport

`/solicitor/*` (`src/App.tsx:359`) is a **sibling** of `/`, outside
`ProtectedRoute` and `DashboardLayout`, wrapped in its own
`SolicitorPortalAuthProvider`. The provider never touches the Supabase auth
session; `src/lib/solicitorPortal.ts` is a bare `fetch` with
`credentials: 'include'`, an `X-Portal-Request` discriminator and the anon key —
no `localStorage`, no `sessionStorage`, no readable token. The session is a
`__Host-solicitor_session_token` HttpOnly cookie whose SHA-256 hash alone is
persisted in `solicitor_portal_sessions`, with a 12 h absolute and 30 min sliding
idle expiry, revocation, and IP/user-agent fingerprint binding. Every
`solicitor-portal-*` function funnels through one `resolveSolicitorSession()`,
and `solicitorGovernanceError()` is the real governance gate — the browser route
guard mirrors its order but is a journey aid, not an authorization control.

The three-tier nesting (**provider → protected route → layout**) is the pattern
the Builder Portal reproduces verbatim.

### 1.2 The internal administration pattern

`/admin/solicitor-portal` is inside `DashboardLayout` behind
`ModuleGuard moduleKey="solicitor_portal_admin"` (`src/App.tsx:435`), with the
same key on entries in `DashboardSidebar.tsx:174`, `MobileSidebar.tsx:161` and
`GlobalCommandPalette.tsx:140`. Server-side, `solicitor-portal-admin`,
`solicitor-portal-invite` and `legal-matters-admin` each enforce `verifyAuth()` +
`requireModulePermission('solicitor_portal_admin')` + `enforceCsrf()` and hold
the service role. No internal navigation surface links `/solicitor/*`.

### 1.3 The Builder domain is genuinely greenfield

No Builder or Developer portal, route, table, Edge Function, role or module key
exists at this baseline. Of 421 declared tables, exactly two are builder-named,
and both are Finance/Command-Centre owned:

- `build_progress_payments` — keyed on `client_deals`, models lender drawdown
  with free-text stage names and `is_commission_trigger`
- `builder_invoices` — keyed on `client_deals`, carries `commission_amount`

Both carry `USING (true) WITH CHECK (true)` RLS for `authenticated`. Also present:
`client_deals.build_price` / `land_price` / `construction_loan_type` /
`expected_build_start` / `estimated_completion`, `legal_matters.lot_plan` /
`title_reference`, and `src/components/deals/BuilderInvoiceLog.tsx`.

Nothing exists for developments, projects, stages, estates, buildings, lots,
units, packages, inventory, availability, reservations, holds, allocations,
variations, progress claims, inspections, defects, practical completion,
handover, warranty, incentives or rebates.

### 1.4 The shared backbone is substantial and mostly reusable

`transaction_cases` (whose `case_type` already permits `'construction'`), the
transactional outbox, unified `case_milestones` and `case_tasks` with
`expected_version` concurrency, canonical `conversations`, the immutable document
service with hash verification and malware scanning, notification scheduling,
`portal_operational_events`, the `cross_portal_*` cutover control plane, and the
whole `_shared/` session, password, CSRF, CORS, SSRF and storage primitive set.

### 1.5 Twelve "shared" primitives are legal-coupled

The central finding. Named shared, constrained to the legal domain, verified
mechanically by `tests/builder-portal/phase0-shared-primitive-constraints.test.mjs`
and re-derived by `scripts/builder-portal/phase-0-inspection.mjs` (reported
12/12 still at baseline shape):

`portal_terms_versions.portal` · `portal_terms_acceptances` (portal CHECK **and**
`solicitor_user_id NOT NULL`) · `case_milestones.source_domain` / `.authority` ·
milestone and task `visibility` · `case_tasks.owner_domain` ·
`case_task_assignments.assignee_type` ·
`conversation_participants.participant_type` ·
`document_access_grants.audience` · `transaction_case_links` (three fixed slots)
· five `cross_portal_*` tables FK'd to `solicitor_firms` · `firm_ai_policies` ·
`PortalDomain` in `crossPortalFieldOwnership.ts`.

Builder generalises these (GEN-01 … GEN-13). It does not create parallel tables.

### 1.6 Seven Solicitor defects that must not be copied

NOCOPY-01 default-allow OR-merged permissions · NOCOPY-02 surviving raw-token
carrier and plaintext session column · NOCOPY-03 `solicitor_portal_admin` absent
from `dashboard_modules` · NOCOPY-04 non-blocking audit failure · NOCOPY-05
unreviewable inline authorization code · NOCOPY-06 unjustified session lifetime
with no step-up · NOCOPY-07 two coexisting authorization models.

NOCOPY-01, NOCOPY-02 and NOCOPY-03 are characterised by passing tests so the
Builder programme demonstrably diverges from them rather than claiming to.

### 1.7 Domain-model conclusions

- Builder domain records go in Builder-owned tables. `transaction_cases` gains no
  Builder columns, only one link slot.
- **Unsold inventory has no transaction case.** `transaction_cases.client_id` is
  `NOT NULL`; a case exists only from the `reserved` transition onward.
- A project may have **distinct developer and builder organisations**. The
  Solicitor single-`firm_id` shape cannot express this and must not be copied;
  `builder_project_parties (project_id, organisation_id, party_role)` can.
- Builder transactions are **not** backfilled from `client_deals` — there is no
  evidence of which builder or project a deal belongs to, and ADR-001 prohibits
  inference.

## 2. Architecture decisions

| ADR | Decision |
| --- | --- |
| [018](../architecture/adr/018-builder-portal-separation.md) | The Builder / Developer Portal is a separate external portal with its own login, route root, identity store, HttpOnly-cookie session and Edge Function family, plus a separate internal `/admin/builder-portal` page behind `builder_portal_admin`. Three Solicitor defects corrected at the outset. |
| [019](../architecture/adr/019-builder-domain-model.md) | Builder domain records are separate from `transaction_cases`. One new link slot; six-level hierarchy; distinct developer and builder parties; unsold inventory has no case; shared services used, not duplicated. |
| [020](../architecture/adr/020-shared-portal-primitive-generalisation.md) | Legal-coupled shared primitives are generalised additively (GEN-01 … GEN-13), never duplicated. A constraint widening ships with its consumers. Exactly one exception candidate (`portal_terms_acceptances`), which requires its own ADR. |

## 3. Files created or changed

### Created — documentation (16)

```
docs/builder-portal/README.md
docs/builder-portal/00-baseline.md
docs/builder-portal/01-solicitor-portal-assessment.md
docs/builder-portal/02-admin-vs-portal-boundary.md
docs/builder-portal/03-shared-service-inventory.md
docs/builder-portal/04-builder-domain-boundaries.md
docs/builder-portal/05-organisation-and-access-hierarchy.md
docs/builder-portal/06-roles-and-permissions.md
docs/builder-portal/07-lifecycle-and-milestones.md
docs/builder-portal/08-transaction-case-relationships.md
docs/builder-portal/09-migration-risks.md
docs/builder-portal/10-security-risks.md
docs/builder-portal/11-phase-0-report.md
docs/architecture/builder-cross-portal-current-state.md
docs/architecture/builder-cross-portal-target-state.md
docs/architecture/builder-cross-portal-field-ownership.md
```

### Created — ADRs (3)

```
docs/architecture/adr/018-builder-portal-separation.md
docs/architecture/adr/019-builder-domain-model.md
docs/architecture/adr/020-shared-portal-primitive-generalisation.md
```

### Created — tests (4)

```
tests/builder-portal/fixtures/phase-0-scenarios.json
tests/builder-portal/phase0-existing-architecture.test.mjs          30 tests
tests/builder-portal/phase0-shared-primitive-constraints.test.mjs   22 tests
tests/builder-portal/phase0-builder-domain-boundaries.test.mjs      28 tests
```

### Created — scripts (2)

```
scripts/builder-portal/phase-0-inspection.mjs
scripts/builder-portal/phase-0-reconciliation.sql
```

### Changed (1)

```
package.json   two additive script entries:
                 "test:builder-portal"
                 "builder:phase-0-inspect"
```

**No file under `supabase/migrations/`, `supabase/functions/`, `src/`,
`tests/solicitor-portal/`, `tests/cross-portal-contracts/` or `tests-e2e/` was
created, modified or deleted.**

## 4. Tests added

**80 new characterisation tests**, no dependencies beyond `node:test`.

`phase0-existing-architecture.test.mjs` (30) — the Builder domain is greenfield;
the two builder-named tables are Finance-owned and commission-bearing; the
Solicitor route separation, three-tier nesting, cookie-only transport, hashed
session store, `__Host-` cookie, origin validation, single session resolver and
governance ordering; the admin `ModuleGuard` and Edge Function controls; the
shared backbone inventory; no service-role credential in `src/`; and three known
Solicitor defects characterised so the divergence is demonstrable.

`phase0-shared-primitive-constraints.test.mjs` (22) — each of the twelve
legal-coupled constraints pinned exactly, plus the functions that must move with
each widening. Designed to fail in the phase that performs each widening.

`phase0-builder-domain-boundaries.test.mjs` (28) — an executable specification of
the proposed access resolution (deny by default, downward inheritance, sibling
isolation, specificity ordering, `read_only` clamping, expiry, revocation,
organisation containment, forbidden keys), the lifecycle transition graph
(connectivity, terminal states, exactly three backward paths, invalid transitions,
pre-case statuses), and the outbound governed contracts.

## 5. Commands run and results

### Passed

| Command | Result |
| --- | --- |
| `npm ci` | exit 0 |
| `npm run test:builder-portal` | **80 tests, 80 pass, 0 fail** |
| `npm run builder:phase-0-inspect` | passed; 12/12 legal-coupled constraints confirmed at baseline shape |
| `npm run test:cross-portal-contracts` | 4 tests, 4 pass, 0 fail |
| `npm run security:solicitor-portal` | passed (14 Edge Functions, browser credential boundary checked) |
| `npm run test:e2e:solicitor-portal` | 3 passed, 1 skipped |
| `npm run build` | ✓ built in 58.79 s |

### Failed — all pre-existing, all verified identical on the clean baseline

Each was re-run after `git stash -u` on the unmodified baseline and produced
identical output. None is caused by Phase 0.

| Command | Result | Baseline |
| --- | --- | --- |
| `npm run test:solicitor-portal` | 117 tests, 116 pass, **1 fail** — `phase1-matter-access.test.mjs:36` "all five Solicitor resource functions use the shared matter resolver" | identical: 117 / 116 / 1 |
| `npm run typecheck:portals` | **4 errors** — 3 × `TS2339 Property 'env' does not exist on type 'ImportMeta'`, 1 × `TS2322` in `SolicitorMatterDetail.tsx:805` | identical: 4 errors |
| `npm run lint` | **2120 problems (43 errors, 2077 warnings)** | identical: 2120 (43 errors) |
| `npm run audit:style` | ratchet regressed: hexLiterals 800→846, inlineColorStyles 320→341, fontHardcoded 94→97, cssHexOutsideTokens 15→25 | identical figures |
| `npm test` (vitest) | 352 files: 39 failed / 313 passed; 3515 tests: **53 failed** / 3460 passed / 2 skipped | identical: 39 / 313, 53 / 3460 / 2 |
| `npm run security:test` | exit 1 — `SECURITY_REGISTRY.json` drift (functions on disk and in `config.toml` not in the registry, including `solicitor-portal-compliance` and `solicitor-portal-intelligence`) | identical: exit 1 |

Phase 0 changes no file that any of these checks inspects. The `audit:style`
ratchet in particular scans `src/` and CSS, which Phase 0 does not touch; the
regression predates this branch and is outside Phase 0 scope to repair.

### Blocked / not available

| Check | Reason |
| --- | --- |
| `scripts/builder-portal/phase-0-reconciliation.sql` | Requires a read-only connection to the production database. No database credential is available in this environment. The script is syntax-reviewed and read-only (`BEGIN TRANSACTION READ ONLY`) but **has not been executed**, so the production data volumes it measures are unknown. |
| Supabase migration dry-run | No local Postgres or Supabase CLI stack in this environment. Not needed for Phase 0 (no migration exists), but required from Phase 1. |
| Full `tests-e2e` suite | Only the Solicitor Portal subset was run. The wider suite includes long-running PDF extraction scenarios outside Phase 0 scope. |

## 6. Migration impact

**None.** No migration file was added, and no schema object was created, altered
or dropped. Every schema change discussed is proposed and scoped to a later
phase.

Ten migration risks are recorded (`09-migration-risks.md`). The three that gate
Phase 1:

- **MIG-01 (High, one-way)** — generalising `portal_terms_acceptances` requires
  dropping a `NOT NULL`. Ordered mitigation documented; a separate ADR must
  choose between generalisation and a Builder-specific acceptance table before
  the migration is written.
- **MIG-02 (High)** — the `transaction_case_links` Builder slot must land with
  the guard function **and** the trigger's extended `UPDATE OF` column list in
  one migration, or a cross-client link becomes possible.
- **MIG-03 (High)** — five `cross_portal_*` tables FK to `solicitor_firms`. A
  Builder rollout cannot be flag-controlled until this is generalised, which
  means it would have no rollback path.

## 7. Security findings

Fourteen risks recorded with controls (`10-security-risks.md`). Findings specific
to this baseline:

- **SEC-06 (High)** — `builder_invoices` and `build_progress_payments` carry
  commission amounts under `USING (true) WITH CHECK (true)` RLS for
  `authenticated`. Safe today because they are reached only from the staff
  dashboard; categorically unsafe if any Builder path reaches them. A test
  asserts no `builder-portal-*` function references either table — vacuously
  true now, a real gate the moment the family exists.
- **SEC-01** — the Solicitor legacy raw-token carrier and plaintext
  `session_token` column still exist. Builder is cookie-only from its first
  commit so no such path is ever created.
- **SEC-07** — verified: no file under `src/` reads a service-role credential.
- The deny-by-default statement is binding: **no `DEFAULT_ALLOW_KEYS`
  equivalent and no OR-merge path** in the Builder Portal, ever.

## 8. Risks carried into Phase 1

1. MIG-01 `portal_terms_acceptances` is a one-way schema change needing an ADR
   decision first.
2. MIG-03 the cutover control plane is solicitor-coupled; without it a Builder
   rollout has no rollback.
3. MIG-04 a CHECK widening that outruns its consumers is a live boundary hole
   between the two migrations.
4. SEC-11 cross-organisation visibility on a shared project is unresolved; the
   `party_role` × `access_role` intersection must be settled before any
   project-level grant is implemented.
5. Four open questions on the role model (`06-roles-and-permissions.md` § open
   questions) must be answered before roles are written.
6. `phase-0-reconciliation.sql` has not been executed, so production data volumes
   and anomaly counts are unknown. This must be run before Phase 1 migrations.
7. Pre-existing repository health — 1 failing Solicitor test, 4 portal type
   errors, 43 lint errors, 53 failing vitest tests, a regressed style ratchet and
   `SECURITY_REGISTRY.json` drift — is outside Phase 0 scope but reduces the
   signal available to later phases.

## 9. Rollback approach

Phase 0 is fully reversible with no production impact.

- **Full rollback:** revert the Phase 0 commit. Deleting
  `docs/builder-portal/`, `docs/architecture/builder-cross-portal-*.md`,
  `docs/architecture/adr/018-020`, `tests/builder-portal/`,
  `scripts/builder-portal/` and the two `package.json` script entries restores
  the baseline exactly.
- **Partial rollback:** any single document, test or script can be removed
  independently. `phase-0-inspection.mjs` will report the missing deliverable.
- **No data rollback needed** — no schema object, no row and no runtime path was
  created.
- **No feature flag needed** — nothing executes in production. The new npm
  scripts are opt-in and referenced by no CI workflow.

## 10. Recommended Phase 1 scope

**Phase 1 — Shared primitive generalisation and the Builder identity foundation.**
Deliberately not Builder features. Two things must be true before any Builder
capability can be built safely: the shared services must admit a fifth portal,
and there must be a rollback path.

Recommended contents:

1. **Decide MIG-01 in an ADR** — generalise `portal_terms_acceptances` or create
   a Builder-specific acceptance table. Nothing else in Phase 1 can proceed
   without this answer.
2. **GEN-10** — generalise the five `cross_portal_*` cutover tables and
   `resolve_cross_portal_feature_mode()` to a portal-agnostic organisation
   reference, retaining every existing solicitor row through a compatibility
   adapter. This is the largest single item and the reason Phase 1 is
   infrastructure rather than features.
3. **GEN-01 and GEN-02** — portal terms generalisation, per the ADR decision.
4. **`builder_organisations`, `builder_project_parties` and
   `builder_portal_users`** — identity only. `portal_role` as `text` + `CHECK`,
   not an enum (MIG-09). No sessions, no login, no routes yet.
5. **Register `builder_portal_admin` in `dashboard_modules`** in the same
   migration that first uses it, and repair the `solicitor_portal_admin` gap
   (MIG-10) while the file is open.
6. **Execute `phase-0-reconciliation.sql`** against production with a read-only
   role and record the output before writing any migration.
7. **Extend the Phase 0 tests in the same PR** — every constraint this phase
   widens must have its `phase0-shared-primitive-constraints.test.mjs` assertion
   updated so the new shape is reviewed rather than absorbed.

Explicitly **not** in Phase 1: Builder sessions, login, invitations, routes, UI,
the `transaction_case_links` Builder slot (GEN-09), and the inventory,
construction, variation, defect and progress-claim domains.

## 11. Phase 0 objective coverage

| # | Objective | Where |
| --- | --- | --- |
| 1–2 | Update from main; record the baseline commit | `00-baseline.md` |
| 3 | Inspect the complete Solicitor Portal implementation | `01-solicitor-portal-assessment.md` |
| 4 | Explain external/internal separation | `01` § 1, `02-admin-vs-portal-boundary.md` |
| 5 | Identify the internal administration pattern | `01` § 4, `02` |
| 6 | Reusable shared infrastructure | `03-shared-service-inventory.md` § A |
| 7 | Legal-specific systems not to copy | `03` § C, `01` § 7 |
| 8 | Inspect existing domain models | `builder-cross-portal-current-state.md`, `03` § D |
| 9 | Search for existing Builder functionality | `03` § D; test suite § A |
| 10 | Reuse or extend existing models | `03`, ADR 019, ADR 020 |
| 11 | Document current cross-portal architecture | `builder-cross-portal-current-state.md` |
| 12 | Proposed target architecture | `builder-cross-portal-target-state.md` |
| 13 | Internal admin vs external portal boundary | `02-admin-vs-portal-boundary.md`, ADR 018 |
| 14 | Builder organisation hierarchy | `05-organisation-and-access-hierarchy.md` |
| 15 | Separate builder and developer companies | `05` § separate companies, ADR 019 |
| 16 | Assess Builder portal roles | `06-roles-and-permissions.md` |
| 17 | Transaction lifecycle | `07-lifecycle-and-milestones.md` |
| 18 | Construction milestones | `07` § construction milestones |
| 19 | Cross-portal field ownership | `builder-cross-portal-field-ownership.md` |
| 20 | `transaction_cases` relationship model | `08-transaction-case-relationships.md`, ADR 019 |
| 21 | Migration risks | `09-migration-risks.md` |
| 22 | Security and privacy risks | `10-security-risks.md` |
| 23 | Solicitor problems not to copy | `01` § 6 (NOCOPY-01 … 07) |
| 24 | Architecture Decision Records | ADR 018, 019, 020 |
| 25 | Characterisation tests without behaviour change | `tests/builder-portal/` — 80 tests |
| 26 | Phase 0 report | this document |

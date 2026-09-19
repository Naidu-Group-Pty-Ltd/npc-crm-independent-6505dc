# ADR 020: Legal-coupled shared primitives are generalised, not duplicated

## Status

Proposed. Blocks Phase 1 of the Builder / Developer Portal programme. Recorded
at baseline `a2ec188faa806ff97cb272f7f5a8bcf56b984cb1`. Depends on ADR 018 and
ADR 019.

## Context

Phases 3 to 15 of the Solicitor programme built a genuine cross-portal
platform: a transaction backbone, a transactional outbox, unified milestones and
tasks, canonical conversations, an immutable document service, portal terms and
onboarding, operational observability, and a feature-flag and cutover control
plane.

Most of it is portal-agnostic. A significant minority is not. Inspecting the
migration corpus at this baseline shows twelve shared objects whose column
constraints or foreign keys name the legal domain explicitly:

| Object | Coupling |
| --- | --- |
| `portal_terms_versions.portal` | `CHECK (portal IN ('solicitor'))` |
| `portal_terms_acceptances` | `CHECK (portal='solicitor')`, `solicitor_user_id uuid NOT NULL` |
| `case_milestones.source_domain`, `.authority` | `('legal','finance','command_centre','system')` |
| `case_milestones.visibility`, `case_tasks.visibility` | no `builder_private` member |
| `case_tasks.owner_domain` | `('legal','finance','client','command_centre','shared')` |
| `case_task_assignments.assignee_type` | `('solicitor_user','finance_user','command_user','client','team')` |
| `conversation_participants.participant_type` | `('solicitor_user','command_user','client_user','finance_user','firm','system')` |
| `document_access_grants.audience` | `('solicitor','client','finance','command_centre')` |
| `transaction_case_links` | three fixed domain slots |
| `cross_portal_firm_rollouts`, `cross_portal_rollout_history`, `cross_portal_dual_read_comparisons`, `cross_portal_cutover_approvals`, `cross_portal_reconciliation_runs` | `firm_id uuid REFERENCES solicitor_firms(id)` |
| `firm_ai_policies.firm_id` | `UNIQUE REFERENCES solicitor_firms(id)` |
| `_shared/crossPortalFieldOwnership.ts` | `PortalDomain` has four members |

These are not accidents — each was correct when the only external portal with
these needs was the Solicitor Portal. They become a decision point the moment a
fourth portal arrives.

The tempting response is a parallel Builder set: `builder_terms_versions`,
`builder_milestones`, `builder_conversations`, `builder_document_grants`,
`builder_feature_rollouts`. Each is individually cheap and locally safe. Together
they would fork the platform: two milestone models to reconcile, two message
stores that must not drift, two document services with different chain-of-custody
guarantees, two cutover control planes, and every future cross-portal feature
written twice.

The Solicitor programme has already paid for that lesson once. Phase 8 exists
specifically to replace best-effort message copying between portal-specific
stores with canonical `conversations`, and `conversation_migration_issues` exists
to record what that copying had broken. Creating Builder-specific stores would
recreate exactly the problem Phase 8 was built to remove.

## Decision

Builder **generalises** the shared primitives. It does not duplicate them.

1. **Additive widening only.** Each coupled constraint is widened to admit
   Builder values. No existing value is removed and no existing row changes
   meaning.
2. **A constraint widening ships with its consumers.** Every migration that
   widens a `CHECK` also updates, in the same migration, every function that
   switches on that column. Enumerating those consumers is a prerequisite of
   writing the migration, not a follow-up.
3. **No parallel Builder table** is created for terms, milestones, tasks,
   conversations, messages, notifications, documents, audit, observability or
   feature flags.
4. **Any exception requires its own ADR** stating precisely why the shared
   architecture cannot support the Builder domain. Exactly one candidate is known
   today: `portal_terms_acceptances` (see below).
5. **The cutover control plane is generalised before Builder feature work
   begins.** A Builder rollout with no feature flag has no rollback path.

## Widening plan

| ID | Change | Severity |
| --- | --- | --- |
| GEN-01 | `portal_terms_versions.portal` admits `'builder'` | Low |
| GEN-02 | `portal_terms_acceptances` multi-owner | **High, one-way** |
| GEN-03 | `case_milestones.source_domain` / `.authority` admit `'builder'` | Low |
| GEN-04 | `case_milestones.visibility` / `case_tasks.visibility` admit `'builder_private'` | Low schema, medium consumer |
| GEN-05 | `case_tasks.owner_domain` admits `'builder'` | Low |
| GEN-06 | `case_task_assignments.assignee_type` admits `'builder_user'` | Low |
| GEN-07 | `conversation_participants.participant_type` admits `'builder_user'`, `'builder_org'` | Medium |
| GEN-08 | `document_access_grants.audience` admits `'builder'` | Medium |
| GEN-09 | `transaction_case_links.builder_transaction_id` + guard + trigger | High |
| GEN-10 | Five `cross_portal_*` tables take a portal-agnostic org reference | High |
| GEN-11 | `firm_ai_policies` org reference | Medium |
| GEN-12 | `PortalDomain` admits `'builder'` + Builder field rules | Low type, high review |
| GEN-13 | Add `builder_case_read_model` | Low |

Detail and mitigations: `docs/builder-portal/03-shared-service-inventory.md` and
`docs/builder-portal/09-migration-risks.md`.

## The one acknowledged exception candidate

`portal_terms_acceptances` currently has `solicitor_user_id uuid NOT NULL`.
Generalising it requires dropping that `NOT NULL` — a one-way change, since
restoring it later would require every row to have a non-null value, which
becomes false the moment a Builder row exists.

Two options, to be decided in a dedicated ADR **before** the migration is
written:

- **(a) Generalise.** Add nullable `builder_user_id`, add
  `CHECK (num_nonnulls(solicitor_user_id, builder_user_id) = 1)` as `NOT VALID`
  then `VALIDATE`, create per-owner partial unique indexes, and only then drop
  the composite unique and the `NOT NULL`. Preserves one acceptance store.
- **(b) A separate `builder_terms_acceptances` table.** Avoids the one-way change
  entirely, at the cost of two acceptance stores and two audit surfaces for one
  compliance concern.

This ADR does not pre-decide it. It records that this is the only place where a
Builder-specific table is a legitimate candidate, and that choosing (b) requires
an explicit ADR rather than a quiet implementation choice.

## Ordering constraints

- GEN-01 and GEN-02 gate Builder terms acceptance, which gates Builder login
  governance. They precede any Builder authenticated feature.
- GEN-10 gates every flag-controlled Builder cutover and therefore precedes all
  Builder feature work. It is a phase of its own with its own ADR.
- GEN-03 to GEN-09 gate specific capabilities and may follow the capability that
  needs them, each shipping with its consumers.

## Alternatives rejected

| Alternative | Why rejected |
| --- | --- |
| Parallel Builder tables for every shared concern | Forks the platform; recreates precisely the message-drift problem Solicitor Phase 8 was built to remove; doubles every future cross-portal feature |
| Polymorphic `owner_type` + `owner_id` on every shared table | Removes referential integrity across the whole backbone; the platform's existing safety comes from real foreign keys and database triggers |
| Dropping the `CHECK` constraints entirely | Removes the guardrail that makes an unhandled value impossible to store; the constraints are the reason a widening is a visible, reviewable event |
| Widening constraints now and updating consumers later | The interval between the two is a live boundary hole: a storable value no reader understands, falling through to a permissive default |

## Consequences

- Several Builder phases begin with a generalisation migration rather than a
  feature. This is deliberate sequencing, not overhead.
- Widening migrations touch shared objects, so their blast radius includes the
  Solicitor, Finance and Client portals. Each needs cross-portal contract tests
  before and after.
- `tests/builder-portal/phase0-shared-primitive-constraints.test.mjs`
  characterises all twelve constraints at this baseline, so any change to them —
  intended or accidental — appears explicitly in a failing test.

## Migration and rollback

Every widening is additive and non-destructive. Rollback is to stop writing
Builder values; the widened constraint remains and is inert. The one exception is
GEN-02 option (a), whose `NOT NULL` drop is not reversible once Builder rows
exist — which is precisely why it requires its own ADR first.

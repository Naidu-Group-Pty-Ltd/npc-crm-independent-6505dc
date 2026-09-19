# Builder cross-portal architecture — current state

**Baseline:** `a2ec188faa806ff97cb272f7f5a8bcf56b984cb1`
**Phase:** 0 (documentation and regression harness only)

Companion to `solicitor-cross-portal-current-state.md`, written from the Builder
programme's point of view. It records what exists at the baseline, not what is
proposed.

## Portal topology at baseline

```text
Aurixa Command Centre  (internal, Supabase auth, /)
├── /admin/finance-portal      ModuleGuard finance_portal_admin
├── /admin/solicitor-portal    ModuleGuard solicitor_portal_admin
└── (no Builder administration)

External portals (route siblings of /, own providers, own sessions)
├── /client-portal/*   ClientPortalAuthProvider
├── /finance/*         FinancePortalAuthProvider
├── /solicitor/*       SolicitorPortalAuthProvider
└── (no Builder portal)
```

Three external portals exist. There is no fourth. There is no `/builder` route,
no `builder_portal_admin` module key, no `builder-portal-*` Edge Function and no
Builder table anywhere in the repository.

## Shared backbone as it stands

```text
                         transaction_cases
                                 |
              +------------------+------------------+
              |                  |                  |
        client_deals       purchase_files      legal_matters
       Command Centre         Finance             Legal
              |                  |                  |
              +------------------+------------------+
                                 |
          case_milestones -- conversations -- document_records
               case_tasks -- messages       -- document_versions
                                 |
                          integration_outbox
                                 |
     client_case_read_model  finance_case_read_model
     solicitor_case_read_model  command_case_health_read_model
```

`transaction_case_links` has exactly three domain slots. There is no fourth slot
and no `builder_transaction_id`.

## Construction-related records that exist today

| Record | Owner | Why it is not a Builder domain record |
| --- | --- | --- |
| `build_progress_payments` | Finance / Command Centre | Keyed on `client_deals`, models lender drawdown and commission triggers, not physical build state. Free-text `stage_name`. |
| `builder_invoices` | Finance / Command Centre | Keyed on `client_deals`, carries Aurixa commission amounts. Internal only. |
| `client_deals.build_price`, `land_price`, `construction_loan_type`, `expected_build_start`, `estimated_completion`, `land_settlement_date` | Command Centre | Deal-level construction economics with no builder, project, stage or unit identity attached. |
| `legal_matters.lot_plan`, `title_reference` | Legal | Property identity for a conveyancing matter, not inventory identity. |
| `src/components/deals/BuilderInvoiceLog.tsx` | Internal UI | Staff dashboard component. |
| `transaction_cases.case_type = 'construction'` | Shared | An allowed case type. No construction records hang off it. |

Both builder-named tables carry `USING (true) WITH CHECK (true)` RLS for
`authenticated`.

## Records that do not exist at baseline

Builder organisations · developer organisations · developments · projects ·
project stages · estates · buildings · lots · units · house-and-land packages ·
property inventory · property availability · reservations · temporary holds ·
allocations · builder sales · builder deposits · contract issue status ·
contract execution status · construction cases · construction milestones ·
delays · variations · client selections · progress claims · inspections ·
defects · practical completion · handover · warranty matters · incentives ·
developer rebates · builder settlement readiness.

The Builder domain is greenfield. Nothing needs to be migrated away from; the
risk is entirely in how the new domain attaches to the existing shared services.

## Shared services that are Builder-ready

`transaction_cases` (`case_type` already permits `'construction'`) ·
`transaction_case_reconciliation_issues` · `integration_outbox` and its
dead-letter, delivery-attempt and checkpoint tables · `notification_preferences`
and `notification_deliveries` · `document_records`, `document_versions`,
`document_processing_jobs`, `document_download_audit` · `conversations`,
`messages`, `message_attachments`, `message_receipts` ·
`portal_operational_events` and `portal_operational_alerts` ·
`cross_portal_feature_definitions` · all of `_shared/` session, password, CSRF,
CORS, SSRF and storage primitives.

## Shared services that are legal-coupled

Named shared, constrained to the legal domain. Each requires an additive
widening before Builder can use it. Full detail and severity in
`docs/builder-portal/03-shared-service-inventory.md` (GEN-01 … GEN-13).

| Object | Coupling |
| --- | --- |
| `portal_terms_versions.portal` | `CHECK IN ('solicitor')` |
| `portal_terms_acceptances` | `CHECK portal='solicitor'`, `solicitor_user_id NOT NULL` |
| `case_milestones.source_domain`, `.authority` | no `'builder'` |
| `case_milestones.visibility`, `case_tasks.visibility` | no `'builder_private'` |
| `case_tasks.owner_domain` | no `'builder'` |
| `case_task_assignments.assignee_type` | no `'builder_user'` |
| `conversation_participants.participant_type` | no `'builder_user'` / `'builder_org'` |
| `document_access_grants.audience` | no `'builder'` |
| `transaction_case_links`, `transaction_case_link_history.domain_type` | three fixed slots |
| `cross_portal_firm_rollouts` and four sibling tables | `firm_id → solicitor_firms` |
| `firm_ai_policies.firm_id` | `→ solicitor_firms` |
| `_shared/crossPortalFieldOwnership.ts` `PortalDomain` | no `'builder'` |

## Gap register

| ID | Gap | Architectural impact |
| --- | --- | --- |
| BLD-01 | No Builder domain model exists | Construction state is inferred from Finance drawdown records with no builder, project or unit identity |
| BLD-02 | No Builder portal identity, session or access model | Builders have no way to see or act on their own transactions |
| BLD-03 | No Builder administration surface in the Command Centre | Builder organisations and users cannot be managed |
| BLD-04 | `transaction_case_links` has no Builder slot | A builder transaction cannot join the shared case |
| BLD-05 | Terms, milestones, tasks, conversations and document grants are legal-coupled | Builder cannot use the shared governance and collaboration services without widening |
| BLD-06 | The cutover control plane FKs to `solicitor_firms` | A Builder rollout would have no feature-flag control and therefore no rollback path |
| BLD-07 | `build_progress_payments.stage_name` is free text | No controlled construction-stage vocabulary to reconcile against |
| BLD-08 | `builder_invoices` and `build_progress_payments` carry commission data under permissive RLS | Any future Builder read path is a leak risk |
| BLD-09 | `solicitor_portal_admin` is absent from `dashboard_modules` | The internal module-registration pattern is incompletely implemented and must not be copied |
| BLD-10 | Solicitor permissions default to allow and OR-merge | The permission pattern available to copy is the wrong one; Builder must start from the corrected model |

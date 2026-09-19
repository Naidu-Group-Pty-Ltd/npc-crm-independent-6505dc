# Shared-service inventory and legal-specific service inventory

**Baseline:** `a2ec188faa806ff97cb272f7f5a8bcf56b984cb1`

Every shared object is classified into exactly one of three categories.

| Class | Meaning |
| --- | --- |
| **REUSE** | Works for Builder unchanged. Builder calls it as-is. |
| **GENERALISE** | Conceptually shared but currently constrained to the legal domain. Requires an additive, non-destructive widening. Builder must never create a parallel copy. |
| **LEGAL-ONLY** | Encodes conveyancing semantics. Builder must not import, extend or copy it. |

## A. REUSE — usable by Builder without schema change

### Session and credential primitives (`supabase/functions/_shared/`)

| Object | Note |
| --- | --- |
| `sessionHash.ts` | `hashSessionToken()`, `computeIdleExpiry()` — portal-agnostic |
| `sessionRotate.ts` | rotation helper |
| `password.ts`, `passwordValidation.ts`, `leakedPasswordCheck.ts` | hashing and strength policy |
| `resetTokens.ts`, `recoveryCodes.ts` | reset and recovery |
| `totp.ts`, `webauthn.ts`, `stepUp.ts` | MFA and step-up |
| `csrfGuard.ts` | `enforceCsrf()`, `csrfDenied()` for the admin plane |
| `corsOrigin.ts`, `requestSecurity.ts`, `ssrfGuard.ts`, `publicAbuseControls.ts` | transport hardening and rate limiting |
| `storageSign.ts`, `storageAuthz.ts` | short-lived signed URLs, private buckets |
| `auth.ts`, `auth_v2.ts`, `authz.ts`, `permissions.ts` | Command Centre staff auth for `builder-portal-admin` |
| `notify.ts`, `portal-notification-email.ts` | outbound notification delivery |

Builder writes its own `builderSessionToken.ts` / `builderSessions.ts` /
`builderPortalAuth.ts` **shaped like** the solicitor trio but built on these
shared primitives. That is portal-scoped identity, not duplicated infrastructure:
the security-relevant logic (hashing, expiry maths, CSRF, CORS, password policy)
comes from the shared modules.

### Cross-portal backbone

| Object | Note |
| --- | --- |
| `transaction_cases` | `case_type` already permits `'construction'`. `client_id`, `canonical_property_id`, `jurisdiction`, `shared_lifecycle_status`, `risk_level`, `row_version` all apply unchanged |
| `transaction_case_link_history` | append-only link audit; needs a new `domain_type` value (see GEN-04) but the table itself is reused |
| `transaction_case_reconciliation_issues` | free-text `issue_type`; new Builder issue types need no schema change |
| `integration_outbox`, `integration_dead_letters`, `integration_delivery_attempts`, `projection_checkpoints` | `aggregate_type` and `event_type` are free text |
| `enqueue_integration_event()`, `claim_integration_outbox()`, `replay_integration_dead_letter()` | portal-agnostic |
| `notification_preferences`, `notification_deliveries` | delivery scheduling, quiet hours, claim-and-retry |
| `next_notification_delivery_time()`, `claim_notification_deliveries()` | portal-agnostic |
| `portal_operational_events`, `portal_operational_alerts` | `_portal` is a free-text dimension |
| `record_portal_operational_event()`, `get_portal_operational_health()`, `acknowledge_portal_operational_alert()` | portal-agnostic |
| `document_records`, `document_versions`, `document_processing_jobs`, `document_download_audit` | hash-verified immutable versions, malware scan queue, download audit |
| `guard_immutable_document_version()`, `create_document_record()`, `request_document_version()`, `register_uploaded_document_version()`, `complete_document_processing()`, `record_document_download()`, `set_document_legal_hold()` | portal-agnostic |
| `conversations`, `messages`, `message_attachments`, `message_receipts` | canonical message store |
| `ensure_case_conversation()`, `post_conversation_message()`, `mark_conversation_read()`, `mark_message_read()`, `attach_conversation_message()` | portal-agnostic |
| `case_milestones`, `case_tasks`, `case_task_status_history`, `case_milestone_conflicts` | tables reused; three CHECK lists need widening (GEN-02, GEN-03) |
| `get_case_runway()`, `update_case_task_status()` | `expected_version` concurrency; audience argument needs `'builder'` (GEN-06) |
| `cross_portal_feature_definitions` | free-text `feature_key`; Builder rows are inserts, not schema change |
| `resolve_cross_portal_feature_mode()`, `record_cross_portal_dual_read()` | logic is portal-agnostic; the tables they read are not (GEN-05) |

### Command Centre and client domain

| Object | Note |
| --- | --- |
| `clients` | client identity, owned by Command Centre; referenced by every portal |
| `dashboard_modules`, `user_permissions`, `user_roles` | internal module entitlement for `builder_portal_admin` |
| `ModuleGuard`, `useModulePermissions` | internal route entitlement |
| `document_requirement_templates`, `document_requirement_instances`, `checklist_templates`, `checklist_instances` | generic requirement and checklist machinery |
| `storage_object_bindings`, `data_provenance` | object binding and provenance |

## B. GENERALISE — additive widening required

Each row is a **proposed** Phase 1+ change. None is made in Phase 0.
`tests/builder-portal/phase0-shared-primitive-constraints.test.mjs` characterises
every current constraint below so an accidental change is caught.

| ID | Object | Current constraint | Proposed widening | Risk |
| --- | --- | --- | --- | --- |
| GEN-01 | `portal_terms_versions.portal` | `CHECK (portal IN ('solicitor'))` | add `'builder'` (and, opportunistically, `'client'`, `'finance'`) | Low. Constraint-only; the partial unique index on `(portal) WHERE retired_at IS NULL` already generalises correctly |
| GEN-02 | `portal_terms_acceptances` | `CHECK (portal='solicitor')`; `solicitor_user_id uuid NOT NULL REFERENCES solicitor_portal_users` | widen the CHECK; drop `NOT NULL` on `solicitor_user_id`; add nullable `builder_user_id`; add an exactly-one-owner CHECK; replace `UNIQUE(terms_version_id, solicitor_user_id)` with per-owner partial unique indexes | **Highest.** Dropping a `NOT NULL` is a one-way schema change and the composite unique must be reconstructed without a gap. See `09-migration-risks.md` MIG-01 |
| GEN-03 | `case_milestones.source_domain`, `.authority` | `('legal','finance','command_centre','system')` / plus `'unresolved'` | add `'builder'` | Low. `UNIQUE(source_domain, source_record_id)` continues to hold |
| GEN-04 | `case_milestones.visibility`, `case_tasks.visibility` | `('shared','client','legal_private','finance_private','command_private')` | add `'builder_private'` | Low, but every consumer that switches on visibility must be updated in the same phase or Builder-private rows leak into a default branch |
| GEN-05 | `case_tasks.owner_domain` | `('legal','finance','client','command_centre','shared')` | add `'builder'` | Low |
| GEN-06 | `case_task_assignments.assignee_type` | `('solicitor_user','finance_user','command_user','client','team')` | add `'builder_user'` | Low |
| GEN-07 | `conversation_participants.participant_type` | `('solicitor_user','command_user','client_user','finance_user','firm','system')` | add `'builder_user'` and `'builder_org'` | Medium. `guard_conversation_participant_scope()` and `get_participant_conversations()` must be extended in the same migration, or a Builder participant is admitted with no scope check |
| GEN-08 | `document_access_grants.audience` | `('solicitor','client','finance','command_centre')` | add `'builder'` | Medium. `authorize_document_download()` and `list_accessible_documents()` must be extended together, or Builder grants exist but never authorise |
| GEN-09 | `transaction_case_links` | three fixed slots; `transaction_case_link_history.domain_type CHECK ('legal_matter','purchase_file','client_deal')` | add `builder_transaction_id uuid UNIQUE`; add `'builder_transaction'` to `domain_type`; extend `guard_transaction_case_links()` with the same-client assertion | **High.** The guard trigger and the new column must land in one migration; a column without a guard clause permits a cross-client link |
| GEN-10 | `cross_portal_firm_rollouts`, `cross_portal_rollout_history`, `cross_portal_dual_read_comparisons`, `cross_portal_cutover_approvals`, `cross_portal_reconciliation_runs` | `firm_id uuid REFERENCES solicitor_firms(id)` | introduce a portal-agnostic org reference (`org_kind` + `org_id`, or a `portal_organisations` supertype) while retaining the existing solicitor rows | **High.** Five tables plus `resolve_cross_portal_feature_mode()`. Needs its own phase and its own ADR |
| GEN-11 | `firm_ai_policies.firm_id` | `UNIQUE REFERENCES solicitor_firms(id)` | same org-reference generalisation as GEN-10, or a sibling Builder policy table justified by ADR | Medium |
| GEN-12 | `_shared/crossPortalFieldOwnership.ts` | `PortalDomain = 'command_centre' \| 'client' \| 'finance' \| 'solicitor'` | add `'builder'` and the Builder-owned field rules | Low mechanically; the correctness risk is in the rules, see `docs/architecture/builder-cross-portal-field-ownership.md` |
| GEN-13 | Read models | `client_case_read_model`, `finance_case_read_model`, `solicitor_case_read_model` exist; no Builder equivalent | add `builder_case_read_model` following the same shape | Low |

### Generalisation ordering constraint

GEN-01 and GEN-02 gate Builder terms acceptance, which gates Builder login
governance. GEN-10 gates any flag-controlled Builder cutover. Both therefore
precede any Builder feature work. GEN-03 to GEN-09 gate specific Builder
capabilities and can follow the capability that needs them.

## C. LEGAL-ONLY — must not be copied or extended

### Shared modules

`_shared/legalMatters.ts` · `_shared/legalCriticalDates.ts` ·
`_shared/legalComms.ts` · `_shared/legalDocuments.ts` ·
`_shared/legalIntelligence.ts` · `_shared/legalAudit.ts` ·
`_shared/solicitorPortalAuth.ts` · `_shared/solicitorSessions.ts` ·
`_shared/solicitorSessionToken.ts`

The three `solicitor*` modules are the **structural reference** for the Builder
equivalents but are not shared code: they are bound to `solicitor_portal_users`,
`solicitor_firms` and `solicitor_matter_access`. Builder writes siblings.

### Tables

`legal_matters` · `legal_matter_parties` · `legal_matter_searches` ·
`legal_matter_requisitions` · `legal_matter_disbursements` ·
`legal_matter_critical_dates` · `legal_matter_settlement_tasks` ·
`legal_matter_status_history` · `legal_matter_documents` ·
`legal_matter_threads` · `legal_matter_messages` · `legal_matter_audit_events` ·
`legal_conflict_checks` · `legal_contract_analyses` ·
`legal_compliance_exports` · `legal_audit_verification_runs` ·
`client_legal_case_summary` · `solicitor_case_read_model` ·
`solicitor_firms` · `solicitor_portal_users` · `solicitor_portal_sessions` ·
`solicitor_matter_access` · `solicitor_portal_client_assignments` ·
`solicitor_portal_default_permissions` · `solicitor_onboarding_steps` ·
`solicitor_notification_prefs` · `solicitor_portal_notifications` ·
`solicitor_portal_activity_log`

### Types and values

`solicitor_portal_role` enum (`principal`, `solicitor`, `conveyancer`,
`paralegal`, `assistant`) · `solicitor_firms.practising_states` ·
`SOLICITOR_PERMISSION_KEYS` · the *contents* of `SOLICITOR_FORBIDDEN_KEYS` ·
legal matter type and status enums · conveyancing critical-date types.

The deny-by-default *pattern* behind `SOLICITOR_FORBIDDEN_KEYS` is reused with a
Builder-specific key list; the legal key list itself is not.

### Finance and AML boundary (permanently closed to Builder)

`aml`, `purchase_file_credit_checks`, `purchase_file_voi_verifications`,
`purchase_file_nccp_bundles`, `borrowing_capacity_assessments`, `client_income`,
`client_expenses`, `client_assets`, `client_liabilities`, `client_employment`,
`commission_ledger`, `finance_partner_commissions`, `commission_payouts`,
and every MLRO / SMR record. The Builder Portal has no legitimate read of any of
these under any grant.

## D. Existing Builder-adjacent records at baseline

The only construction-related records that exist today are **Finance and Command
Centre owned** and are internal-only.

| Object | Owner | Contents | Builder Portal exposure |
| --- | --- | --- | --- |
| `build_progress_payments` | Finance / Command Centre | `deal_id`, `stage_number`, `stage_name`, `percentage`, `amount`, `builder_invoice_received/_date`, `submitted_to_lender`, `funds_released`, `paid_to_builder`, `is_commission_trigger` | **None.** Commission-trigger and lender-submission state is internal |
| `builder_invoices` | Finance / Command Centre | `deal_id`, `build_payment_id`, `invoice_amount`, `commission_received`, `commission_amount` | **None.** Carries Aurixa commission amounts |
| `client_deals.build_price` / `land_price` / `construction_loan_type` / `expected_build_start` / `estimated_completion` / `land_settlement_date` | Command Centre | deal-level construction economics | Read-only projection of the non-commercial subset only |
| `legal_matters.lot_plan` / `title_reference` | Legal | property identity | Reference only; Builder owns its own unit identity |
| `src/components/deals/BuilderInvoiceLog.tsx` | Internal UI | invoice log | Internal dashboard only |

Both builder tables carry `USING (true) WITH CHECK (true)` RLS for
`authenticated` — safe for an internal-only table reached through the staff
dashboard, and categorically unsafe to expose to a portal session. This is
recorded as security risk SEC-06 in `10-security-risks.md`.

**No** development, project, stage, estate, building, lot, unit, package,
inventory, reservation, hold, allocation, variation, progress-claim, inspection,
defect, practical-completion, handover, warranty, incentive or rebate record
exists anywhere in the repository at this baseline. The Builder domain is
genuinely greenfield.

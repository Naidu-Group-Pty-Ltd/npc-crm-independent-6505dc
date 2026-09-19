# Existing Solicitor Portal architecture assessment

**Baseline:** `a2ec188faa806ff97cb272f7f5a8bcf56b984cb1`
**Purpose:** establish what the Builder / Developer Portal copies, what it
generalises, and what it must not copy. The repository is the source of truth;
every claim below cites the file that carries it.

## 1. Portal separation model

The platform is one Vite single-page application. Portal separation is achieved
at the **route tree and the authentication transport**, not at the build.

```text
src/App.tsx
├── /client-portal/*    ClientPortalAuthProvider     external
├── /finance/*          FinancePortalAuthProvider    external
├── /solicitor/*        SolicitorPortalAuthProvider  external
└── /                   ProtectedRoute + DashboardLayout   internal Command Centre
    └── /admin/solicitor-portal   ModuleGuard 'solicitor_portal_admin'
```

`/solicitor/*` (`src/App.tsx:359`) is a **sibling** of `/`, not a child. It is
outside `ProtectedRoute` and outside `DashboardLayout`, so no internal sidebar,
command palette, Supabase `auth` session or staff permission hook is in scope.
Nothing under `/solicitor/*` can reach internal Command Centre state, and no
internal navigation surface links to it.

### Route inventory

| Route | Component | Guarding |
| --- | --- | --- |
| `/solicitor/login` | `SolicitorLogin` | public |
| `/solicitor/accept-invite` | `SolicitorAcceptInvite` | public (token in URL) |
| `/solicitor/forgot-password` | `SolicitorForgotPassword` | public |
| `/solicitor/change-password` | `SolicitorChangePassword` | `SolicitorPortalProtectedRoute` |
| `/solicitor/terms` | `SolicitorTerms` | `SolicitorPortalProtectedRoute` |
| `/solicitor/onboarding` | `SolicitorOnboarding` | `SolicitorPortalProtectedRoute` |
| `/solicitor` | `SolicitorDashboard` | protected + `SolicitorPortalLayout` |
| `/solicitor/matters` | `SolicitorMatters` | protected + layout |
| `/solicitor/pipeline` | `SolicitorPipeline` | protected + layout |
| `/solicitor/matters/:matterId` | `SolicitorMatterDetail` | protected + layout |
| `/solicitor/messages` | `SolicitorWorkspacePage kind="messages"` | protected + layout |
| `/solicitor/tasks` | `SolicitorWorkspacePage kind="tasks"` | protected + layout |
| `/solicitor/notifications` | `SolicitorWorkspacePage kind="notifications"` | protected + layout |
| `/solicitor/settings` | `SolicitorWorkspacePage kind="settings"` | protected + layout |
| `/solicitor/settings/security` | `SolicitorSecurity` | protected + layout |

The three-tier nesting is deliberate and is the pattern the Builder Portal
reproduces: **provider → protected route → layout**. Public auth pages sit under
the provider but outside the protected route so an unauthenticated visitor can
reach them; governance pages (change-password, terms, onboarding) sit under the
protected route but outside the layout so a user who has not cleared governance
never sees portal chrome or navigation.

## 2. Authentication and session architecture

### Transport — `src/lib/solicitorPortal.ts`

`invokeSolicitorFunction()` is a bare `fetch`, deliberately not the Supabase
client SDK:

- `credentials: 'include'` so the HttpOnly cookie is attached
- `X-Portal-Request: solicitor-portal` as a portal discriminator
- anon key only; the service role never reaches the browser
- **no** `localStorage`, `sessionStorage`, header token or body token

### Server session store — `_shared/solicitorSessions.ts`

| Property | Value |
| --- | --- |
| Cookie name | `__Host-solicitor_session_token` (HttpOnly) |
| Stored form | SHA-256 `token_hash` in `solicitor_portal_sessions`; the raw token is never persisted |
| Absolute lifetime | 12 hours (`SOLICITOR_SESSION_ABSOLUTE_HOURS`) |
| Idle lifetime | 30 minutes, slid forward on use, clamped to the absolute expiry |
| Revocation | `revoked_at` + `revoked_reason`; single-session and all-session revoke |
| Device binding | `ip_hash`, `user_agent_hash`, optional `device_label` |
| Token entropy | three concatenated UUIDv4 values |

`resolveHashedSolicitorSession()` re-checks `revoked_at` inside the touch
`UPDATE ... WHERE revoked_at IS NULL` and returns `null` if the update matched no
row, so a session revoked concurrently cannot be used by an in-flight request.

### Single resolution point — `_shared/solicitorPortalAuth.ts`

Every `solicitor-portal-*` function calls `resolveSolicitorSession()`. That one
function performs, in order: credential extraction, portal-header and origin
validation, hashed-session resolution, user load, `is_active`/`revoked_at`
check, firm-active check, current-terms lookup, terms-acceptance lookup, and
mandatory-onboarding computation. Nothing downstream re-implements any of it.

### Governance gate

`solicitorGovernanceError()` returns `password_rotation_required`,
`terms_acceptance_required` or `onboarding_required`. `SolicitorPortalProtectedRoute`
mirrors the same order in the browser, but the browser guard is a journey aid —
the server gate is the authorization control. This split must be preserved
verbatim for Builder.

### Origin allow-list — `_shared/solicitorSessionToken.ts`

`validateSolicitorPortalHeaders()` requires both the portal discriminator header
and an `Origin` present in `ALLOWED_ORIGINS` plus a hard-coded fallback list.
A request with no `Origin` is rejected.

## 3. Authorization architecture

### Matter-scoped, deny-by-default access

`resolveSolicitorMatterAccess()` requires a row in `solicitor_matter_access` for
the exact `(solicitor_user_id, legal_matter_id, firm_id)` triple, unrevoked,
with `valid_from <= now` and `valid_until` null or in the future. The matter's
`firm_id` must equal the caller's firm — a null `firm_id` no longer grants
access on the default path.

### Tri-state permission resolution

`resolveTriStatePermissions()` resolves each `(key, level)` as
`allow` > `deny` > baseline, with a deny-by-default baseline. An explicit matter
`deny` beats a baseline allow. `access_role === 'read_only'` forces `edit` and
`delete` to false across every key after resolution.

### Permanent denials

`SOLICITOR_FORBIDDEN_KEYS` hard-denies `income`, `expenses`, `assets`,
`liabilities`, `employment`, `borrowing_capacity`, `commissions`, `smr` and
`aml_restricted` inside `can()`, independent of any stored matrix, and the admin
control plane strips those keys before persisting. This is the mechanism the
Builder Portal reproduces with its own audience-appropriate key list.

## 4. Command Centre administration pattern

| Layer | Control |
| --- | --- |
| Route | `/admin/solicitor-portal` inside `DashboardLayout`, `ModuleGuard moduleKey="solicitor_portal_admin"` (`src/App.tsx:435`) |
| Navigation | `DashboardSidebar.tsx:174`, `MobileSidebar.tsx:161`, `GlobalCommandPalette.tsx:140`, each carrying the same `moduleKey` |
| Server | `solicitor-portal-admin`, `solicitor-portal-invite`, `legal-matters-admin`: `verifyAuth()` + `requireModulePermission('solicitor_portal_admin')` + `enforceCsrf()` |
| Privilege | The service role lives only in these functions; the browser holds the anon key |
| Operations | firms, users, client assignments, global permissions, activity log |

`ModuleGuard` resolves `useModulePermissions(moduleKey)`, which combines the
user-permission grant and the workspace plan entitlement. The browser guard
hides the page; the Edge Function permission check is the authorization control.

## 5. Shared cross-portal backbone

| Concern | Objects |
| --- | --- |
| Shared identity | `transaction_cases`, `transaction_case_links`, `transaction_case_link_history`, `transaction_case_reconciliation_issues`, `guard_transaction_case_links()` |
| Eventing | `integration_outbox`, `integration_dead_letters`, `integration_delivery_attempts`, `projection_checkpoints`, `enqueue_integration_event()`, `claim_integration_outbox()`, `replay_integration_dead_letter()` |
| Milestones and tasks | `case_milestones`, `case_tasks`, `case_task_assignments`, `case_task_status_history`, `case_milestone_conflicts`, `get_case_runway()`, `update_case_task_status()` |
| Messaging | `conversations`, `conversation_participants`, `messages`, `message_attachments`, `message_receipts`, `ensure_case_conversation()`, `post_conversation_message()`, `get_participant_conversations()`, `mark_conversation_read()` |
| Notifications | `notification_preferences`, `notification_deliveries`, `queue_message_notifications()`, `claim_notification_deliveries()`, `next_notification_delivery_time()` |
| Documents | `document_records`, `document_versions`, `document_access_grants`, `document_processing_jobs`, `document_download_audit`, `guard_immutable_document_version()`, `authorize_document_download()`, `set_document_legal_hold()` |
| Governance | `portal_terms_versions`, `portal_terms_acceptances` |
| Observability | `portal_operational_events`, `portal_operational_alerts`, `record_portal_operational_event()`, `get_portal_operational_health()` |
| Cutover control | `cross_portal_feature_definitions`, `cross_portal_firm_rollouts`, `cross_portal_rollout_history`, `cross_portal_dual_read_comparisons`, `cross_portal_cutover_approvals`, `cross_portal_reconciliation_runs`, `resolve_cross_portal_feature_mode()`, `record_cross_portal_dual_read()` |
| Field ownership | `_shared/crossPortalFieldOwnership.ts` |
| Read models | `client_case_read_model`, `finance_case_read_model`, `solicitor_case_read_model`, `command_case_health_read_model` |

Concurrency is enforced with `row_version` plus `expected_version` arguments on
`update_case_task_status()`, `update_document_record()`, `request_document_version()`,
`review_document_version()` and `set_document_legal_hold()`.

Detailed reuse-versus-generalise classification is in
[`03-shared-service-inventory.md`](./03-shared-service-inventory.md).

## 6. Problems in the Solicitor implementation that must not be copied

| ID | Problem | Evidence | Builder requirement |
| --- | --- | --- | --- |
| NOCOPY-01 | `mergePermissions()` defaults missing keys to **allow** and OR-merges baseline with override, so an override cannot reduce a baseline allow | `_shared/solicitorPortalAuth.ts` `DEFAULT_ALLOW_KEYS`, `mergePermissions()` | Builder ships tri-state deny-by-default from its first line of code; no legacy OR-merge is ever written |
| NOCOPY-02 | A plaintext `solicitor_portal_users.session_token` column and a legacy header/body token path still resolve sessions when `credential.source !== 'cookie'` | `_shared/solicitorSessionToken.ts`, `resolveSolicitorSession()` legacy branch | Builder is cookie-only from day one; no plaintext token column and no header/body carrier is ever created |
| NOCOPY-03 | `solicitor_portal_admin` is never inserted into `dashboard_modules`; only `finance_portal_admin` is registered (`20260417193830`) | grep across `supabase/migrations` returns no `dashboard_modules` row for the key | `builder_portal_admin` is registered in `dashboard_modules` in the same migration that first uses it |
| NOCOPY-04 | `logSolicitorActivity()` swallows a failed audit insert and only records a secondary operational event; the mutation still commits | `_shared/solicitorPortalAuth.ts` | High-risk Builder mutations fail closed when the trusted audit write fails |
| NOCOPY-05 | Access-control decisions inside `resolveSolicitorMatterAccess()` are dense single-line statements with the dual-read side effect inlined, which is hard to review | same file | Builder authorization code is written for reviewability; dual-read instrumentation is a separate call |
| NOCOPY-06 | `SOLICITOR_SESSION_ABSOLUTE_HOURS = 12` is generous for a portal holding privileged data and there is no step-up requirement on high-risk mutations | `_shared/solicitorSessions.ts` | Builder lifetimes are set from a documented threat model, not inherited |
| NOCOPY-07 | Legacy `solicitor_portal_client_assignments` remains a live rollback path, so two authorization models coexist | `isMatterAccessV1Enabled()` | Builder has exactly one authorization model; there is no legacy model to roll back to |

## 7. Legal-domain services that must not be generalised

These encode conveyancing semantics and have no Builder analogue. Builder must
not import, extend or copy them:

`_shared/legalMatters.ts`, `_shared/legalCriticalDates.ts`, `_shared/legalComms.ts`,
`_shared/legalDocuments.ts`, `_shared/legalIntelligence.ts`, `_shared/legalAudit.ts`;
tables `legal_matters`, `legal_matter_parties`, `legal_matter_searches`,
`legal_matter_requisitions`, `legal_matter_disbursements`,
`legal_matter_critical_dates`, `legal_matter_settlement_tasks`,
`legal_matter_status_history`, `legal_matter_audit_events`, `legal_conflict_checks`,
`legal_contract_analyses`, `legal_compliance_exports`, `client_legal_case_summary`,
`solicitor_case_read_model`; the `solicitor_portal_role` enum;
`solicitor_firms.practising_states`; and the *contents* of
`SOLICITOR_FORBIDDEN_KEYS` (the pattern is reusable, the key list is not).

Full inventory in [`03-shared-service-inventory.md`](./03-shared-service-inventory.md).

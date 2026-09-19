# PDF Import Phase 11B — Role-Based Operator Permissions

## Objective

Phase 11B defines and enforces role-based permissions for PDF import production
operations.

## Why This Exists

Phase 10 created safe production operator controls. Phase 11A identified that
production rollout requires clear permission boundaries. The system must know who
can view, evaluate, persist, approve, reject, run expensive actions, and access
diagnostics.

## What Phase 11B Does

- Defines canonical PDF import roles and granular capabilities.
- Defines a deny-by-default role→capability matrix.
- Adds role resolution helpers that reuse the existing app auth model.
- Adds a permission evaluator and display helpers.
- Integrates permissions into the operator control rules and executor.
- Gates the Golden Regression console's Evaluate Only / Evaluate + Persist actions.
- Gates operator control action buttons in the panel.
- Adds SQL validation and tests.

## What Phase 11B Does Not Do

- Does not call AI or mutate templates automatically.
- Does not implement monitoring alerts (11C), CI gates (11D), or retention (11E).
- Does not add background jobs.
- Does not weaken RLS or expose service-role secrets.
- Does not create a new role system — it reuses the existing role model.

## Canonical Roles

- **no_access** — unauthenticated, unknown, or explicitly blocked user. No
  capabilities. Rollout: blocked.
- **pdf_viewer** — read-only quality/status/history viewer. Cannot evaluate.
- **pdf_operator** — Evaluate Only + safe metadata builds. Cannot persist, cannot
  make operator decisions.
- **pdf_qa_operator** — operator + mark needs-rerun / manual-review-required + add
  note + export parity preview + manual Visual QA/repair. Cannot mark
  accepted/rejected, cannot persist.
- **pdf_admin** — trusted production admin. All persistence, all operator
  decisions, self-healing execute_safe, and manual AI/apply/reimport permissions
  (still manual-only). No developer diagnostics or system capabilities.
- **developer_admin** — pdf_admin + developer diagnostics (engine admin, storage/
  jobs/logs inspection, hardening). No system capabilities.
- **system_service** — trusted backend service context; only backend system
  capabilities. Never resolvable from the frontend.

## Capabilities

Grouped into view, evaluate, persist metadata, operator decisions, controlled
actions, manual workflow, developer diagnostics, and system. See
`phase-11b-permission-matrix.md` and `pdf-import-permission-policy.schema.json`.

## Permission Matrix

See `docs/pdf-import/phase-11b-permission-matrix.md`. The matrix is deny-by-default
and roles escalate cumulatively (viewer ⊂ operator ⊂ qa ⊂ admin ⊂ developer_admin);
system_service is disjoint.

## Role Resolution

Source order (highest role wins):

1. Trusted service context → `system_service` (backend only).
2. Unauthenticated → `no_access`.
3. JWT `app_metadata.role|roles`, then `user_metadata.role|roles`.
4. Profile `role`/`roles`/`app_role`/`is_admin`.
5. Existing admin guard → `pdf_admin` (never `developer_admin`) unless a stronger
   explicit role was found.
6. No recognized role → `no_access` (deny by default).

In this repository the resolver is fed by the existing `useAuth()` context
(`user.role`, `roles[]`, `isAdmin`) via `usePdfImportPermissions()`. Common app
roles map as: `super_admin`/`superadmin`/`owner` → developer_admin; `admin`/
`sub_admin` → pdf_admin; `qa`/`reviewer` → pdf_qa_operator; `operator`/`staff` →
pdf_operator; `viewer`/`readonly` → pdf_viewer; `client`/`customer`/`user`/`guest`
→ no_access. No real emails are hardcoded.

## Frontend Enforcement

- Evaluate Only is disabled unless the role has `pdf_import.evaluate_only` (and,
  when export parity automation is enabled, `pdf_import.run_export_parity_automation`).
- Evaluate + Persist is disabled unless the role holds every persistence
  capability implied by the selected persist toggles; missing capabilities are
  listed.
- Operator control action buttons are hidden/disabled when the role lacks the
  control's capability; a "Your role does not allow this action" reason is shown.
- Controls are disabled, not hidden — the reason stays visible. No hidden
  execution. Manual-only controls remain manual-only.

## Backend Enforcement

The `template-import-pdf` Edge Function already enforces the security boundary:
every write operation (including `append_meta`) checks authentication and **import
ownership** (`user_id` mismatch → 403), consults `user_roles`/`isAdmin`, and RLS is
enabled on the core tables. Admin pages sit behind the app's `ModuleGuard`.
Phase 11B therefore adds the capability matrix and frontend/control-layer gating on
top of the existing backend enforcement rather than duplicating it. Key-aware
per-capability enforcement inside the Edge Function is a documented follow-up
(safe to add later without changing this model).

## Rollout Recommendation

Initial production mode remains **admin_limited** until Phase 11B confirms that
pdf_admin/developer_admin users are correctly identified, non-admin users cannot
persist, and unknown users are denied — all of which are covered by the resolver,
matrix, and tests here.

## Acceptance Criteria

- docs, matrix, schema, and SQL exist.
- TypeScript permission modules exist and are tested.
- UI and operator controls respect permissions.
- Edge Function writes are permission-guarded via existing ownership/admin
  enforcement (documented).
- tests/build pass; no private artifacts committed.

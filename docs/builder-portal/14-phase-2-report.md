# Builder / Developer Portal — Phase 2 report

External authentication, governance and portal shell.

Baseline: `0551d77` (Phase 1, PR #1749, merged).
Branch: `claude/builder-portal-phase-2-auth-shell`.

Phase 2 delivers the external portal's identity surface and its shell. It
delivers **no Builder business domain** — no projects, transactions, pipeline,
documents or messaging. Nothing is deployed and no production data is touched.

---

## 1. What was built

### Database — one additive migration

`supabase/migrations/20260802000000_builder_portal_phase2_auth_governance.sql`

| Area | Object | Notes |
|---|---|---|
| Login tracking | `builder_portal_users.failed_login_attempts`, `locked_until`, `last_login_at`, `terms_accepted_at` | With a sanity CHECK on the attempt count |
| Onboarding | `builder_onboarding_steps` + `builder_ensure_onboarding_steps()` | Four mandatory steps; seeding is idempotent |
| Session context | `builder_portal_sessions.active_organisation_id`, `builder_guard_session_organisation()` trigger, `builder_select_session_organisation()` | Server-held; the trigger is the backstop |
| Terms | `builder_accept_current_terms()` | Fails closed when no current terms exist |
| Onboarding completion | `builder_complete_onboarding()` | Completes one step or all remaining |
| Password reset | `consume_builder_portal_reset_attempt()` | Atomic; compares a hash, returns no secret |

Every Phase 1 table, constraint, policy and function is reused unchanged. The
migration drops nothing and creates every object idempotently.

### Edge Functions — eight, all new

`builder-portal-{login, logout, verify, accept-invite, forgot-password,
reset-password, change-password, invite}`.

All eight are registered in `supabase/config.toml` and
`supabase/functions-registry/SECURITY_REGISTRY.json`, and all eight are inside
the scoped Deno type-check.

### Shared modules

`_shared/builderSessionToken.ts`, `_shared/builderSessions.ts`,
`_shared/builderPortalAuth.ts`, plus `createBuilderSessionCookie()` /
`createClearBuilderSessionCookie()` appended to `_shared/auth.ts`.

`builderSessions.ts` is a thin adapter over the Phase 1 database functions, not
a second session implementation. Phase 1 keeps ownership of hash-only storage,
expiry ordering, the concurrent-revoke re-check and the membership requirement.

### Frontend

`src/lib/builderPortal.ts`, `src/hooks/useBuilderPortalAuth.tsx`,
`src/components/builder-portal/{BuilderPortalProtectedRoute, BuilderAuthShell,
BuilderPortalLayout, BuilderOrganisationSwitcher}.tsx`, and ten pages under
`src/pages/builder/`.

The `/builder/*` route tree is a **sibling** of the internal Command Centre
tree in `src/App.tsx`, matching the Solicitor Portal's placement. It is not
wrapped in `ProtectedRoute` or `DashboardLayout`.

---

## 2. Solicitor defects deliberately not copied

The mirroring inventory (`13-phase-2-mirroring-inventory.md`) enumerates the
Solicitor files this phase mirrors. These are the documented defects in those
files that the Builder equivalents correct rather than reproduce.

| ID | Solicitor behaviour | Builder behaviour |
|---|---|---|
| NOCOPY-01 | `session_token` / `reset_token` stored in plaintext | Hash-only. The migration asserts no plaintext credential column exists |
| NOCOPY-02 | Session token accepted from a header or request body, and returned in JSON | Cookie only. `resolveBuilderSession(supabase, req)` cannot be handed a body. No function returns a token in JSON |
| NOCOPY-03 | Default-allow permission fallbacks | Deny by default; no `?? true` or `|| true` in the resolver |
| NOCOPY-04 | Audit failures logged and swallowed | `auditBuilderIdentity` returns a boolean. `builder-portal-change-password` revokes the new session and fails the request when its audit write fails |
| NOCOPY-05 | Auth state in `localStorage` / `sessionStorage` | No Builder frontend file touches Web Storage; enforced by test and by the security check |
| NOCOPY-06 | No CSRF on mutating portal endpoints, including logout | Every mutating Builder function passes `enforceCsrf`, logout included |
| NOCOPY-07 | Login checks account state before the password, and declares a dummy hash it never uses | The dummy hash is always verified; account state is evaluated only after the password is proven; every failure returns one generic string |

Two further corrections, beyond the NOCOPY list:

- **Rate limiting precedes the account lookup.** The Solicitor login verifies
  the Turnstile challenge before throttling; the Builder login throttles first,
  so an unauthenticated flood cannot drive one outbound verification per attempt.
- **Password strength goes through the shared validator** rather than a bare
  length check.

---

## 3. Defects this phase's own verification caught

The database verification is real execution against real PostgreSQL, and it
found four defects in work produced during this phase. They are recorded here
because a report that only lists successes is not evidence of anything.

1. **`builder_accept_current_terms` failed on every call.** The function's OUT
   column `version` collided with `portal_terms_versions.version`, making the
   reference ambiguous. Fixed by aliasing the selected columns.
2. **`builder_accept_current_terms` failed again on the acceptance insert.** The
   `ON CONFLICT (terms_version_id, builder_user_id)` inference list is an
   expression context, where plpgsql resolved `terms_version_id` to the OUT
   variable. Fixed by using a bare `ON CONFLICT DO NOTHING` — only one row is
   inserted, so the conflict is the same either way.
3. **`consume_builder_portal_reset_attempt` failed on every call.** Its
   `RETURNING` list referenced `invite_accepted_at` unqualified, colliding with
   the OUT column of the same name. Fixed by table-qualifying every RETURNING
   target.
4. **`builder-portal-login` would have thrown at runtime.** Two telemetry calls
   chained `.catch()` onto a PostgREST builder, which is thenable but has no
   `.catch`. Caught by widening the scoped Deno type-check to the whole Builder
   function family. Fixed by awaiting the call, which cannot reject.

A fifth was found by the contract tests: **`builder-portal-logout` had no CSRF
guard**, matching the Solicitor original. Logout revokes a session, so it is a
state-changing request; the guard was added.

A sixth was found by the same widening: `validatePasswordStrength` returns
`{ isValid, error }`, and three Builder functions read `{ valid, errors }`,
which would have rejected every password. Fixed at all three call sites.

### Governance corrections (follow-up)

Three further defects were corrected after the initial Phase 2 commit, each of
them a place where the Builder implementation had diverged from the Solicitor
template rather than mirrored it. The full before/after mapping is section 7 of
`13-phase-2-mirroring-inventory.md`.

1. **Terms acceptance was not version-exact.** `resolveBuilderSession` read the
   stored `has_accepted_current_terms` column instead of deriving it, as
   `resolveSolicitorSession` does, from an acceptance row for the *current*
   version. Nothing clears that column, so publishing a new terms version left
   every existing user reading "accepted" and they were never re-prompted. Fixed
   by mirroring the Solicitor derivation, including
   `has_completed_mandatory_onboarding`, and pointing both the server governance
   error and the route gate at the derived values.
2. **Terms and onboarding did not validate session ownership.**
   `builder_accept_current_terms` and `builder_complete_onboarding` accepted a
   `(user, session)` pair and stamped `completed_session_id` without verifying
   the session belonged to the user or was still live —
   `builder_select_session_organisation`, in the same migration, already
   performed exactly that check. Added it to both, with the matching 401 mapping
   in `builder-portal-verify`.
3. **The password reset was not atomically single-use.** Consuming the attempt
   and completing the reset were separate statements, so two concurrent requests
   carrying the same valid code both completed. Fixed with the conditional-update
   idiom `builder-portal-accept-invite` already uses: the completing `UPDATE`
   re-asserts `reset_token_hash` and reads back whether it matched a row.

None of the three introduced a new table, function, module, pattern or
abstraction. Two of them reuse an idiom already present in the mirrored
structure; the first is the Solicitor code with the terminology swapped.

---

## 4. Validation

Every result below was produced by actually running the command.

| Check | Command | Result |
|---|---|---|
| App type-check | `npx tsc --noEmit` | **Passed**, no output |
| Lint (Builder files only) | `npx eslint src/hooks/useBuilderPortalAuth.tsx src/lib/builderPortal.ts src/pages/builder src/components/builder-portal src/App.tsx` | **Passed** — 0 errors, 1 `react-refresh` warning |
| Style-token ratchet | `npm run audit:style` | **No new violations.** Counts identical to the pre-change baseline (846 / 341 / 97 / 25) |
| Production build | `npm run build` | **Passed** in 1m 31s |
| Deno type-check (9 functions) | `npm run typecheck:builder-edge` | **Passed** |
| Migration replay (756 migrations) | `npm run builder:db:reset` | **Passed** — 0 Builder defects |
| Phase 1 database verification | `npm run builder:db:verify` | **135/135 passed** |
| Phase 2 database verification | `npm run builder:db:verify:phase2` | **73/73 passed** |
| Builder contract tests | `npm run test:builder-portal` | **223/223 passed** |
| Builder security check | `npm run security:builder-portal` | **Passed** |
| Builder end-to-end (real Chromium) | `npm run test:e2e:builder-portal` | **10/10 passed** |
| Solicitor security check (regression) | `npm run security:solicitor-portal` | **Passed** |
| Supabase types | `npm run builder:types` | Regenerated; 9 table blocks spliced |

### Not passing

| Check | Result |
|---|---|
| Solicitor contract tests | **116/117.** `all five Solicitor resource functions use the shared matter resolver` fails on `solicitor-portal-matters`. **Pre-existing** — verified by stashing every Phase 2 change and re-running, which produces the identical 116/117 |
| Repository-wide lint | **43 errors, all pre-existing.** None are in Builder files; `npx eslint` scoped to the Builder sources reports 0 errors |

### Not available

- **Supabase CLI / Docker.** Unavailable in this environment, so `supabase db
  reset` cannot run. Mitigated with a real local PostgreSQL 16 cluster; the
  reset script replays the full 756-migration corpus against it.
- **282 of 756 historical migrations do not replay** on a plain cluster because
  they depend on Supabase-managed extensions or on objects created outside the
  corpus. This is pre-existing and was measured before any Builder file existed.
  The reset script reports it separately from Builder failures, of which there
  are none.
- **Deployment verification.** Nothing was deployed, so no assertion is made
  about deployed behaviour. The end-to-end suite runs against the real build in
  a real browser with every Edge Function call answered locally.

---

## 5. Constraints observed

- No `apply_migration` was called. No Edge Function was deployed. No production
  user, organisation, rollout row or terms acceptance was created. Supabase MCP
  was used for read-only inspection only.
- `builder_portal_identity_v1` remains `default_mode = 'off'`. The migration
  asserts this and fails if it is ever changed. No rollout row is enabled.
- `builder_invoices` and `build_progress_payments` are untouched and unexposed.
  They are named explicitly in `BUILDER_FORBIDDEN_KEYS` — the "builder" prefix
  makes them easy to mistake for Builder-owned tables, and they are not.
- No Client income, expenses, assets, liabilities, employment, borrowing
  capacity, serviceability, commission, AML/CTF, SMR, MLRO, privileged legal,
  Finance-private, Command-Centre-private or Solicitor-private data is read,
  written or exposed. The end-to-end suite asserts none of these terms appears
  on the Builder dashboard.
- The Builder Portal is not an internal dashboard page. The Phase 0 test that
  asserted no `/builder` route existed was **inverted, not deleted**: it now
  asserts the tree exists *and* is outside `ProtectedRoute` and
  `DashboardLayout`.

## 6. Not started

Phase 3 and the Builder business domain. The portal navigation shows Projects,
Transactions, Pipeline, Messages and Tasks as disabled with an explicit
"available in a later phase" tooltip, rather than linking to placeholders — a
placeholder page reading zero is indistinguishable from a real page reading
zero.

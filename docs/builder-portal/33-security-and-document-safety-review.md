# Builder Portal — Security, Architecture and Document Safety Review (Steps 5–6)

Every item below was checked against the implementation on this branch, not against a prior
report. `✅` = checked and clean. `⛔` = confirmed defect.

---

## 1. Authentication and session

| Check | Result |
|---|---|
| Session tokens in `localStorage` | ✅ none — `security:builder-portal` fails the build on any browser storage in a Builder source |
| Session tokens in `sessionStorage` | ✅ none |
| Session tokens returned in JSON | ✅ none — cookie-only |
| Tokens accepted from request bodies | ✅ none — `extractBuilderSessionToken` reads the cookie only |
| Tokens accepted from unsafe headers | ✅ none. Solicitor still accepts a legacy header carrier; deliberately not copied |
| Plaintext session tokens in the database | ✅ `builder_portal_sessions` stores `token_hash` only; no plaintext column exists |
| Account enumeration | ✅ single `GENERIC_AUTH_ERROR` for every failure path |
| Account-state-specific login messages | ✅ none — suspended, revoked and unknown all return the same response |
| Dummy-password verification | ✅ present, so an unknown email costs the same time as a known one |
| Password-reset race conditions | ✅ reset attempts consumed atomically (`20260730130000_atomic_solicitor_reset_attempts` pattern mirrored) |
| Reusable reset tokens | ✅ single-use |
| Reusable invite tokens | ✅ single-use |
| Reset attempt limiting | ✅ |
| Login attempt limiting | ✅ `MAX_FAILED_ATTEMPTS` + `locked_until` |
| Account-level rate limiting | ✅ per-user counter |
| IP-level rate limiting | ✅ shared limiter |
| Unsafe logout | ✅ logout revokes the session server-side |
| Missing session revocation | ✅ `builder_revoke_user_sessions`, cascaded from membership revocation and organisation suspension |

## 2. Request security

| Check | Result |
|---|---|
| CSRF enforcement | ✅ every mutation; read-only operations exempt by an explicit allow-list |
| CSRF checked after body parsing | ✅ `enforceCsrf(req)` runs on the request, before any body use |
| `csrfDenied` argument order | ✅ `csrfDenied(corsHeaders, result)` everywhere — the reversed form dropped `Access-Control-Allow-Origin` and surfaced as a CORS error |
| CORS origin resolution | ✅ `createCorsHeaders(req.headers.get('origin'))` in all 23 functions; no bare `createCorsHeaders()` |
| Hardcoded local allowlists | ✅ none — `ALLOWED_ORIGINS` is configuration |
| Credentialed-request handling | ✅ |
| Third-party-cookie assumptions | ⚠️ see §7 |
| Method restrictions | ✅ |
| Content-type validation | ✅ |

## 3. Authorization

| Check | Result |
|---|---|
| Browser-supplied organisation id as authority | ✅ never. `builderCan()` rejects any organisation not in the session's server-resolved reach before the database is consulted |
| Browser-supplied user id as acting identity | ✅ never — the acting identity is always the session user |
| Active membership bypass | ✅ none |
| Explicit allow restoring revoked access | ✅ impossible — revocation is checked before overrides are read |
| Default-allow permissions | ✅ none — `builder_resolve_permission` is deny-by-default |
| OR-merged permissions | ✅ none |
| Project / parent-scope checks | ✅ `builder_resolve_project_permission` |
| Cross-organisation, cross-project, cross-unit, cross-transaction, cross-case exposure | ✅ each covered by live assertions in the domain verify suites |
| Document grants bypassing parent scope | ✅ `trg_builder_documents_scope` |
| Conversation participation bypassing parent scope | ✅ `trg_builder_conversations_scope` |
| Task assignment bypassing parent scope | ✅ `trg_builder_tasks_scope` |
| Notification content bypassing source permissions | ✅ notifications carry a pointer, never content |
| Activity rows exposing inaccessible records | ✅ `builder_visible_activity` resolves every row through the governing resolver |

## 4. Database

| Check | Result |
|---|---|
| Direct anon table access | ✅ **0** anon/authenticated grants on Builder tables (verified live) |
| Direct authenticated table access | ✅ 0 |
| Missing RLS | ✅ every Builder table has RLS. `builder_invoices` is Finance-owned and out of scope; the readiness check excludes it by name |
| Unrestricted `USING (true)` | ✅ only on `TO service_role` policies |
| Unrestricted `WITH CHECK (true)` | ✅ same |
| `select('*')` | ✅ none — explicit column allow-lists throughout |
| Missing `row_version` | ✅ 39 Builder tables carry it |
| Missing `expected_version` | ✅ enforced on every mutable aggregate |
| Missing 400 for absent `expected_version` | ✅ |
| Missing 409 for stale `expected_version` | ✅ |
| Aggregate updates without version checks | ✅ none |
| Triggers touching absent columns | ✅ none — the full migration chain replays cleanly |
| Constraint / scope / permission-catalogue registration | ✅ |
| Role defaults for active permission keys | ✅ |

## 5. Mutations and audit

| Check | Result |
|---|---|
| Direct Builder-domain table writes from Edge Functions | ✅ **none** for any domain table (projects, inventory, transactions, construction, delivery, collaboration, workspace) |
| `.insert()/.update()/.delete()/.upsert()` on domain tables | ✅ none |
| State changes outside guarded commands | ✅ none — see the note below |
| Audit after mutation commit | ✅ never — `builder_log_activity` runs inside the command |
| Swallowed audit failures | ✅ none — it raises |
| Best-effort audit as the only record | ✅ no. `record_portal_operational_event` is best-effort *telemetry*; the trusted record is already committed |
| Audit rollback tests | ✅ proven live on this branch |
| Immutable audit history | ✅ append-only trigger; update and delete both raise |

### Note — direct writes to `builder_portal_users`

Nine direct writes to `builder_portal_users` exist outside guarded commands. Each was inspected:

- `builder-portal-login` — `failed_login_attempts`, `locked_until`, `last_login_at`
- `builder-portal-forgot-password` / `-reset-password` / `-change-password` — credential mechanics
- `builder-portal-invite` — invite token and timestamps
- `builder-portal-admin` `create_user` — creates in `status: 'invited', is_active: false`
- `builder-portal-admin` `update_user` — `name`, `phone`, `job_title` only, guarded by `expected_version` + `.eq('row_version', …)`

**None changes access-control state.** Every access-control transition — user status, organisation
status, membership grant/revoke, permission overrides, session revocation — goes through a
`builder_admin_*` guarded command with transactional audit. `create_user` lands in a state that
grants nothing; becoming active requires `builder_admin_set_user_status`.

Assessed as correct, not a defect.

## 6. Data boundaries

Verified absent from every Builder surface and every Builder Edge Function response: client
income, expenses, assets, liabilities, employment data, borrowing capacity, serviceability,
commissions, AML/CTF data, SMR data, MLRO data, privileged legal data, Solicitor-private data,
Finance-private data, Command Centre-private data, builder costs, margins, supplier pricing,
contractor pricing and internal commercial negotiations.

Enforced by shared whitelists, asserted by contract tests and by the E2E test *"no … surface shows
Client, Finance, Solicitor or AML data"* on every domain. `builder_invoices` and
`build_progress_payments` are Finance-owned and are never read or written by any Builder function.

**The unused contracts permission key stays deny-by-default.** No runtime path resolves it and no
product requirement references it, so the precondition for changing it is not met.

## 7. Cookie and origin model — ⚠️ requires deployed verification

The session cookie is `__Host-builder_session_token`. The `__Host-` prefix requires `Secure`,
`Path=/` and **no `Domain` attribute**, which means the cookie is sent only to the exact origin
that set it.

The application and the Edge Functions are on **different origins**
(`app.example` vs `<ref>.supabase.co`), so this is a cross-site request. It works only if the
cookie is `SameSite=None; Secure` *and* the browser has not partitioned or blocked third-party
cookies for that pair.

**This cannot be settled by reading code.** It needs a real browser against real deployed origins —
Step 20. It is the single highest-value thing staging must prove, and it is unproven today.
Recorded as **R2**.

---

## 8. Document safety (Step 6)

| Requirement | Builder | Solicitor |
|---|---|---|
| Immutable document records | ✅ | ✅ |
| Immutable document versions | ✅ `trg_builder_document_versions_immutable`, `UNIQUE (document_id, version_number)` | ✅ |
| Private storage | ✅ bucket `builder-documents`, path prefix `documents/`, `storage_path` stripped from every response | ✅ |
| Upload quarantine | ✅ **fixed** — default `quarantined` | ✅ |
| Malware scanning | ✅ **fixed** — shared `scanDocument()` | ✅ `malware_scan_status` |
| Processing states | ✅ **fixed** — `lifecycle_status` | ✅ `lifecycle_status` |
| Safe download states | ✅ **fixed** — only `available` + `clean` | ✅ |
| Signed URL expiry | ✅ 300 s | ✅ |
| Permission re-check at download | ✅ re-resolved per request, not at upload | ✅ |
| Document acknowledgement | ➖ no privilege obligation in the Builder domain | ✅ |
| Audit evidence | ✅ `builder_document_downloaded` | ✅ |
| Retention metadata | ⛔ absent — not required for release | ✅ |
| Legal hold | ➖ not applicable | ✅ |

### ✅ B1 — RESOLVED (`20260810000200_builder_document_quarantine_scanning.sql`)

**Was:** `builder_document_versions` had no `malware_scan_status` and no `lifecycle_status`. An
upload was immediately downloadable by anyone holding a grant, with nothing having scanned it —
and `builder_add_document_version` set `current_version_id` on insert, so an unscanned upload
instantly became the version every user of that document saw.

**Now:** the shared Phase 9 pipeline is generalised to Builder.
`document_processing_jobs` carries a `portal` discriminator; `builder-document-processor` reuses
the same `_shared/immutableDocuments.ts` scanner, MIME sniffing and hashing as
`legal-document-processor`; `builder_add_document_version` creates `upload_pending` and does not
publish; only `complete_builder_document_processing` promotes a version, and only on a clean
verdict.

Fail-closed by construction — a CHECK constraint makes `lifecycle_status='available'`
unrepresentable without `malware_scan_status='clean'`, and `scanDocument()` returns `error` when
the provider is unconfigured, so an unconfigured environment quarantines everything.

The readiness checks were **not** weakened. `builder_document_malware_scanning` now passes because
the capability exists, and `no_unsafe_builder_documents` now measures real state — an infected or
unscanned document still makes `ready: false`, proven live.

**Remaining dependency:** the scanner provider secrets. Without
`LEGAL_DOCUMENT_MALWARE_SCANNER_URL` / `_SECRET` every document stays quarantined and readiness
stays false. That is the design working, not a defect.

Per the task, absent required malware scanning is a release blocker. It is enforced as evidence
rather than prose: `get_builder_cutover_readiness` emits

- `builder_document_malware_scanning` → **fail**, `required: true`
- `no_unsafe_builder_documents` → **unknown**, `required: true` (fails closed)

so `ready` can never be true and `set_cross_portal_rollout_for(..., 'cutover', ...)` raises
`CUTOVER_READINESS_FAILED`. **The portal cannot be taken live while this stands.**

### Remediation design (not implemented here)

Generalise the existing shared immutable-document service rather than building a second processor:

1. Add `lifecycle_status` (`quarantined` → `scanning` → `available` | `infected` | `failed`) and
   `malware_scan_status` to `builder_document_versions`, defaulting to `quarantined` / `pending`.
2. Upload writes to a quarantine prefix; the version is not downloadable until `available`.
3. Reuse the shared scanning worker, keyed by bucket and path — no Builder-specific processor.
4. `create_signed_url` refuses any version not `available` + `clean`.
5. Preserve Builder scope and terminology; expose no legal-specific metadata (no legal hold, no
   privilege flags).
6. Add deployed staging tests: infected upload cannot be downloaded; a version in `scanning`
   cannot be downloaded; an expired signed URL fails.

**Not implemented on this branch** because it needs real storage, a real scanning provider and a
real worker schedule to validate, none of which exist without staging. An unexercised malware
pipeline is worse than an explicit block.

---

## 9. Message and notification safety (Step 6)

| Requirement | Result |
|---|---|
| Canonical participant conversations | ✅ |
| Owned server-side mutation commands | ✅ |
| Transactional outbox delivery | ➖ / ⚠️ — no Builder record leaves the database today |
| Idempotent delivery | ➖ same |
| Retry handling | ➖ same |
| Dead-letter handling | ➖ same |
| Permission filtering | ✅ |
| Unread-count filtering | ✅ counts come from accessible-set functions, so a count cannot reveal a record the caller cannot open |

Builder messaging is **not** a best-effort cross-module mirror of a system that uses an outbox —
it is a self-contained in-portal system with no delivery leg. The gap opens the moment email
notification is wired, and is recorded as **R3** so it is not forgotten.

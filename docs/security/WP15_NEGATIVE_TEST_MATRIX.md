# WP-15 — Runtime Negative-Test Matrix

Source: the restricted security program's approved negative-test work package.

Every row below must be executed against the **deployed** environment (not
localhost, not staging-of-staging). Each test produces one JSON line:

```json
{"id":"NT-01","target":"market-ai","input":"alg=none JWT","expected":"401","observed":"401","result":"expected_denial"}
```

Store results at `docs/security/wp15-evidence/<date>/negative-tests.jsonl`.
`result` must be `expected_denial` on every row. Anything else blocks launch.

| ID | Target | Attack | Expected result |
|----|--------|--------|-----------------|
| NT-01 | any `verify_jwt=true` function | Forged HS256 JWT signed with wrong secret | 401 `invalid_jwt` |
| NT-02 | any `verify_jwt=true` function | Expired JWT (`exp` in past) | 401 `expired` |
| NT-03 | any `verify_jwt=true` function | JWT with `alg=none` header | 401 |
| NT-04 | `market-ai-*`, `report-qa`, `ai-dashboard-agent` | Anon key with no user JWT | 401 |
| NT-05 | Market AI orchestrator | Arbitrary `Authorization: Bearer <random>` | 401 |
| NT-06 | Any cron-worker function | Missing `X-Cron-Secret` | 401 |
| NT-07 | Any cron-worker function | Wrong `X-Cron-Secret` | 401 |
| NT-08 | Any cron-worker function | Replayed cron secret past `X-Cron-Timestamp` window | 401 `stale_or_replayed` |
| NT-09 | Any internal-service function | Missing `X-Internal-Signature` | 401 |
| NT-10 | Any internal-service function | Signature computed with previous key + `INTERNAL_STRICT_SIGNED=true` after rotation window | 401 |
| NT-11 | `admin-*` functions | Authenticated non-superadmin JWT | 403 `superadmin_required` |
| NT-12 | `finance-portal-*` (any) | Portal token issued to Client A → request for Client B's purchase file | 403 `not_authorized` |
| NT-13 | `client-portal-*` (any) | Portal session for Client A used against Client B endpoints | 403 |
| NT-14 | `report-qa` | Conversation ID belonging to another user | 403 `not_owner` |
| NT-15 | `email-copilot` | `mailbox` param not owned by session | 403 `mailbox_forbidden` |
| NT-16 | `ai-dashboard-agent` low-priv role | Attempt destructive tool (`delete_*`, bulk write) | 403 `step_up_required` or `not_permitted` |
| NT-17 | Step-up gated endpoint | Reuse of consumed step-up token | 401 `step_up_replayed` |
| NT-18 | Commission ledger writer | Duplicate commit for same (payout_id, milestone) | 409 `duplicate_commit` |
| NT-19 | Any external send fn (email/SMS/WhatsApp) | Send twice with same idempotency key within window | 409 `duplicate_send` |
| NT-20 | Storage — direct URL to sensitive bucket object | GET the public-object route **and** anon `list()` on 10 private buckets | neither serves bytes nor enumerates — **implemented, WP-26** |
| NT-21 | Storage — signed URL not issued by this project | Forged signed-URL tokens, plus an anon attempt to mint one | no forged token delivers an object; the publishable key cannot mint — **implemented, WP-26** |
| NT-22 | Public forms (`request-lead-magnet`, marketing) | CSRF: POST without Origin / Referer | 403 |
| NT-23 | Public forms | Missing/failed Turnstile token | 403 `human_verification_failed` |
| NT-24 | `render-source` | ZIP payload > 15 MB base64 | 413 |
| NT-25 | `render-source` | URL host `127.0.0.1`, `2130706433`, `[::1]`, `0x7f.0.0.1`, `169.254.169.254` | 400 `ssrf_denied` |
| NT-26 | `outlook-email-webhook` | Replay identical Graph notification | second call reports the tuple already claimed — **implemented, WP-26; needs `OUTLOOK_WEBHOOK_CLIENT_STATE`, else `skipped`** |
| NT-27 | `outlook-email-webhook` | `clientState` mismatch | 401 — **implemented, WP-26** |
| NT-28 | Metering (Mission Control token spend) | Force Mission Control 5xx → verify graceful degradation, no unpaid generation | 503 with `metering_unavailable` |
| NT-29 | Public quota boundary | Exceed the 30/60s IP quota on `google-places-autocomplete` | 429 — **implemented, WP-26; opt-in via `RUN_QUOTA_TEST` because it bills ~30 Places calls, else `skipped`** |
| NT-30 | Portal session token not issued by this project | Forged token through all four carriers `extractPortalToken` accepts | every carrier 401/403 — **implemented, WP-26** |
| NT-31 | Oversized attachment on ingest endpoints | > declared cap | 413 |
| NT-32 | Enumerate cross-user IDs on finance / clients / reports | UUID from another tenant | 403/404 (never leak existence) |
| NT-33 | `security-step-up` enrolled TOTP user | Missing, malformed, or incorrect `mfa_code` | 401 `mfa_verification_required`; no proof minted |
| NT-34 | `security-step-up` enrolled TOTP user | Reuse a previously accepted 30-second TOTP code | 401 `mfa_code_replayed`; no proof minted |
| NT-35 | Step-up gated endpoint | Present a valid proof with a different/revoked staff session | 401 `step_up_required` |
| NT-36 | `security-step-up` TOTP enrollment confirmation | Use another staff session's enrollment token or an expired token | 401 `invalid_enrollment_confirmation`; no MFA activation |

## Automation hooks

The negative-test runner lives at `scripts/security/wp15-negative-tests.mjs`.
It posts each request via `fetch()` and asserts the expected status codes,
emitting one JSON line per row into
`docs/security/wp15-evidence/<date>/negative-tests.jsonl`.

It implements **17 of the rows in this document**, not all of them. The rest
need a real user session, a provider fixture, or a state the harness cannot
manufacture from outside; each is still listed above so the gap is visible
rather than absent.

---

## Rows added by the 20-item programme (WP-16 … WP-21)

| ID | Target | Attack | Expected result |
|----|--------|--------|-----------------|
| NT-37 | `template-share` (any browser-session fn) | Credentialed request with `Origin: https://negative-test.invalid` | `Access-Control-Allow-Origin` is neither `*` nor the request origin |
| NT-38 | `get-client-data` | UUID belonging to another tenant, ordinary staff token | 401/403/404, and no row (never leak existence) |
| NT-39 | `aml-monitoring` `upsert_alert` | Write naming `resolved_by`, a column no request may set | 401/403 |
| NT-40 | any | Every 5xx seen during the run | no schema detail in any body — no `relation "…"`, `column "…"`, `constraint "…"`, `permission denied for table`, or stack frame |

NT-40 is asserted over whatever responses the run happened to produce rather
than by provoking a failure. Deliberately breaking a production endpoint to
watch it break is not a test worth running against a live system, and this
catches the same regression whenever any other row trips a 5xx.

NT-39 asserts the authorization denial, which is what an ordinary staff token
can reach. Proving the field allowlist itself needs an AML-write session, so
that stays a source-level concern in
`scripts/security/check-mass-assignment.mjs`.

## Rows added by WP-26 — the four items with a gate and no live row

NT-20, NT-21, NT-26, NT-27, NT-29 and NT-30 were declared in the table above
from the beginning and implemented in the runner by nothing, which left items
5, 10, 16 and 20 with a CI gate and no way to ask the deployed system anything
at all. They are implemented now; the rows above carry the detail.

Two of them are conditional, and both conditions are about cost rather than
difficulty:

| Row | Condition | Why |
|---|---|---|
| NT-26 | `OUTLOOK_WEBHOOK_CLIENT_STATE` | Idempotency is checked *after* the `clientState` match — correctly, since a caller who could claim nonces unauthenticated could poison the dedupe table. Proving it needs the live webhook secret, and putting that in CI is a second place for it to leak. |
| NT-29 | `RUN_QUOTA_TEST=true` | The quota is consumed *before* the vendor call, so observing the 429 means ~30 billable Google Places requests first. Per [`API_USAGE_METERING.md`](../integrations/API_USAGE_METERING.md) this deployment may be spending the prime's credential. |

Both record themselves as `skipped` with the reason when the condition is
absent. A `skipped` row does not fail the run. That is deliberate: the
alternative — the row simply not existing in the harness — is what "declared but
unimplemented" meant before, and in the evidence file it is indistinguishable
from a row that passed.

Two rows were also **reworded to what is actually testable**, rather than being
left aspirational:

- **NT-21** said "Client A's signed URL rebound to Client B's path", which needs
  two live portal sessions and a real object in each. What it asserts instead is
  the property underneath: that the signature is *verified* rather than merely
  present — a well-formed token this project never signed must be refused, and
  the publishable key must not be able to mint one.
- **NT-30** said "reuse a portal cookie from another IP after idle timeout". The
  idle-timeout half cannot be manufactured from outside. What it asserts is that
  the token is looked up and validated rather than trusted for being present —
  through all four carriers `extractPortalToken` accepts, because a control that
  holds on the header and not the body is not a control.

## Running it

`.github/workflows/security-negative-tests.yml`, `workflow_dispatch` only.
Runbook: [`runbooks/live-negative-tests.md`](./runbooks/live-negative-tests.md).

`result` is one of `expected_denial`, `FAIL` or `skipped`; the run exits
non-zero iff any row is `FAIL`.

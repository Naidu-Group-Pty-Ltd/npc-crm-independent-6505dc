# Runbook — live negative tests (WP-15 / WP-22)

## What this is for

Every other security check in this repository reads source. This one asks the
**deployed** system whether the controls are actually there.

That distinction is the open item in the programme.
`CODEX_SECURITY_REMEDIATION_TRACKER.md` records `live_negative_test: false` on
**21 of 22** findings. The source is fixed and CI keeps it fixed; nothing has
ever confirmed that the functions running in production behave the way the
source says. A function that was never redeployed passes every static gate in
this repository.

Until this has been run once, "fixed" means "fixed in git".

## Before the first run

Three secrets, on a **`production-verification`** GitHub environment (the
workflow names it so you can put a required reviewer on it — these requests hit
production, and approving each run is the point rather than friction):

| Secret | What it is |
|---|---|
| `SUPABASE_URL` | `https://dduzbchuswwbefdunfct.supabase.co` |
| `SUPABASE_ANON_KEY` | the publishable key — already public, it ships in the browser bundle |
| `NON_SUPERADMIN_JWT` | an access token for an **active, non-superadmin** staff user |

Only the third needs care. It must be a real, currently-valid token for a user
who is *not* a superadmin — that is the whole point of NT-11 and NT-38, which
check that an authenticated-but-unprivileged caller is refused. A superadmin
token turns both rows green while proving the opposite of what they claim, so
this is the one input where being wrong is worse than being absent.

Access tokens expire. Expect to refresh this before each run; a stale token
shows up as NT-11 returning 401 instead of 403.

## Two optional secrets, each unlocking one row

Neither is required and the run is honest without them — the row records itself
as `skipped` with the reason, which lands in the evidence next to the rows that
did run.

| | Unlocks | Why it is optional |
|---|---|---|
| `OUTLOOK_WEBHOOK_CLIENT_STATE` | **NT-26**, webhook replay/idempotency | Idempotency is checked *after* the `clientState` match — correctly, since a caller who could claim nonces unauthenticated could poison the dedupe table. So proving it needs the live webhook secret, and adding it here is a second place for that secret to live. Weigh that against one row. |

## Running it

Actions → **Security — live negative tests (WP-15)** → *Run workflow*.

Two optional inputs pick which cron-worker and internal-service function get
probed; the defaults (`market-updates-digest`, `agent-task-runner`) are fine
unless one of those has been retired.

### The one input that costs money

**`run_quota_test`** (default off) enables **NT-29**, which proves the public
rate limit by exhausting it.

The quota on `google-places-autocomplete` is 30 requests per 60 seconds per IP,
and it is consumed *before* the vendor call — which is the property being
checked, and also why observing the 429 means about thirty billable Google
Places requests first. A few cents. Per
[`API_USAGE_METERING.md`](../../integrations/API_USAGE_METERING.md) this
deployment may be spending the **prime's** credential rather than its own, so
the cost may not land where you expect.

Turn it on when you want to confirm rate limiting is deployed. Leave it off for
routine runs. It is an input rather than a default precisely so the decision is
made each time, by a person.

## Reading the result

Each row prints one JSON line and lands in
`docs/security/wp15-evidence/<date>/negative-tests.jsonl`, uploaded as an
artifact for 90 days — including on failure, which is when it matters most.

```json
{"id":"NT-11","target":"admin-user-management","input":"authenticated non-superadmin JWT","expected":"403","observed":"403","result":"expected_denial"}
```

**`result` must be `expected_denial` on every row.** The job fails otherwise.

A `FAIL` means one of three things, and they need telling apart before anything
else happens:

1. **The control is genuinely missing in production.** Most likely cause: the
   function was never redeployed after the source fix. Check the deploy history
   for that function first — this is the failure mode the whole exercise exists
   to find.
2. **The credential is wrong.** A superadmin `NON_SUPERADMIN_JWT`, or an expired
   one. NT-11 and NT-38 are the rows that show this.
3. **The target moved.** A renamed or retired cron/internal function returns 404
   rather than 401, which reads as a failure and is not one. Fix the input, not
   the code.

## After a run

Update the `live_negative_test` flags in
`docs/security/CODEX_SECURITY_REMEDIATION_TRACKER.md` **from the run output**,
not by hand. A flag set from memory is worth less than the `false` it replaced,
because it looks like evidence.

## What it does not cover

Six of the original 36 matrix rows plus the four added by this programme. The
rest need a real portal session, provider fixtures, or a second tenant, and
adding them is per-row work. The matrix is the backlog; this harness is the part
that runs today.

Notably absent: everything requiring a client-portal or finance-portal session
(NT-12, NT-13, NT-15), storage signed-URL rebinding (NT-20, NT-21), and the
step-up replay rows (NT-17, NT-33 … NT-36) — those last are covered at source by
six dedicated gates in `scripts/security/`, but source is not deployment, which
is the entire premise of this document.

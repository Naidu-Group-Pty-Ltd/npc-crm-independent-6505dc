# Identity verification inside NPC — the Didit Standalone APIs

> **This IS the active integration.** New attempts run NPC's own camera
> journey and the three Standalone endpoints. The hosted session
> ([`DIDIT_IDV_INTEGRATION.md`](./DIDIT_IDV_INTEGRATION.md)) exists in the code
> and is **not** active: `didit_standalone` is the active provider row and
> `didit` is not.
>
> **`save_api_request` is `true` as of 2026-08-14, and that is a reversal.**
> It was `false`, on the reasoning that NPC's private buckets are the evidence
> store and Didit should keep no copy. The consequence nobody had weighed is
> that a completed verification then existed *nowhere* on the provider's side:
> nothing to audit, nothing to look up, nothing in the Business Console. Each
> request is now persisted as an API-type session and appears under **Manual
> Checks**, correlated to the applicant by a person-scoped `vendor_data`.
>
> **Two things follow, and both are handled rather than assumed.** Didit now
> **retains the customer's document images and selfie**, so NPC's buckets are
> no longer the only copy — a privacy position worth being deliberate about,
> not a side effect. And the image fields come back as **short-lived media
> URLs instead of inline base64**, which is why `resolveReferenceImage` exists:
> without it Face Match would never run and every attempt would settle as a
> referral.
>
> These are **not** session-based verifications, so they do **not** appear
> under Verifications → User Verifications or Directory → Users. That screen
> belongs to `POST /v3/session/`. Manual Checks is the right place to look.

**Read this before touching anything in the identity path.** The customer's
whole experience, the money, and the attempt allowance all hang off decisions
recorded here, and three of them are counter-intuitive.

The hosted flow is [`DIDIT_IDV_INTEGRATION.md`](./DIDIT_IDV_INTEGRATION.md).
It is not deleted and must not be — see [Legacy](#legacy-what-is-still-wired-and-why).

## The shape

```
customer
  → NPC client portal
  → NPC camera (getUserMedia, in the page)
  → private Supabase Storage    aml-documents / aml-biometrics
  → aml-verification-processor  (Edge Function, holds the credential)
  → POST /v3/id-verification/     ┐  save_api_request=true
  → POST /v3/passive-liveness/    ├  three separately billed calls,
  → POST /v3/face-match/          ┘  each persisted under Manual Checks
  → composeStandaloneOutcome      (one identity position)
  → aml.verification_checks       (canonical row)
  → portal-safe state
```

The browser never calls Didit, never holds the key, never sees a score or a
threshold, and never opens a window. There is no hosted workflow journey on
this path — no `verification_url`, no callback and no SDK — and the
authenticated response IS the authoritative result. A persisted request can
emit `status.updated`; NPC acknowledges and ignores those (below).

Each request is persisted on Didit's side and visible in the Business Console
under **Manual Checks**, grouped by the person-scoped `vendor_data`
(`npc:<case>:<party|primary>`). They are not session-based verifications, so
they do not appear under Verifications → User Verifications.

| Module | What it owns |
| --- | --- |
| `_shared/aml/identityDocuments.pure.ts` | the four documents, and which sides each needs |
| `_shared/aml/providers/diditStandalone.pure.ts` | reading responses, sanitising them, composing one outcome |
| `_shared/aml/providers/diditStandaloneClient.ts` | the three multipart calls. The only holder of `DIDIT_API_KEY` on this path |
| `_shared/aml/standaloneVerification.ts` | the sequence: claim, fail-fast, settle |
| `aml-verification-processor` | runs it, off the customer's request |
| `aml-client-portal` | `prepare_verification_attempt`, `submit_verification_attempt` |
| `IdentityVerificationStep.tsx` | choose → brief → front → back? → selfie → uploading → checking |

## Three things that keep biting

### 1. These calls cost money, and there is no idempotency key

Didit bills per **200 response**. `vendor_data` is documented as an opaque
correlation string and **explicitly not** as an idempotency key — do not treat
it as one. Everything below follows from that:

- **One owner per attempt.** `claimCheck` is a conditional `UPDATE` from a
  queued state to `processing`. A double tap, a second tab, a re-fired cron
  sweep and a redelivered outbox event all lose it and walk away.
- **Nothing retries a paid call.** The outbox machinery retries a *throwing*
  consumer ten times with backoff. For the self-hosted service that is correct;
  here it would be ten unattended purchases of one verification. The standalone
  branch in `verificationConsumer.ts` therefore **returns without throwing**,
  whatever happened. Do not "fix" that.
- **An ambiguous timeout stops the sequence.** The request left and we never
  learned what happened to it, so the billing state is unknown. It is recorded
  `provider_error_category = 'timeout'` with `billing_unknown: true`, consumes
  no attempt, and nothing re-sends it. A stale claim is retired to
  `technical_failure` by the sweep rather than re-run, for the same reason.

The controlled retry is a **fresh customer submission**, which consumes nothing
from the failed attempt.

### 2. Both thresholds are required, and a missing one means NOT READY

`DIDIT_LIVENESS_THRESHOLD` and `DIDIT_FACE_MATCH_THRESHOLD` (0–100). The
endpoints default to **30**, which Didit's own documentation calls permissive.
Inheriting that would make NPC's compliance position a vendor default nobody
chose, so `getStandaloneIdvProvider` **throws** when either is missing or out of
range, the portal reads that as unavailable, and no biometric is collected.

`DIDIT_WORKFLOW_ID` and `DIDIT_WEBHOOK_SECRET` are **not** required here. There
is no workflow on this path, and the endpoints answer synchronously — **that
response is the authoritative result**. Requiring either would refuse a
correctly configured deployment. They remain required by the *hosted* adapter.

### A persisted request DOES emit a webhook, and NPC ignores it

`save_api_request=true` persists each call as an API-type session, and Didit
emits `status.updated` for a persisted session. So `didit-webhook` receives
events for Standalone checks, and it must do **nothing** with them.

This architecture has exactly one authoritative result: the synchronous
response `standaloneVerification.ts` already composed. Settling from a webhook
would be a second authoritative path racing the first, able to overwrite an
attempt that has already been decided — including one already settled and
counted. There is deliberately no branch that could.

What happens instead: the hosted lookup (`provider = 'didit'`) does not match a
`didit_standalone` row, and rather than reporting the routine case as an
alarming `unknown_session`, the receiver recognises it —
`standalone_session_ignored`, acknowledged **202** so Didit stops retrying,
`processed: false`, recorded against the check for visibility, and no decision
fetched, no status written, no attempt consumed.

Both thresholds are written onto every attempt (`outcome_detail.standalone
.thresholds_applied`) so a reviewer months later can see the policy in force on
the day.

### 3. An Australian driver licence has no MRZ

`invalid_mrz_action` and `inconsistent_data_action` both default to `DECLINE`.
A licence carries no ICAO machine-readable zone at all, so the default risks
declining a valid document for lacking a feature it was never issued with — and
a decline spends the customer's attempt and records an identity failure.

Both are sent as `NO_ACTION` and the corresponding warnings are mapped to a
**referral** in `diditStandalone.pure.ts` instead. Referring cannot produce a
false pass, which is the only outcome that would be worse.

## Reading a response

**A 200 is not a pass.** All three endpoints answer 200 with
`status: "Declined"`. Read the feature block.

**Unknown is never passed.** A missing block, an unparseable status, or a
document classified as something the customer did not select is a referral —
never a verification, and never (on its own) a finding against them.

**Unreadable is not failed.** `COULD_NOT_DETECT_DOCUMENT_TYPE`,
`NO_FACE_DETECTED`, `PORTRAIT_IMAGE_NOT_DETECTED` and a 400 carrying
`COULD_NOT_RECOGNIZE_DOCUMENT` all mean "we could not look", which is fixed by
taking the photograph again. They record `capture_unusable`, consume **no**
attempt, and the portal asks for a retake. `unreadable` beats `declined` in the
roll-up for exactly this reason.

### The composition rule

| Outcome | When |
| --- | --- |
| `verified` | all three Approved **and** the detected document is consistent with what the customer chose |
| `failed` | a step Declined on evidence — document security, liveness, face match |
| `pending` → `capture_unusable` | any step could not examine the capture. No attempt spent |
| `manual_review` → `referred` | everything else: indeterminate, a step that never ran, a classification mismatch |

**Identity Verified is not AML approved.** It is not a service gate, not a risk
position and not a screening result. Do not connect them.

### The check the hosted flow never needed

The hosted session restricted the capture with `expected_details`, so the
provider enforced country and document type on its own screen. The Standalone
ID endpoint has **no such parameter** — it classifies the document and tells us
what it found. So the restriction became a comparison after the fact
(`documentConsistency`): a mismatch can never become Verified, and it is not a
finding against the customer either, so it goes to a human.

## Storage and evidence

The browser never chooses a path. `prepare_verification_attempt` mints
`{caseId}/verification/{attemptId}/…` and stores it on the row; submission sends
an **attempt id and nothing else**. Both buckets are private and neither has
ever been public; the selfie stays in `aml-biometrics`, whose access policy is
tighter and whose reads are logged.

Nothing image-shaped is persisted **by NPC**. `portrait_image`, `front_image`
and `back_image` are stripped **by name** before anything reaches
`outcome_detail`, on top of the size-based sweep in
`verificationEvidence.pure.ts` — the name list exists because a short base64
string is still a face, and it now also catches the media **URL** those fields
carry under `save_api_request=true`, because a URL that fetches a face is as
disclosing as the face. Extracted name, address, date of birth and MRZ are
stripped too: they already live in the case record, entered by the customer and
adjudicated by staff.

The ID portrait is fetched or decoded **into server memory** as the face-match
reference and discarded. It is never persisted, logged, or returned to a
browser.

### Didit holds a copy too, and that is deliberate

`save_api_request=true` means the provider **retains the document images and
the selfie** against the persisted request. NPC's private buckets are no longer
the only copy, and that is a disclosure to a third party (and, since Didit
processes in the EU, a cross-border one) rather than an implementation detail.
It is the price of having a provider-side audit trail at all, and it was
accepted deliberately on 2026-08-14.

What follows from it: the biometric consent copy and the retention position in
this document describe what NPC destroys and when. They do **not** govern
Didit's own copy, which is subject to the retention configured on the Didit
account. Anyone reasoning about the §18 clock should read both.

## Retention

The mechanism exists. **The duration does not, and this programme did not
invent one.**

### Why it is not a day counter

`20260726140000_aml_retention_triggers.sql` records the programme's §18
position and it is explicit:

> "Retention must not be implemented as automatic deletion seven years after
> upload." The clock starts at a recorded TRIGGER EVENT — relationship end,
> occasional transaction completion, transaction date, investigation
> completion, report completion, legal-hold release — and **a record with no
> recorded trigger has not started its clock and is never disposal-eligible.**

So "delete N days after capture" is not a smaller version of NPC's policy; it
is the thing that policy was written to forbid. It would also contradict what
NPC has already told these customers. The biometric consent (catalogue 2026.2)
says their facial image is *"kept for the record-keeping period required by
anti-money laundering law, **measured from the end of our business relationship
with you**, and are then destroyed"* — §18's trigger model, not a counter from
upload.

### Both clocks, and it fails closed

`captureRetention.pure.ts` deletes only when **every** one of these holds:

| Condition | Otherwise |
| --- | --- |
| `AML_IDV_CAPTURE_RETENTION_DAYS` set, integer > 0 | `not_configured` — nothing is deleted anywhere |
| The case has a live `aml.retention_triggers` row | `awaiting_retention_trigger` (§18) |
| Its `minimum_retention_date` has passed | `within_aml_retention` |
| Settled ≥ that many days ago | `within_capture_window` |
| `processing_status` is a settled state | `in_flight` |
| `status` is not `referred`/`pending`/`in_progress` | `under_review` |
| No active `aml.legal_holds` row on the case or the check | `legal_hold` |
| Provider is the Standalone one, with recorded objects | `not_eligible` / `no_captures` |

Every unknown is a retain: an unparseable timestamp, an unrecognised state, a
missing settlement time. There is one path to a deletion and eleven to a
retain, and that asymmetry is the design — keeping evidence a week too long
costs storage; destroying it a week too early costs a record that cannot be
reconstructed.

The variable has **no default**. Absent means "NPC has not decided", which is
a reportable state, not a licence to apply a number somebody made up. Zero is
refused as firmly as a negative.

### The worker

`aml-idv-retention`, signed-internal only (`pg_cron`, `aml-verification`,
`aml-records`), daily at 03:17 UTC. Deliberately **not** on the verification
processor's one-minute schedule: processing a submission and destroying
evidence are different responsibilities with different blast radii.

- `{"dry_run": true}` reports what would go and deletes nothing. Run this
  first, always.
- The only thing it reads off the request body is `dry_run`. A caller cannot
  name a bucket, a path, a case or a check — arbitrary deletion is
  unrepresentable, not merely refused.
- Every object is re-checked with `mayDeleteObject` before removal: the bucket
  must be `aml-documents` or `aml-biometrics`, and the path must sit under
  `{caseId}/`. Traversal is refused, not normalised.
- A pass that removed some objects records `partial`, leaves `capture_deleted_at`
  NULL, and the next pass finishes it. An object already gone counts as
  removed, so retrying converges.

### The audit record

Three columns (`capture_deleted_at`, `capture_cleanup_status`,
`capture_retention_days_used`) plus
`outcome_detail.standalone.capture_retention`. Together they answer *which
attempt, when, and under which policy* — and carry no image, no base64, no
signed URL and no name, so they cannot reconstruct what was destroyed.

## Attempts

`1 initial + 2 retries = 3 consumed`, unchanged, counted by
`aml.verification_attempts_used()` which counts `attempt_consumed` rows only.

**Consumes nothing:** preparing, minting upload URLs, uploading, retaking,
cancelling, refreshing, a network failure, a timeout, a 429, a 5xx, a
credential or credit failure, a request Didit refused, an unreadable capture.

**Consumes an attempt:** a completed substantive outcome — a document that
failed its security checks, a liveness rejection, a face that did not match, or
a referral. Only `canonicalOutcome` decides, and it is shared with the
self-hosted path and the staff re-run so the three cannot drift.

## The dispatcher that was missing

`aml.verification.requested` has been emitted since `20260831000100` and had a
consumer the same day — but **nothing in this project has ever driven
`cross-portal-outbox-worker`**. Production `cron.job` holds 40 schedules and
names it in none of them. The self-hosted provider has never been active
(0 rows ever), so nobody had met it. A submission would have sat `queued` for
ever.

So: the portal dispatches `aml-verification-processor` directly (the wait is
seconds), **and** pg_cron runs its sweep every minute (a reclaimed isolate
cannot strand anybody). The outbox trigger now fires on `UPDATE` as well as
`INSERT`, because a draft becomes queued by an update and previously emitted
nothing. `idempotency_key` is per row, so it still emits exactly once.

## Legacy: what is still wired, and why

The hosted adapter, `start_hosted_verification`, `didit-webhook` and
`SecureIdentityCheck` all remain. On 2026-08-08 two hosted checks were still
`processing` in production, and removing the adapter would strand their
decisions. **No new attempt uses any of it**: the portal renders the capture
journey, and the older single-shot capture ops answer `capture_flow_superseded`
under the Standalone provider.

### The exact drain condition

Column and status names read off production, not guessed:

```sql
SELECT count(*) AS still_in_flight
  FROM aml.verification_checks
 WHERE provider = 'didit'
   AND check_type = 'electronic_idv'
   AND processing_status IN ('submitted', 'queued', 'processing')
   AND superseded_at IS NULL;
```

Measured 2026-08-11: **2**. Both were created on 2026-08-08 and have sat
`processing` since. A Didit hosted session lives seven days, so they expire on
or about 2026-08-15; `start_hosted_verification` reconciles and retires an
expired session when a customer returns, and neither has consumed an attempt.

Remove the hosted infrastructure only when that query has returned **0 for a
full safety window after the last hosted attempt was created** — two weeks is
the sensible floor, since it covers the seven-day session lifetime twice. At
that point `DIDIT_WORKFLOW_ID` and `DIDIT_WEBHOOK_SECRET` can go too, along
with `didit-webhook`, `start_hosted_verification`, `SecureIdentityCheck`, the
hosted adapter and `didit.pure.ts`'s decision mapping.

## Cost

`cost_per_unit_cents` is not decorative: `runWithMetrics` adds it to
`aml.provider_metrics_daily.cost_cents_sum` once per **successful provider
call**, and `AmlConfiguration.tsx` renders that sum as "30-day cost". The unit
is one call, not one verification.

Didit prices the three endpoints separately, per successful request, in **USD**
(docs.didit.me/getting-started/pricing, read 2026-08-11):

| Endpoint | Price |
| --- | --- |
| `/v3/id-verification/` | USD 0.20 |
| `/v3/passive-liveness/` | USD 0.05 |
| `/v3/face-match/` | USD 0.05 |

One integer cannot express three prices, so the exact figures live in
`config.standalone_unit_costs_cents` and the orchestrator passes the matching
one to `runWithMetrics` per step. The variable fail-fast sequence therefore
accounts correctly **by construction**: an attempt that stops at a declined
document records 20 and nothing more, because the later calls genuinely never
happened. No estimate, no average, nothing to keep in step by hand.

The column itself carries the dearest single call (20) as a fallback for any
caller that does not pass a per-step cost — at a per-call unit, a fallback that
errs high is safe for budget reporting and one that errs low is not.

**Known limitation.** `currency` is `USD` because that is what Didit bills, and
the metrics roll-up sums `cost_cents_sum` with no currency dimension. Every
other provider in it is currently 0, so this is the first real figure and the
first mixed currency. Converting is a finance decision; changing that
aggregation was out of scope here and is recorded rather than silently
mislabelled as AUD.

## Diagnosing a provider that will not start

`configured` is one boolean because the customer's answer is one word. An
operator's is not: `standalone_readiness` on the staff readiness endpoint
separates the faults that look identical from outside.

| Field | Values |
| --- | --- |
| `api_key_present` | true / false |
| `liveness_threshold` | `ok` / `missing` / `invalid` |
| `face_match_threshold` | `ok` / `missing` / `invalid` |

`missing` and `invalid` are different mistakes with opposite fixes — a secret
nobody set, versus one set to `0.6` on a 0–100 scale. Presence and validity
only; no value crosses the boundary, and none of it is ever sent to the client
portal, which keeps saying *"We couldn't complete the secure check just now.
Nothing has been used up."*

Runtime failures are separated too, on `provider_error_category`:
`provider_not_configured`, `insufficient_credits`, `rate_limited`, `timeout`,
`provider_unavailable`, `provider_rejected_request`, `storage_unreadable`,
`capture_unusable`, `worker_failure`.

## Sandbox vs live

A Didit **sandbox key returns mock data without billing or processing**. The
switch is the key, not a URL — same host, same endpoints.

| Setting | Staging | Production |
| --- | --- | --- |
| `DIDIT_API_KEY` | sandbox key | live key |
| `DIDIT_API_BASE_URL` | unset | unset |
| `DIDIT_STANDALONE_TIMEOUT_MS` | optional | optional |

Never put a key in source. To exercise the three endpoints for real:

```bash
DIDIT_SANDBOX_API_KEY=… npx vitest run \
  src/lib/aml/diditStandaloneSandbox.integration.test.ts
```

That test is gated on `DIDIT_SANDBOX_API_KEY` and skips without it, so CI and
a plain `npm test` cannot reach a paid API. The variable is deliberately not
`DIDIT_API_KEY`: a test reading the production variable would spend live
credits the moment somebody exported it for an unrelated reason.

## Real-device status

Chromium desktop and a 390×844 Chromium mobile viewport are covered by
automated QA with a synthetic camera. **iPhone Safari, Android Chrome and iPad
Safari are NOT TESTED.** A synthetic camera says nothing about permissions,
orientation, lens selection, HEIC or backgrounding.

[`IDV_DEVICE_QA_CHECKLIST.md`](./IDV_DEVICE_QA_CHECKLIST.md) is the gate. It
blocks **activation**, not merge.

## Deployment and activation order

Implementation and activation are separate on purpose. After merge and deploy
the provider is still **inactive** and no customer's journey has changed.

1. **Merge** once the gates pass.
2. **Migrations**: `20260911000000` (draft state, error vocabulary, INSERT OR
   UPDATE trigger, draft uniqueness, inactive provider row), `20260911000100`
   (processor cron), `20260911000200` (retention columns, index, retention cron).
3. **Edge Functions**: `aml-verification-processor` (new), `aml-idv-retention`
   (new), `aml-client-portal`, `cross-portal-outbox-worker`, `aml-verification`.
4. **Secrets**: `DIDIT_API_KEY` (sandbox on staging), `DIDIT_LIVENESS_THRESHOLD`,
   `DIDIT_FACE_MATCH_THRESHOLD`, and — when compliance has decided —
   `AML_IDV_CAPTURE_RETENTION_DAYS`. `INTERNAL_EDGE_SECRET` must already be set;
   both new functions are signed-internal only.
5. **Verify the schedules**: `aml-verification-processor-1min` and
   `aml-idv-retention-daily` in `cron.job`.
6. **Leave `didit_standalone` inactive.** Confirm:
   `SELECT active FROM aml.provider_configs WHERE provider_key='didit_standalone'`
   → `false`.
7. **Sandbox run** on staging: activate there, complete a passport journey and
   a licence journey, confirm three request ids and a non-zero cost.
8. **`aml-idv-retention` dry run**: expect `configured: false` until the policy
   is set, and zero deletions.
9. **Controlled live test**: one real verification with a live key, by a member
   of staff, on a real case.
10. **Real-device QA**: [`IDV_DEVICE_QA_CHECKLIST.md`](./IDV_DEVICE_QA_CHECKLIST.md),
    sections A–D signed.
11. **Activate** — see below.
12. **Drain** the hosted sessions.

### Rollback

At any point before step 11 there is nothing to roll back: the provider is
inactive and no customer reaches the new path. After step 11:

```sql
UPDATE aml.provider_configs SET active = false WHERE provider_key = 'didit_standalone';
UPDATE aml.provider_configs SET active = true  WHERE provider_key = 'didit';
```

New attempts return to the hosted flow immediately; attempts already processing
settle on the Standalone path and are unaffected. Each migration carries its own
`ROLLBACK:` header if the schema itself has to come back out.

## Switching a tenant on

Provider selection is server-side configuration and stays that way; the browser
can never send a provider. Both rows are seeded inactive:

```sql
UPDATE aml.provider_configs SET active = true
 WHERE tenant_id = 'default' AND capability = 'idv' AND provider_key = 'didit_standalone';
UPDATE aml.provider_configs SET active = false
 WHERE tenant_id = 'default' AND capability = 'idv' AND provider_key = 'didit';
```

Two statements, deliberately: `resolveTenantProvider` takes the
highest-priority **active** row, so exactly one may be active at a time.

Set `DIDIT_LIVENESS_THRESHOLD` and `DIDIT_FACE_MATCH_THRESHOLD` **before**
activating, or the portal will correctly report verification as unavailable.
Use a sandbox key while testing: sandbox keys return mock data and are not
billed. Never put a key in source.

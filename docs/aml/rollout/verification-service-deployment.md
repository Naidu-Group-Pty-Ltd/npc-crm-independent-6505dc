# Self-hosted verification service — deployment package and runbooks

Audit and deployment record for `services/aml-verification-service/`, the
provider the canonical IDV pipeline calls. Everything in this document is
repository state; **no environment has been provisioned** — that and the
secrets are the external gate.

## Package audit (repository state)

| Item | Finding |
| --- | --- |
| Container build | `Dockerfile` + `docker-compose.yml` present; model weights fetched by `scripts/fetch_models.sh` (Apache-2.0 weights, see `NOTICE`) |
| API | `POST /face/compare`, `POST /face/liveness`, `POST /doc/mrz`, `GET /healthz` (FastAPI, `app/main.py`) |
| Authentication | bearer token via `require_token(authorization)` on every POST; `/healthz` reports `token_configured` as a boolean and never the value |
| Image limits | `AML_MAX_IMAGE_BYTES` (default 8 MB) enforced in `decode_image` with HTTP 413 |
| Image persistence | none — images are decoded in memory to numpy arrays; no filesystem writes, so no temp-file cleanup path exists to leak |
| Failure mapping | `ModelUnavailable` → dedicated handler; the edge adapter maps transport/HTTP failures to `provider_unavailable` and never to a customer failure |
| Tests | `tests/test_api.py`, `tests/test_mrz.py` (128 lines of API coverage incl. auth and limits) |
| Readiness probe | `GET /healthz` — suitable as both liveness and readiness |
| Secrets in repo | none committed; configuration is environment-only |

## Configuration contract (no secret values here)

Edge functions read these at runtime; set them as **function secrets**, never
in the repository:

| Name | Purpose |
| --- | --- |
| `AML_VERIFICATION_SERVICE_URL` | base URL of the deployed service |
| `AML_VERIFICATION_SERVICE_TOKEN` | bearer token the service requires |
| `AML_ENVIRONMENT` | `production` \| `staging` \| `test` \| `local` — trusted environment classification |

Plus one row in `aml.provider_configs`: `capability='idv'`,
`provider_key='selfhosted'`, `mode='live'`, `active=true`. Without both the
secrets and that row, provider resolution fails closed
(`provider_not_configured` / `provider_misconfigured`) and **no customer
attempt is consumed**.

Service-side environment: `AML_MAX_IMAGE_BYTES`, `AML_MAX_MOIRE`,
`AML_VERIFICATION_SERVICE_TOKEN` (the same value the edge functions send).

## Documented limitations — never overstate these

- **No DVS / issuing-authority verification.** Nothing in this stack contacts
  the Australian Document Verification Service or any issuer. The adapter
  records `document_authenticity` as `warn` with
  "not verified against the issuing authority — no DVS connection" and carries
  `no_issuing_authority_check` in the result limitations.
- **Liveness is heuristic.** The passive signal is never recorded as `pass` —
  at best `warn` with `liveness_is_heuristic_only`. It is not proof of
  presence.
- **MRZ absence is not failure.** Most Australian driver licences carry no
  ICAO MRZ; only a failed check digit is adverse.
- **A provider result is evidence, not a decision.** A passed electronic check
  never approves the service gate; higher-risk matters may still require manual
  sighting or certified copies, and referral is the honest default.

## Deployment steps (for the infrastructure owner)

1. Build and push the image from `services/aml-verification-service/`.
2. Run it on a private network reachable by Supabase Edge Functions over TLS.
3. Set the service token in the service environment.
4. Set the three function secrets above on the target Supabase project.
5. Insert/activate the `provider_configs` row (`mode='live'`).
6. Confirm `GET /healthz` returns `token_configured: true` and models loaded.
7. Confirm AML › Configuration › Providers shows **ready_live**.
8. Schedule the outbox worker POST (existing `x-worker-secret` auth) so
   `aml.verification.requested` events are consumed.

## Runbooks

**Provider outage.** Symptom: checks sitting at `processing_status='technical_failure'`
with `provider_error_category='provider_unavailable'`; readiness shows
unavailable. No customer attempt was consumed and no identity outcome exists.
Action: restore the service, then use staff **Retry processing** (technical
retries only) or let the outbox retry; if the outage is prolonged, switch the
case to manual document sighting.

**Worker outage / backlog.** Symptom: `aml.verification.requested` events
unprocessed, pending-capture age climbing. Action: confirm the worker
schedule and `CROSS_PORTAL_OUTBOX_V1`; the events are durable, so processing
resumes without client action.

**Stuck verification.** A check in `processing` beyond the expected window:
inspect `processing_attempts`; requeue with **Retry processing**. Never edit
`status` by hand — that is the identity outcome.

**Dead-letter retry.** Remediate the cause, then retry the dead-lettered job
through the existing replay RPC or staff retry. Attempts are unaffected.

**Capture unusable.** `processing_status='capture_unusable'` — no attempt
consumed. Use **Request new capture**; the client recaptures with their full
allowance intact.

**Attempts exhausted.** The client sees a contact-adviser state. Complete
verification by manual document sighting; record it against the party.

**Credential rotation.** Rotate the service token, update the function secret,
confirm readiness returns to `ready_live`, then run one synthetic staging
verification before relying on it.

**Document rejection / replacement.** Reject with an internal reason **and** a
client-safe code; the client receives a replacement request. The rejected
version is retained and linked as lineage — never deleted or overwritten.

**Party reconciliation.** Resolve each declared party explicitly (link to an
exact canonical record, create, or mark manual-only) with a rationale.
Similarity suggestions are never authority to merge.

**Screening match.** Possible matches are adjudicated by a reviewer or MLRO
with a note; a confirmed match makes the risk assessment stale and requires
authorised recomputation. Clients are never told anything about screening.

**Biometric incident.** Access is role-gated, reason-required and logged.
On suspected exposure: revoke access, preserve the log, escalate as SEV-1,
and do not delete anything under a legal hold.

**Retention disposal failure.** Disposal writes evidence; a hold blocks
disposal by design (`disposal_status='blocked_by_hold'`). Resolve the hold
with the MLRO before retrying.

**Simulator detected in production.** Should be impossible (production
refuses simulator resolution). If seen, treat as deployment drift: verify the
deployed function version, redeploy, and classify the affected rows
non-authoritative — never delete them.

**Rollback.** Each migration header carries exact statements. Reverting the
code restores the previous behaviour; the additive columns and tables are safe
to leave in place.

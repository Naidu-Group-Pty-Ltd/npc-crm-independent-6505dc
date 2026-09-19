# KYC go-live runbook

This runbook is the operational path for the existing self-hosted identity-verification stack.

The architecture is fixed:

- Client Portal captures the identity document and selfie.
- The identity document is uploaded to private Supabase Storage bucket `aml-documents`.
- The selfie is uploaded to private Supabase Storage bucket `aml-biometrics`.
- `aml.verification_checks` stores only the two storage paths and verification metadata.
- Exactly one `aml.verification.requested` outbox event starts processing.
- `cross-portal-outbox-worker` downloads both private objects and calls `services/aml-verification-service` through the existing `selfhosted` adapter.
- The service performs `/doc/mrz`, `/face/compare`, and `/face/liveness` and stores no permanent image copies.
- The same canonical verification row is projected to the Client Portal, staff AML workspace, Timeline, and Audit.

Identity verification is **live-only** in persisted tenant configuration. There is no production simulator operating mode and no simulator rollback path.

---

## 1. Required production state

The only valid production IDV provider row is:

```text
tenant_id=default
capability=idv
provider_key=selfhosted
mode=live
active=true
```

Exactly one active winning IDV provider must exist.

Do not create a second IDV provider and do not change `provider_key`.

The provider must remain inactive until the production backend can reach a healthy verification service. Once that health check succeeds, activate the existing row directly.

---

## 2. Run the existing verification service

The service is:

```text
services/aml-verification-service
```

It is a normal Dockerised Python/OpenCV service. It has no dependency on a particular hosting vendor.

Run it only on an explicitly approved persistent project runtime. Do not infer a runtime from unrelated service URLs and do not use an ephemeral development/session container as production.

Required runtime properties:

- persistent process/container;
- stable HTTPS route reachable by the production Supabase Edge Functions;
- automatic restart;
- sufficient memory for YuNet and SFace;
- no persistent request-image volume;
- controlled request size, timeout, and concurrency;
- logs that exclude request bodies, image base64, bearer tokens, and credentials.

Generate a strong service token and provide it to the container as:

```text
AML_SERVICE_TOKEN
```

Never commit or print that token.

### Service readiness

Before connecting production, verify:

```text
GET /healthz
HTTP 200
status=ok
models.yunet=true
models.sface=true
token_configured=true
```

Unauthenticated processing requests must return `401`:

```text
POST /doc/mrz
POST /face/compare
POST /face/liveness
```

Authenticated synthetic requests must reach all three endpoints. A truthful `mrz_not_found`, `unusable`, `no_face_*`, or retake result is acceptable; a fabricated pass is not.

---

## 3. Configure the production Edge Function secrets

Set only these application secrets:

```text
AML_VERIFICATION_SERVICE_URL
AML_VERIFICATION_SERVICE_TOKEN
```

`AML_VERIFICATION_SERVICE_TOKEN` must match service-side `AML_SERVICE_TOKEN`.

Use the protected Edge Function/integration secret mechanism. Do not store either value in `public.integration_configs`.

Then verify from the actual production backend that `/healthz` is reachable and returns `status=ok`. A local request is not sufficient production evidence.

---

## 4. Activate self-hosted IDV

After the production backend has successfully reached the real service, update the existing row to:

```text
provider_key=selfhosted
mode=live
active=true
```

Do not leave the row inactive after health is proven.

Do not create a simulator row or a second IDV provider.

Required readiness through both staff and Client Portal backends:

```text
environment=production
configured_provider=selfhosted
mode=live
adapter_wired=true
adapter_configured=true
state=ready_live
availability=available
```

Readiness must be based on a real service health response, not merely the presence of secrets.

---

## 5. Capture and upload order

The Client Portal flow is deliberately gated so a provider refusal cannot leave orphaned identity documents.

Required order:

1. fresh `verification_status` / availability check;
2. request the **selfie** upload grant first — this is the provider/readiness gate;
3. request the document upload grant;
4. upload the document to private `aml-documents`;
5. upload the selfie to private `aml-biometrics`;
6. call `submit_verification`.

Both grants must succeed before either Storage `PUT` occurs.

The camera must not open when availability is not `available`, and Submit must perform another fresh availability check.

### Storage contract

Document:

```text
private bucket: aml-documents
path stored in: aml.verification_checks.document_reference
```

Selfie:

```text
private bucket: aml-biometrics
path stored in: aml.verification_checks.biometric_storage_path
```

Do not store image bytes, base64 data, signed URLs, or credentials in `aml.verification_checks`.

---

## 6. Canonical verification and processing

`submit_verification` creates exactly one canonical row with:

```text
check_type=electronic_idv
provider=selfhosted
execution_mode=live
processing_status=queued
attempt_consumed=false
```

It must reference the actual private Storage paths.

Exactly one transactional outbox event is emitted:

```text
aml.verification.requested
```

The event contains identifiers only.

`cross-portal-outbox-worker` then:

1. claims the event;
2. downloads the identity document privately;
3. downloads the selfie privately;
4. calls `/doc/mrz`;
5. calls `/face/compare`;
6. calls `/face/liveness`;
7. updates the same canonical `aml.verification_checks` row.

Retries must remain idempotent.

---

## 7. Attempt accounting

Capture and infrastructure problems are not identity failures.

Required behaviour:

```text
capture_unusable -> no attempt consumed
technical service/storage failure -> no attempt consumed
authoritative examined result -> existing attempt rules apply
```

A poor image, missing face, timeout, unavailable service, or storage failure must never manufacture a failed identity result.

---

## 8. Production proof

Use a fresh synthetic case and synthetic identity material.

Verify the complete journey:

1. staff requests identity verification;
2. Client Portal reports `availability=available`;
3. Start re-checks availability;
4. document capture works;
5. Retake works;
6. selfie capture works;
7. both Blobs are retained at Submit;
8. selfie grant succeeds first;
9. document grant succeeds second;
10. document reaches `aml-documents`;
11. selfie reaches `aml-biometrics`;
12. exactly one canonical verification row is created;
13. exactly one outbox event is created;
14. the worker executes all three real service calls;
15. the canonical row leaves queued/processing;
16. Client Portal and staff AML workspace show the same safe result;
17. Timeline and Audit contain safe evidence only.

A genuine `capture_unusable`, referred, or staff-review outcome is valid production proof. Do not force an automated pass.

---

## 9. Service outage behaviour

When the live service is genuinely unhealthy or unreachable:

- readiness must become unavailable;
- the camera must not open for a new capture;
- no upload grant may proceed;
- no Storage object may be written;
- no canonical verification row may be created;
- no outbox event may be emitted;
- no attempt may be consumed;
- the adviser/manual document-verification route remains available.

Do **not** switch IDV into a simulator mode during an outage.

Restore the service and confirm readiness returns to:

```text
mode=live
active=true
state=ready_live
availability=available
```

---

## 10. Operational disable / rollback

The production kill switch is activation, not simulation.

To stop new electronic IDV safely:

1. set the existing `selfhosted` IDV row `active=false`;
2. keep `mode=live` so the configuration still describes the intended real provider;
3. preserve the adviser/manual route;
4. repair the live service connection;
5. re-enable `active=true` only after a real production health check succeeds.

Do not roll back to `mode=simulator`.

If credentials must be revoked, unset:

```text
AML_VERIFICATION_SERVICE_URL
AML_VERIFICATION_SERVICE_TOKEN
```

and keep IDV inactive until replacements are configured and health is proven.

---

## 11. Privacy and evidence requirements

The service remains stateless for customer images.

Never place any of the following in browser responses, evidence JSON, outbox payloads, Timeline, Audit, or logs:

- document image bytes;
- selfie image bytes;
- base64 captures;
- signed Storage URLs;
- bearer tokens;
- integration credentials.

The canonical database record survives according to AML retention requirements; biometric object disposal follows the existing retention process.

---

## 12. Known capability limits

This self-hosted flow does not establish issuing-authority authenticity on its own. The existing provider adapter deliberately records that limitation rather than overstating the result.

Liveness is a heuristic and does not independently produce a verified outcome.

These limitations are reasons for truthful referral/staff review where required, not reasons to substitute a fake automated pass.

# Self-hosted KYC — current design

This document describes the KYC implementation that exists in the repository now.

For deployment and production verification, use [`kyc-go-live-runbook.md`](./kyc-go-live-runbook.md).

The production identity-verification architecture is fixed. Do not replace it with another provider, hosted redirect flow, camera implementation, Storage design, canonical table, or worker.

---

## 1. Production provider

Electronic identity verification uses one provider:

```text
capability=idv
provider_key=selfhosted
mode=live
```

Persisted production IDV configuration is live-only. Simulator execution is not a production operating mode.

The provider may be left `active=false` while the real service is unconfigured or unhealthy. Once the production backend has proved the service healthy, the required state is:

```text
provider_key=selfhosted
mode=live
active=true
```

The manual/documentary verification route remains available when electronic verification is unavailable or when a client does not consent to biometric collection.

---

## 2. Capture and private Storage

The Client Portal uses the existing browser camera flow.

### Identity document

```text
browser Blob
→ signed private upload
→ Supabase Storage bucket `aml-documents`
→ path stored in `aml.verification_checks.document_reference`
```

### Selfie

```text
browser Blob
→ signed private upload
→ Supabase Storage bucket `aml-biometrics`
→ path stored in `aml.verification_checks.biometric_storage_path`
```

The database stores Storage paths, not image bytes.

The Client Portal must obtain both upload grants before uploading either capture. The provider-gated selfie grant is requested first so an unavailable provider cannot leave an orphaned document object.

Required order:

1. fresh availability check;
2. selfie upload grant;
3. document upload grant;
4. document PUT;
5. selfie PUT;
6. `submit_verification`.

---

## 3. Canonical verification record

Electronic capture creates exactly one canonical row in:

```text
aml.verification_checks
```

The electronic row is created with the existing canonical fields, including:

```text
check_type=electronic_idv
provider=selfhosted
execution_mode=live
processing_status=queued
attempt_consumed=false
```

`document_reference` and `biometric_storage_path` point to the private Storage objects.

The browser does not select the provider and does not send image bytes into the canonical row.

---

## 4. Transactional processing

Creation of the canonical verification emits exactly one transactional event:

```text
aml.verification.requested
```

`cross-portal-outbox-worker` owns processing.

The worker:

1. claims the event idempotently;
2. downloads the document from `aml-documents` privately;
3. downloads the selfie from `aml-biometrics` privately;
4. sends the captures to the existing self-hosted adapter;
5. updates the same canonical verification row.

The outbox payload contains identifiers only and must not carry image data, signed URLs, or credentials.

---

## 5. Verification service

The processor is:

```text
services/aml-verification-service
```

It is a stateless Python/OpenCV service using the repository-pinned models.

The application calls three endpoints:

```text
POST /doc/mrz
POST /face/compare
POST /face/liveness
```

The service receives image data for the duration of a request and does not become a second permanent image store.

Required environment variable on the service:

```text
AML_SERVICE_TOKEN
```

Required protected variables in the production Edge Function environment:

```text
AML_VERIFICATION_SERVICE_URL
AML_VERIFICATION_SERVICE_TOKEN
```

The two token values must match.

The service is not tied by design to a particular hosting vendor. It only requires an approved persistent runtime with HTTPS reachability from the production Supabase backend.

---

## 6. Readiness

Electronic capture is offered only when the backend resolves the existing self-hosted provider as live, wired, configured, and healthy.

Expected production readiness:

```text
environment=production
configured_provider=selfhosted
mode=live
adapter_wired=true
adapter_configured=true
state=ready_live
availability=available
```

Readiness is based on the actual service health endpoint rather than secret presence alone.

If readiness is unavailable, the camera must not open for a new capture and no upload should occur.

---

## 7. Attempt accounting

Infrastructure and capture-quality failures are not identity findings.

```text
capture_unusable -> no attempt consumed
technical service/storage failure -> no attempt consumed
authoritative examined result -> existing attempt rules apply
```

A timeout, unreachable service, unreadable Storage object, blurred capture, or missing face must not manufacture a failed identity outcome.

---

## 8. Result handling

The canonical result is projected to:

- Client Portal;
- staff AML workspace;
- Timeline;
- Audit.

The client receives only the safe action/result required for their workflow. Internal similarity scores and sensitive diagnostics remain on the staff side where appropriate.

Evidence and logs must exclude:

- document image bytes;
- selfie image bytes;
- base64 captures;
- signed Storage URLs;
- bearer tokens;
- integration credentials.

---

## 9. Capability limits

This self-hosted path does not establish issuing-authority authenticity on its own. The adapter records that limitation explicitly rather than claiming that a document has been independently confirmed with its issuer.

MRZ validation is useful where a document type has an MRZ, but absence of an MRZ is not itself a failed identity check.

Liveness is a heuristic signal and is not recorded as independent proof of identity.

A truthful referred/staff-review outcome is therefore a valid result of the real electronic flow. The system must never manufacture a pass merely to make the automation appear successful.

For higher-risk matters or where electronic verification cannot complete, use the existing original/certified-document sighting process and record the evidence in the AML workspace.

---

## 10. Operational principle

There are only two production IDV states:

```text
live + active     -> real electronic verification available when health is good
live + inactive   -> electronic verification disabled; documentary route remains available
```

There is no production simulator state and no simulator rollback procedure.

## 11. Licence and capability evidence

This section is the compliance record for why the stack is lawful to run
commercially and what it does not establish. It was lost in an earlier
documentation rewrite; it is restored here because an AUSTRAC reviewer will ask
these exact questions and `amlPortalContracts.test.ts` pins the answers.

### Model weights are permissive, including the weights

| Model | File | Licence |
|---|---|---|
| Face detection | `face_detection_yunet_2023mar.onnx` | Apache-2.0 *including* its weights |
| Face recognition | `face_recognition_sface_2021dec.onnx` | Apache-2.0 *including* its weights |

Both come from `opencv/opencv_zoo`, pinned by revision and verified by SHA-256
at image build time.

Apache-2.0 obliges us to retain attribution, so it is recorded here and in the
service's `NOTICE`: SFace is the work of the **Shenzhen Institute of Artificial
Intelligence and Robotics for Society**.

Do **not** substitute InsightFace/ArcFace weights, including indirectly via
CompreFace or DeepFace defaults. Those are licensed for non-commercial research
only, and using them here would make this deployment a licence breach. The
whole reason `face_recognition_sface` was chosen is that its weights carry the
same permissive licence as its code.

### Sanctions data comes from the primary sources

Screening reads the **DFAT Consolidated List** (Australia), the UN Consolidated
List and the OFAC SDN list, downloaded and parsed from the issuing bodies
directly.

We deliberately do **not** aggregate through OpenSanctions. Its consolidated
data is published under **CC-BY-NC**, and a fee-earning AML programme is a
commercial use — so the convenient path is the one we cannot take.

### No DVS — say so rather than imply parity

This stack does not connect to the Document Verification Service. We are
therefore **not checking against the issuing authority**: a face may match a
document while the document itself is never confirmed genuine. That is why the
adapter records `document_authenticity` as a warning, never a pass, and why the
strongest outcome electronic verification can reach is a referral to a human.

The **compensating control** is that every electronic result is adjudicated by
a person before it moves the service gate, and higher-risk matters use the
original/certified-document sighting process instead.

### The upgrade path needs no schema rework

Adding DVS later is a new `check_type = 'dvs'` row against the same canonical
`aml.verification_checks` model — **no schema change**, no migration of existing
evidence, and no change to the portal or the worker.

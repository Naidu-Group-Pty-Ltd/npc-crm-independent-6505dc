# AML verification service

Face match, liveness signal and MRZ validation for the zero-cost KYC stack
(`docs/aml/kyc-zero-cost-solution.md`).

**Stateless by design.** It accepts images, returns numbers, and keeps nothing.
The record of truth for a retained biometric is the Supabase `aml-biometrics`
bucket, whose every read is written to `aml.biometric_access_log`. If this
service also persisted images it would become a second, unaudited copy of the
most sensitive data in the system. A test (`tests/test_api.py`) asserts the
source contains no persistence calls.

It also makes **no decision**. It returns scores and thresholds; the edge
function records the outcome, and only a human moves the service gate.

## Licensing — read before changing a model

Both models are Apache-2.0 **including their weights**, which is the entire
reason this stack is free and lawful:

| Model | File | Licence |
|---|---|---|
| SFace (recognition) | `face_recognition_sface_2021dec.onnx` | Apache-2.0 — SIAT |
| YuNet (detection) | `face_detection_yunet_2023mar.onnx` | Apache-2.0 |

**Do not substitute InsightFace / ArcFace weights** (including indirectly, via
CompreFace or DeepFace defaults). Those are licensed for non-commercial
research only and would make this deployment a licence breach. The permissive
badge on a repository says nothing about the weights it downloads at runtime —
verify the weights.

See `NOTICE` for the attribution Apache-2.0 requires you to retain.

## Run

```sh
export AML_SERVICE_TOKEN="$(openssl rand -hex 32)"
docker compose up --build
```

Models are fetched at **build** time, so the image is self-contained and the
service cannot start against a half-populated model directory.

```sh
curl -s localhost:8080/healthz | jq
```

## Endpoints

All require `Authorization: Bearer $AML_SERVICE_TOKEN`. The service **fails
closed** if the token is unset — an unauthenticated verification service would
let anyone submit faces for comparison.

### `POST /face/compare`
`{ document_image, selfie_image }` (base64) →
```json
{ "verdict": "match|review|no_match|unusable", "similarity": 0.41,
  "thresholds": { "match": 0.363, "review": 0.28 }, "quality": {...} }
```
`review` is a first-class outcome, not a rounding of `no_match` — a borderline
score is exactly the case a human should see. `unusable` means the **capture**
failed (no face, too small), not the identity; the caller must not spend one of
the customer's three attempts on it.

### `POST /face/liveness`
`{ selfie_image }` → `{ is_real, score, signals, confidence: "low", advisory }`

**A signal, not a verdict.** Sharpness and screen-replay heuristics only. It
will catch a photo of a screen or an obviously flat print. It will **not**
reliably catch a high-quality print attack, a mask, or an injected deepfake.
The limitation is returned in every response so a caller cannot be misled by
reading only the boolean.

### `POST /doc/mrz`
`{ document_image }` → `{ found, valid, format, fields, checks, errors }`

A failed check digit is the strongest free forgery signal available. An
unreadable MRZ returns `found: false` and is **not** a failure — most
Australian driver licences carry no ICAO MRZ at all.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `AML_SERVICE_TOKEN` | — | **Required.** Service fails closed without it. |
| `AML_FACE_MATCH_THRESHOLD` | `0.363` | OpenCV's reference cosine threshold for SFace |
| `AML_FACE_REVIEW_THRESHOLD` | `0.28` | Below match, above this → human review |
| `AML_MIN_FACE_PX` | `60` | Smaller faces give unreliable embeddings |
| `AML_MAX_IMAGE_BYTES` | `8388608` | |
| `AML_MODEL_DIR` | `/models` | |

The edge function reaches this service via `AML_VERIFICATION_SERVICE_URL` and
`AML_VERIFICATION_SERVICE_TOKEN`. If either is unset the provider throws rather
than degrading — a misconfigured service must never look like a customer who
failed verification.

## Tests

```sh
pip install -r requirements-dev.txt
python -m pytest tests/ -q
```

Runs without the ONNX models present. The MRZ check-digit expectations are
duplicated in `src/lib/aml/screeningMatch.test.ts` on purpose: the two
implementations must agree, and a divergence should break a test rather than
quietly produce different verdicts on the two sides of the wire.

## Deployment notes

- Runs unprivileged (`uid 10001`), `read_only` root filesystem, `no-new-privileges`.
- Bind to loopback and reach it over a private network or tunnel. It handles
  biometric data and has no business being publicly routable.
- No volumes. Nothing is persisted.

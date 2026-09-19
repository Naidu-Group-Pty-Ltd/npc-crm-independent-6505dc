# KYC / identity verification — decisions and open-source vendor evaluation

Supersedes the proposal of 2026-07-27. The four open decisions have been made
by the owner and are recorded in §1. §2 evaluates open-source, self-hostable
options with biometric capability. §3 states plainly what open source cannot
supply. §4 is the recommended stack. §5 covers what the decisions change in
the build.

---

## 1. Decisions (owner, 2026-07-28)

| # | Question | Decision |
|---|---|---|
| 1 | Vendor | **Open-source, self-hosted, with biometrics.** Evaluation in §2. |
| 2 | Retain biometrics? | **Yes — biometric data is retained.** |
| 3 | Re-verification interval | **None.** Verification does not expire on a clock. |
| 4 | Failed check | **Two retries — three attempts in total.** |

### Note on decision 2

Biometric information is **sensitive information** under s 6 of the *Privacy
Act 1988* (Cth). Two consequences follow automatically and are not optional:

- **APP 3.3** — sensitive information may only be collected with the
  individual's *consent*, and that consent must be specific to the biometric
  collection. The existing `identity_verification` consent covers electronic
  verification generally; it does not cover retaining a face image or template.
  A dedicated biometric consent document is therefore required before any
  retention occurs (implemented at catalogue v2026.2 — see §5).
- **APP 11** — the security obligation is proportionate to sensitivity. A
  retained biometric corpus is a materially higher-value breach target than the
  document set we hold today, and it cannot be reissued the way a licence number
  can.

Retention is implemented as decided. Recorded here so the basis is on file:
self-hosting makes this decision considerably safer than it would be with a
SaaS vendor, because the biometric never leaves infrastructure we control.
That is the main argument in favour of the open-source direction, and §4 leans
on it.

### Note on decision 3

No fixed expiry is implemented. This is a legitimate policy position, but it is
not the same as "never re-verify": ongoing customer due diligence still
requires customer information to be kept current, and a **material change**
(new beneficial owner, change of name, a monitoring trigger) must still prompt
re-verification. That path already exists in the Phase 10 monitoring work and
stays available as a manual action. What decision 3 removes is only the
calendar-driven re-check.

---

## 2. Open-source options with biometric capability

Assessed on: licence (code **and** pretrained weights), maintenance status,
self-hostability, and fitness for a regulated Australian reporting entity.

### 2.1 Full platforms

| Project | Licence | Stars | Status | Verdict |
|---|---|---|---|---|
| [Ballerine](https://github.com/ballerine-io/ballerine) | Apache-2.0 | 2.4k | **OSS repo "undergoing a major rebuild and is not actively supported at this time"** | **Do not depend on it.** The feature list (liveness, face match, OCR, KYC flows) is the closest match to our needs, but an unsupported repo underneath a compliance obligation is not defensible. Revisit if the rebuild lands. |
| [Self-Hosted-KYC-Verification-Platform](https://github.com/PetrJoe/Self-Hosted-KYC-Verification-Platform) | see repo | small | hobby-scale | Useful as a reference implementation of the flow. Not a dependency. |
| [ai-kyc-platform](https://github.com/JhashankKumar/ai-kyc-platform) | see repo | small | hobby-scale | Same. Demonstrates DeepFace + MediaPipe wiring. |

**Conclusion: there is no maintained, production-grade open-source KYC
platform to adopt wholesale.** The viable path is to assemble components.

### 2.2 Face match / biometric verification

| Project | Code licence | Weights licence | Stars | Verdict |
|---|---|---|---|---|
| [CompreFace](https://github.com/exadel-inc/CompreFace) (Exadel) | Apache-2.0 | **InsightFace-ArcFace — non-commercial; licence required** | 8.2k | **Recommended, with a weights licence (see §4 correction).** Self-hosted REST service, Docker-deployed, does detection / verification / recognition. Service boundary is clean — we call an HTTP API we host, so it drops into the existing edge-function architecture without embedding ML in our stack. |
| [DeepFace](https://github.com/serengil/deepface) | MIT | **inherited per model** | 23.2k | Strong library, actively maintained, includes an `anti_spoofing` flag. **Trap:** the repo states "license types will be inherited when you intend to utilize those models" — the MIT wrapper does not make the weights commercially usable. A model must be pinned and its licence documented. |
| [InsightFace](https://github.com/deepinsight/insightface) | MIT | **non-commercial research only** | 29.4k | **Reject for production.** The repo is explicit: "the training data containing the annotation (and the models trained with these data) are available for non-commercial research purposes only." Most tutorials and several downstream projects default to InsightFace weights, so this is the easiest licence breach to commit by accident. Any component we adopt must be audited for whether it pulls InsightFace weights underneath. |

### 2.3 Liveness / presentation-attack detection

| Project | Licence | Stars | Verdict |
|---|---|---|---|
| [Silent-Face-Anti-Spoofing](https://github.com/minivision-ai/Silent-Face-Anti-Spoofing) (MiniVision) | Apache-2.0 | 1.8k | Passive liveness via Fourier-spectrum analysis — no user interaction needed. Apache-2.0 covers commercial use. **Caveat: effectively unmaintained since 2020.** Presentation attacks have moved on considerably, particularly generative/deepfake attacks that did not exist when it was trained. Usable, but treat its output as one signal, not a verdict. |
| DeepFace `anti_spoofing` | MIT wrapper | 23.2k | Convenient if DeepFace is already in the stack; same weights-licence caveat. |

**This is the weakest link in the open-source stack.** Liveness is adversarial
— it degrades as attackers improve, and it needs ongoing model investment that
no maintained permissive-licence project currently provides. Commercial vendors
compete specifically on this. Plan for a human-review fallback on any borderline
result rather than treating passive liveness as authoritative.

### 2.4 Document capture and MRZ

| Project | Licence | Verdict |
|---|---|---|
| [docTR](https://github.com/mindee/doctr) (Mindee) | Apache-2.0 | Actively maintained OCR. Good for extracting fields from a licence or passport image. |
| [PassportEye](https://github.com/konstantint/PassportEye) / [mrz](https://github.com/Arg0s1080/mrz) | MIT | Machine-readable-zone parsing and checksum validation. Cheap, high-value: a failed MRZ checksum is a strong forgery signal on its own. |

### 2.5 Sanctions / PEP screening

| Project | Code | Data | Verdict |
|---|---|---|---|
| [OpenSanctions](https://github.com/opensanctions/opensanctions) | MIT | **CC-BY-NC 4.0** | Best open option, actively maintained, self-hostable via Docker. **Trap: the data is non-commercial.** A reporting entity screening its own customers is commercial use, so a paid data licence from OpenSanctions is required. The engine is free; the list is not. |

Primary-source lists (DFAT Consolidated List, UN, OFAC) are freely
redistributable, but aggregation, name normalisation, transliteration and
deduplication are the hard part — which is exactly what the licensed layer
provides.

---

## 3. What open source cannot supply

**Document Verification Service (DVS).** This is the binding constraint, and no
amount of open source substitutes for it. DVS confirms an identity document
matches the *issuing authority's* record. Access requires an accredited
**Gateway Service Provider** under a Participation Agreement with the
Attorney-General's Department. As at September 2025 a base connection to the DVS
hub costs **$24,610.40**, plus **$454.55 per document type**. Becoming our own
GSP is not proportionate; going through an existing one is a commercial
contract.

Without DVS we are matching a document against its own printed contents and a
face — not against the issuer. For tranche-2 obligations that is below the
expected standard.

Also unavailable from open source: liability and indemnity, accreditation
status, and independent bias/accuracy auditing of the biometric models.

---

## 4. Recommended stack

> **Superseded for the current direction (2026-07-28).** The owner asked for a
> zero-cost integration. See
> [`kyc-zero-cost-solution.md`](./kyc-zero-cost-solution.md), which resolves the
> weights problem below: OpenCV Zoo's **SFace** model is Apache-2.0 *including
> its weights*, so a lawful face match is possible at no licence cost. The
> section below remains the reference for the paid options.


**Hybrid — self-host the biometric layer, buy the authoritative layer.**

| Layer | Choice | Why |
|---|---|---|
| Face match | **CompreFace** (Apache-2.0), self-hosted via Docker, **plus a commercial InsightFace weights licence** — see the correction below | Clean REST boundary; biometrics never leave our infrastructure — which is what makes decision 2 defensible |
| Liveness | **Silent-Face-Anti-Spoofing** (Apache-2.0) as a signal, **plus mandatory human review** on borderline scores | No maintained permissive alternative; do not treat as authoritative |
| Document OCR / MRZ | **docTR** + **mrz** (Apache-2.0 / MIT) | MRZ checksum failure is a strong, cheap forgery signal |
| Document authenticity | **DVS via a Gateway Service Provider** — commercial | No open-source path exists (§3) |
| Sanctions / PEP | **OpenSanctions** self-hosted, **with a commercial data licence** | Code is MIT; the data is not free for our use |
| Orchestration | **Ours** — `aml.verification_checks` (§5) | Avoids depending on the unmaintained Ballerine repo; keeps provider swappable |

> **Correction (2026-07-28).** The weights audit below was run early, during the
> investigation in [`kyc-repo-investigation.md`](./kyc-repo-investigation.md),
> and it lands on this recommendation. CompreFace's highest-accuracy model is
> **InsightFace-ArcFace**, whose pretrained weights are non-commercial research
> only; InsightFace directs commercial users of its open-sourced packages to
> `recognition-oss-pack@insightface.ai`. The Apache-2.0 badge on CompreFace does
> not make its default model commercially usable by us. This is structural
> rather than a CompreFace defect — there is no high-accuracy, genuinely
> commercially-licensed, free face recognition model. The recommended resolution
> is to licence the weights and keep self-hosting, which preserves everything
> that made decision 2 defensible. See §4 of the investigation.

**Weights-licence audit is a release gate.** Before any biometric component
goes to production, its actual downloaded model weights must be identified and
their licence recorded. The MIT/Apache badge on a repository says nothing about
the weights it pulls at runtime, and InsightFace weights — non-commercial only
— are the common default underneath several of these projects.

---

## 5. What the decisions change in the build

### Consent — catalogue v2026.2 (required by decision 2)

A new `biometric_collection` consent document, separate from
`identity_verification`, covering: what is captured (facial image and derived
template), that it is **retained**, where it is stored, how long it is kept,
that it is processed on infrastructure we control rather than sent to a third
party, and the right to request document-based verification instead. Consent is
recorded through the existing versioned catalogue, so the acceptance is pinned
to a hash of the exact wording — same evidence model as the AUSTRAC consents.

Publishing v2026.2 re-asks every consent, by design: the existing gate treats
acceptance as version-specific.

### Verification records — `aml.verification_checks`

Per **party**, not per case: a trust purchase can require four verifications,
and a case-level flag cannot express "two of four passed".

Encoding the decisions:

- **Decision 4 — three attempts.** `attempt_number` (1–3) with a database
  constraint, and `attempts_remaining` derived. The third failure moves the
  party to `exhausted` and raises a staff task; it does **not** auto-block the
  service gate. Consistent with the standing rule that the gate is only ever
  moved by an explicit, reasoned human decision.
- **Decision 3 — no expiry.** No `expires_at` column and no scheduled
  re-verification. A manual `re_verify` action stays available and preserves the
  prior result rather than overwriting it.
- **Decision 2 — biometrics retained.** `biometric_storage_path`,
  `biometric_kind` (`face_image` / `face_template`), `biometric_captured_at`.
  Stored in a dedicated private bucket, separate from `aml-documents`, so its
  access policy can be tighter. Every read is audited to the hash chain.
  Retention runs on the existing §18 **trigger-based** clock — measured from
  the end of the business relationship, never from upload date.

### Still open

Which Gateway Service Provider to contract for DVS, and whether to take the
OpenSanctions commercial data licence or screen through the same provider.
Both are commercial decisions, not technical ones.

---

## 6. Unchanged: the disclosure boundary

Verification results are **internal AML information**. The client portal shows a
party's own status and what is outstanding — including attempts remaining, so
the client understands the consequence of a third failure. It never shows
screening detail, PEP or adverse-media findings, risk ratings, model scores, or
reviewer commentary. The finance portal sees none of it.

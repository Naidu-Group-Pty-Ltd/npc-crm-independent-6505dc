# Client Portal ↔ Command Center integration matrix

Stage 1 of the full-integration remediation (stacked on PR #1937). Every
connection between the client-facing onboarding flow and the Command Center,
classified honestly. Source of truth for the integration PR's scope; updated
as stages land.

Classifications: **connected** · **partial** · **duplicate** · **manual
bridge** · **missing** · **unsafe** · **legacy only**.

## Client Portal operations (`aml-client-portal` ⇄ `PortalAml.tsx` via `amlPortalApi`)

| Portal op | Tables | Command Center surface | Risk input | Classification | Notes |
| --- | --- | --- | --- | --- | --- |
| `overview` | `aml.cases`, `questionnaire_responses`, `document_requirements`, `client_requests`, `submission_versions`, `consents`, `consent_documents` | Case workspace | — | **connected** (post-#1937) | Session fix restores it; journey state still client-computed → Stage 17 |
| `get_consents` / `record_consent` | `aml.consent_documents`, `aml.consents` | Case events; consent hashes in submission snapshot | — | **connected** | Version-specific acceptance, hash recorded |
| `get_questionnaire` / `save_questionnaire` | `aml.questionnaire_responses` | Questionnaire import (entities) | completeness | **partial** | Staff import to canonical parties is a **manual bridge** (`AmlQuestionnaireImportReport`); no reconciliation work item → Stage 13 |
| related_parties section | `questionnaire_responses.payload.parties` | Ownership & Control | — | **missing** | Declared parties never become canonical parties without manual import; no provenance on changes → Stage 13 |
| `list_requirements` / `request_upload_url` / `confirm_upload` | `aml.document_requirements`, `aml.documents`, bucket `aml-documents` | Documents & Evidence | accepted-docs | **connected** | Case-scoped paths enforced |
| document rejection (staff) → client | `aml.documents.status/rejection_reason` | Documents & Evidence | — | **partial** | Reason reaches `list_documents`, but no notification, no requirement reset contract, no replace-as-version flow → Stage 11 |
| `request_verification_upload_url` | buckets `aml-documents` (doc) / `aml-biometrics` (selfie) | — | — | **connected** | Correct bucket split; biometric never in documents register |
| `verification_status` / `submit_verification` | `aml.verification_checks`, `aml.consents` (biometric) | VerificationSection ("Run check") | — | **partial / manual bridge** | Client creates `pending` row; provider is only invoked when **staff presses Run check** → Stage 4 outbox+worker |
| `list_client_requests` / `respond_client_request` | `aml.client_requests` | Case workspace requests panel | open-requests | **partial** | `request_payload.action` dropped from portal projection (generic text only); response shape mismatch staff-side; no notification on creation → Stages 7–9 |
| `submit_for_review` | `aml.submission_versions`, `aml.cases` status advance | Documents & Evidence (no dedicated surface) | — | **partial** | Immutable snapshot exists; staff has no Submission Review workspace → Stage 10 |

## Identity verification — two record models (the central defect)

| Aspect | `aml.identity_checks` (legacy) | `aml.verification_checks` (canonical target) |
| --- | --- | --- |
| Writers | staff `initiate_idv` (provider factory; simulator history) | portal `submit_verification`, staff `record_document_sighting`, staff `run_verification` |
| Consumers | `aml-risk` mandatory inputs (authoritative-filtered post-#1937); Ownership & Control party links; VerificationTab | portal `verification_status` attempts; VerificationSection |
| Classification | **legacy only** (after this PR: no new production writes) | **canonical** |
| Defects | simulator rows (#1937 classifies non-authoritative); party links point here → Stage 14 | attempts from `MAX(attempt_number)` → Stage 3; no processing pipeline → Stage 4; risk ignores it → Stage 16 |

Staff UI renders **both** `VerificationSection` and `VerificationTab` — **duplicate** → Stage 18 single surface + collapsed legacy history.

## Screening / risk / gate

| Connection | Classification | Notes |
| --- | --- | --- |
| Case-subject screening (`initiate_screening`) | connected | Post-#1937: refusal-typed, outage-safe |
| Party-scoped screening for declared/canonical parties | **missing** → Stage 15 | Only the case subject is screened in the ordinary flow |
| Canonical `verification_checks` → risk mandatory inputs | **missing** → Stage 16 | Risk reads legacy table only (authoritative-filtered) |
| Screening matches → risk staleness | connected | `authoritativeMandatoryInputs` + recalc probes |
| Service gate | connected (separate authorised decision) | Must remain untouched by every new transition |

## Requests, notifications, journey

| Connection | Classification | Notes |
| --- | --- | --- |
| Case activation → portal notification | connected | Existing activation path |
| Client request → portal notification | **missing** → Stage 8 | No notification row, no outbox event, no delivery status |
| Request `action` → portal deep-link | **missing** → Stage 7 | Closed action vocabulary + safe projection required |
| Response contract portal ⇄ staff | **partial** → Stage 9 | Shapes differ; version the contract |
| Portal progress | **partial** → Stage 17 | Client-side percentage; server-derived journey state required |
| Provider readiness → portal capture eligibility | **missing** → Stage 5 | Portal offers capture regardless of provider state |

## Evidence / retention

| Connection | Classification | Notes |
| --- | --- | --- |
| IDV document ↔ evidence reference (P3) | **missing** → Stage 12 | `document_reference` is a bare storage path on the check row |
| Selfie (P6) biometric bucket + access log | connected | `aml-biometrics`, `get_biometric_url` audited |
| Simulator history retention | connected (post-#1937) | Preserved, non-authoritative |
| New records (submissions, requests, notifications, reconciliation) → retention classes | **partial** → Stage 21 | Classes exist in the framework; new tables must declare them |

## Provider / environment

| Connection | Classification | Notes |
| --- | --- | --- |
| Production simulator block, typed refusals, readiness op | connected (PR #1937) | |
| Self-hosted verification service deployment | **missing** (Stage 6 — infrastructure + owner decision) | `services/aml-verification-service` exists, undeployed |
| Staff "Request identity verification" → client action | **partial** | Creates request; not actionable portal-side until Stage 7 |

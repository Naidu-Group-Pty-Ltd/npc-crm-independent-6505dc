# Passport Design Reconciliation

Phase 0A deliverable of the Aurixa AML/CTF Compliance Passport integration.
Reconciles the latest Claude Design (project `a663070e-7bef-413b-a27a-a61b32c89349`,
files `AML Compliance Passport.dc.html` + `PassportPage.dc.html` + brand assets,
last design sync 2026-08-13T09:20:00Z) against the repository architecture.

**Rule applied throughout: the design decides how the Passport looks and feels;
the repository decides how it is allowed to function. On conflict, the
architecture wins.** The design's own copy agrees — its Journey page is headed
"SOURCE OF TRUTH — AML/CTF Journey" and states "The Passport is generated from
this journey — it is not a separate record."

Classifications:

- **CONNECT** — already supported directly; wire the UI to the existing op/record.
- **DERIVE** — deterministically computed from existing authoritative data; a
  pure module, no new storage.
- **ADAPT** — the visual concept survives, the mechanism changes to respect the
  live architecture/security.
- **DEFER** — needs new infrastructure, new security surface, legal review, or
  is outside approved scope. **Not coded in this programme.**

---

## 1. Identity of the two "passports"

The design's "AML/CTF Compliance Passport" and the repo's existing **Compliance
Passport** (`docs/aml/compliance-passport.md`, migration
`20260729090000_aml_reliance_passport.sql`, function `aml-reliance`, panel
`src/components/aml/ReliancePassportSection.tsx`) are the **same product at two
fidelities**. The repo has the record and legal engine (attestations, grants,
manifests, assessments, access log); the design supplies the experience
(cover, booklet, stamps, pages, lifecycle vocabulary). The integration
re-presents the former through the latter. No second record system is created.

## 2. Feature-by-feature reconciliation

### Chrome, identity strip and shell

| Design element | Classification | Repository mechanism |
|---|---|---|
| Aurixa emblem + wordmark chrome | ADAPT | Brand assets from the design project (`aurixa-emblem.png`); colours/typography re-expressed as a scoped token set (see §4). No hard-coded hex in shared UI (`npm run audit:style` hard rule). |
| Portal switcher tabs (Command / Client / Finance / Solicitor / Builder) | ADAPT | Portals are five separate auth domains (per-portal `__Host-*` cookies). Implement as **Command Centre "preview as client"** rendering the real server-side client projection. No cross-portal session switching, no partner impersonation. Design itself flags the three partner tabs "design pass pending". |
| Passport identity strip (name, type chip, passport no., AML case ref, issuing org) | DERIVE | From `aml.cases` (`subject_display_name`, `subject_type`, `case_reference`), current attestation, `aml.tenant_settings.display_name`. |
| Credential number (`AUX-AML-2026-000184`) | DERIVE | One canonical helper: `case_reference` + attestation version → `AUX-AML-2026-1184-V3` style. No stored identifier, no per-portal variants. |
| Status pill (ISSUED · CURRENT etc.) | DERIVE | `passportState.pure.ts` over attestation rows + `service_gate_status` + grants (§3). Never manually editable. |
| "View digital passport" / cover thumbnail | ADAPT | Booklet view of the same projection (§ Booklet). |
| Version selector + version register panel | CONNECT | `aml.compliance_attestations` (`version`, `superseded_at`, v2 reason codes). "An issued version is immutable" is already the table's semantics. |
| Activity button + notification drawer | CONNECT | Existing feeds: staff `notifications`, `client_portal_notifications` (category `aml`), partner tables + `aml.partner_notifications`. No new subsystem. |

### Page 00 — AML/CTF Journey

| Element | Classification | Mechanism |
|---|---|---|
| Phased milestone list with actor/portal/time | DERIVE | `portalJourney.pure.ts` steps + `case_stage` rail (`caseDimensions.ts`) + `aml.case_events`. |
| "Populates …" feed chips | DERIVE | Static mapping from milestone → passport section (presentation metadata in the projection). |
| Seal chip per completed milestone | DERIVE | Same events that drive stamps (§ Stamps). |
| Demo action buttons ("Record reliance accepted", "Reverse for demo") | ADAPT | Demo affordances do not ship. Real actions wire to existing ops (reliance decision = partner's `record_independent_assessment`; never a Command-side "mark done"). |

### Page 01 — Overview

| Element | Classification | Mechanism |
|---|---|---|
| Identity summary card + entity mark | DERIVE | Case subject + `aml.entities`. |
| Compliance components grid (per-dimension states) | DERIVE | Existing evidence-state derivations (`workspaceViewModel.ts` families) recomputed server-side in the projection. |
| Connected portals grid | CONNECT | `aml.partner_case_links` + `reliance_grants` + `reliance_access_log` (last viewed) + `independent_assessments` (decision). |
| Authenticity block, SHA-256 "evidence fingerprint" | CONNECT | `compliance_attestations.payload_sha256`. "Verify integrity" opens the attestation record modal (internal); public verification is DEFER (§ QR). |

### Page 02 — Identity

| Element | Classification | Mechanism |
|---|---|---|
| Identity fields (name, DOB, nationality, address, occupation…) | DERIVE | `aml.questionnaire_responses` (personal_details / entity_details), party records, verification party labels. Field-level allow-list in the projection. |
| Masked identifier numbers, "released only with recorded purpose" | ADAPT | Mask by default in all projections. Full-value release is a Command-only op with mandatory reason + event write (pattern exists: biometric access). v1 ships masked-only; unmask op deferred to Phase 6 unless required. |
| Verified portrait (IDV photo) | **DEFER** | Raw biometric media is P6-classified, bucket `aml-biometrics`, access audited with mandatory reason. Not exposed in any Passport view. The design's no-photo placeholder state ships instead. |
| MRZ line | ADAPT | Decorative/stylised only. Never real MRZ data. |
| Primary identity document card (masked number, dates, "View securely") | DERIVE + CONNECT | Metadata from `aml.documents` / `verification_checks.outcome_detail` allow-list; view via existing 120 s signed-URL ops. |
| Entity particulars | DERIVE | `aml.entities` fields. |

### Page 03 — Verification

| Element | Classification | Mechanism |
|---|---|---|
| Four component cards (document authenticity / facial match / liveness / electronic IDV) | CONNECT | `aml.verification_checks` per party (`check_type`, status, timestamps). Didit Standalone's three calls + document sighting map 1:1. |
| "Score disclosure: Not authorised", "Provider: Recorded internally" | CONNECT | Existing sanitisation rules — scores and provider payloads never leave the case file. The projection simply keeps obeying them. |
| Verification stamp bound to version | DERIVE | Stamp engine (§ Stamps) + attestation version. |

### Page 04 — Ownership & Control

| Element | Classification | Mechanism |
|---|---|---|
| Control structure rows with % and status | CONNECT | `aml.beneficial_owners`, `authorised_representatives`, `entities`, `entity_case_links`, `party_verification_links`. |
| Per-party evidence buttons | CONNECT | `aml.documents` filtered by party; existing signed-URL view. |
| Ownership summary tiles | DERIVE | Aggregates over the same rows. |

### Page 05 — Screening

| Element | Classification | Mechanism |
|---|---|---|
| Screening component cards + currency date | DERIVE | `aml.party_screening_subjects` (projected state), `pep_determinations` (current row), `sanctions_list_syncs` freshness. |
| "INTERNAL BOUNDARY — not part of the Passport" never-shared list | CONNECT | Already enforced: the attestation exclusion list is contract-test-pinned; s 123 tipping-off. The panel is honest copy over an existing guarantee. |
| Screening stamp | DERIVE | Stamp engine. |
| **Audience note** | — | Screening detail is Command-only. Client projection carries at most "screening completed" as a stamp/summary; partner projection only what the manifest's class allows. The design's `CLIENT_PAGES` already omits this page for clients — preserved. |

### Page 06 — Funding & EDD

| Element | Classification | Mechanism |
|---|---|---|
| Source-of-funds composition with per-component evidence state | CONNECT | `aml.source_of_funds` / `source_of_wealth` (+ linked evidence). |
| Compliance decision card ("EDD not required") | DERIVE | `aml.edd_cases` presence/outcome + decision records — **decision facts only, never reasoning**. |
| Funding stamps | DERIVE | Stamp engine. |
| **Audience note** | — | Not client-facing (design agrees); partner-facing only under the `Funding` disclosure class (finance: full where granted; solicitor: limited; builder: withheld — per manifests). |

### Page 07 — Evidence & Document Wallet

| Element | Classification | Mechanism |
|---|---|---|
| Grouped wallet (identity/address/entity/funding/transaction/compliance) with state chips and versions | CONNECT | `aml.documents` + `document_requirements` + version columns (`version_number`, `superseded`). Grouping mirrors `documentPresentation.ts` conventions. |
| "View securely" in-platform viewer, no storage location exposed, no unauthorised download | CONNECT | Existing signed-URL ops (120 s client / 300 s staff), server-generated paths, access logged before URL handover. No new bucket; no copies. |
| **Per-document portal access chips** (`acc:[1,1,1,1,0]`) | **ADAPT** | Live model is **evidence-class disclosure per organisation** (`aml.disclosure_manifests`). UI shows class-level disclosure derived from manifests. Per-document partner ACLs are DEFER (Phase 6+, separate approval). |
| Document access audit modal | CONNECT | `aml.reliance_access_log`, `biometric_access_log`, download audit trails — Command view only. |

### Page 08 — Transaction & Matter

| Element | Classification | Mechanism |
|---|---|---|
| Matter/property facts grid | CONNECT | `aml.transactions` (+ `purchase_files`, `transaction_cases` links where present). |
| **N transactions per case** | ADAPT | The design shows one; the schema allows many (`aml.transactions` is 1 case : N). The page lists all case transactions. |
| Transaction stamps (connected/reliance/shared/settlement) | DERIVE | Stamp engine over transaction status + reliance events. Settlement stamp keys off canonical `aml.transactions.status = 'settled'`. |
| "Transaction management remains outside the Passport" | CONNECT | Copy matches architecture; no transaction mutation from the Passport. |

### Page 09 — Partner Access & Reliance

| Element | Classification | Mechanism |
|---|---|---|
| Partner cards (status, agreement, version received, evidence count, last viewed, accepted by, decision date) | CONNECT | `partner_case_links` (+legal route), `reliance_agreements`/`arrangement_assessments`, `reliance_grants` (`attestation_id` = version received), `reliance_access_log` (last viewed), `independent_assessments` (decision + who). |
| Authorised-disclosure chips + disclosure matrix table | CONNECT | `disclosure_manifests` per grant (granted / limited / withheld per evidence class). |
| Manage access modal | CONNECT | Existing `aml-reliance` grant / revoke / manifest ops (MLRO-gated). |
| Partner stamp modal ("records that organisation's decision only") | CONNECT | `independent_assessments`; copy matches the statutory rule already enforced (partner determinations never write to our case or gate). |

### Page 10 — Stamps & Certifications

| Element | Classification | Mechanism |
|---|---|---|
| Stamp register (circle/rect/seal faces, org, portal, date, version, actor) | **DERIVE** | New pure module `passportStamps.pure.ts` mapping canonical records → a **closed stamp vocabulary** (consent, identity verified, documents verified, ownership verified, screening completed, SoF/SoW reviewed, EDD completed, passport issued/updated/superseded, shared per portal, reliance accepted per portal, independent CDD recorded, refresh requested, access revoked, transaction completed). Sources: `aml.case_events`, `aml.consents`, `aml.independent_assessments`, `aml.transactions`, reliance grant/revocation records. **No stamps table. Portal users cannot author stamps.** |
| Stamp record modal (event detail) | DERIVE | The underlying event row (id, actor, portal, time, version, chain position where available). |
| Pending/dashed placeholder stamps (e.g. settlement pending) | DERIVE | Vocabulary entries whose source event does not yet exist render in pending style. |

### Page 11 — Passport History

| Element | Classification | Mechanism |
|---|---|---|
| Append-only timeline with source-portal chips | CONNECT | `aml.case_events` (hash-chained), audience-filtered by the projection. Command = richest authorised; client = client-safe subset; partner = grant-relevant subset. No new history store. |

### Passport controls

| Control | Classification | Mechanism |
|---|---|---|
| Request client information | CONNECT | `aml.client_requests` (+ existing notify trigger). |
| Issue Passport / Create new version | CONNECT | Attestation issuance (MLRO + approved gate; v2 supersession on material change). |
| Share Passport | CONNECT | Reliance grant issuance (consent + agreement + review-current preconditions). |
| Manage / revoke partner access | CONNECT | Grant revocation (reasoned) + manifest ops. |
| Request refresh | ADAPT | Maps to client request (`re_consent` / `new_document` kinds) + supersession machinery; partner-facing refresh state derives (§3). |
| Suspend | ADAPT | Derives from `service_gate_decisions` → `locked` (MLRO-only, mandatory reason). No new stored passport state. |
| Terminate / Revoke | ADAPT | Gate `terminated` + revocation of grants. Composite convenience op is Phase 6 (optional); v1 wires the existing individual ops. |
| "Dual authorisation required" copy | ADAPT | Enforced as MLRO capability + step-up (`aml-step-up`, `RESTRICTED_OPS`). True four-eyes is DEFER pending separate approval. |
| "Every action written to Passport History with actor, portal and reason" | CONNECT | Existing convention — all such ops append hash-chained `case_events` via the canonical TypeScript writers. |

### Cover, booklet and premium presentation

| Element | Classification | Mechanism |
|---|---|---|
| Navy leather cover + gold foil + emblem + cover facts | ADAPT | New presentation components rendering the same projection; scoped token file (§4). |
| 16-page cream booklet (`PassportPage.dc.html`), page-turn, chips nav, keyboard arrows | ADAPT | Repo-native components (`BookletView`, `PassportPage` blocks mirroring the design's block kinds: fields/summary/rows/chips/matrix/photo/partners/seals/timeline/verify/note/signature). `support.js` (design-canvas runtime) is **not** imported. Reduced-motion honoured; page-turn animation degrades to instant swap. |
| Wax-seal signature block ("Issued by … Head of Compliance") | DERIVE | Issuing officer from case `assigned_mlro_id` / tenant MLRO contact; rendered seal is decorative. |
| "SYNCHRONISED WITH JOURNEY" badge | DERIVE | True by construction (same projection). |
| QR "verify credential" block + `verify.aurixasystems.com` | **DEFER** | No public verification endpoint exists; new attack surface + legal review. The booklet's verify block renders the credential ID + fingerprint without a scannable public URL in v1. |
| Print / export booklet PDF | DEFER (Phase 6 optional) | Via existing WeasyPrint pipeline under `REPORT_RULES.md` if separately approved. |

### Client experience specifics

| Element | Classification | Mechanism |
|---|---|---|
| Client page subset (no screening, no funding, no partner access) | CONNECT | Design's `CLIENT_PAGES` matches the sanitisation rules; enforced server-side by the client projection, not by hiding nav. |
| "CLIENT PORTAL VIEW — screening outcomes, partner reliance decisions and internal compliance material are not shown" note | CONNECT | Honest copy over the server boundary. |
| Milestone messages ("Identity page added to your Passport") | DERIVE | Driven by canonical journey/step state (`portalJourney` + projection); no frontend-only flags. |
| Client actions (replace document, respond to requests) | CONNECT | Existing `aml-client-portal` ops. |

### Notifications

| Element | Classification | Mechanism |
|---|---|---|
| Passport activity drawer entries (issued, superseded, partner reviewed, refresh, evidence attention) | CONNECT | Existing per-portal notification tables + `aml.partner_notifications` (outbox-driven, idempotent). New event *types* only where the catalogue lacks them (additive seeds). |

### Responsiveness & accessibility

| Element | Classification | Mechanism |
|---|---|---|
| Mobile behaviour | ADAPT | Cards/accordions/rails per repo conventions; booklet single-page mode below 900 px (the design already models `bookWide`). |
| Accessibility | ADAPT | Repo rules: labels not colour-only (existing badge convention), focus states, dialog patterns, `prefers-reduced-motion`. |

## 3. State vocabulary (all DERIVE)

`passportState.pure.ts` — one derivation, mirrored read-only in the browser:

| State | Derivation (existing data only) |
|---|---|
| `NOT_ISSUED` | No attestation row for the case |
| `READY_FOR_ISSUANCE` | Gate `approved`/`approved_with_controls`, no current attestation |
| `ISSUED_CURRENT` | Current attestation (`superseded_at IS NULL`) + gate approved |
| `SUPERSEDED` | Per-version: `superseded_at IS NOT NULL` |
| `REFRESH_REQUIRED` | v2 material-input hash drift, material evidence expiry, or open refresh obligation |
| `SUSPENDED` | `service_gate_status = 'locked'` |
| `REVOKED` | `service_gate_status = 'terminated'` (+ grants revoked) |
| `COMPLETED_RETAINED` | Case closed post-settlement; retention triggers active |

No stored passport status column. No manual edit path.

## 4. Visual system decision

The design hard-codes hex values and Google-font links (Source Serif 4 /
Public Sans / Azeret Mono) — both violate repo hard rules (semantic tokens
only; `audit:style` zero new violations). Resolution:

- A **scoped passport token file** (`src/styles/passport-tokens.css`) defines
  the booklet/cover palette (navy leather, cream guilloche paper, gold foil,
  seal tones) as semantic tokens, following the precedent of the template
  colourways and `glass.css`.
- Typefaces map to the repo's existing font stack; if a serif display face is
  required for the booklet it is added deliberately as a token decision in the
  passport scope, not as inline `font-family` in components.
- The Aurixa emblem assets come from the design project; canonical Aurixa
  brand hexes live in `aurixa-systems/src/index.css` (copy + drift-test
  precedent: `aurixa-mission-control/src/lib/brand/aurixa-brand.ts`).

## 5. Deferred register (not coded in this programme)

| Item | Reason |
|---|---|
| Public QR verification / public passport lookup | New public attack surface; legal review; separate authorisation required |
| Client biometric portrait in any Passport view | P6 media; existing audited-access posture must not be weakened |
| Per-document partner ACLs | Backend is evidence-class manifests; would be new authorisation architecture |
| True dual (four-eyes) authorisation | New security architecture; step-up + MLRO capability is the approved v1 control |
| New passport/stamps/history tables | Prohibited for v1 by the database change policy |
| Printable booklet PDF | Optional Phase 6, separately approved |
| Composite suspend/revoke one-click ops | Optional Phase 6; v1 wires existing individual ops |
| Identifier unmask op with recorded purpose | Phase 6 unless demanded earlier; v1 is masked-only |
| Commercial SKU wiring (Mission Control) | Separate approval; seams documented in the integration review |

## 6. Demo content register

All named entities in the design are placeholders and must not ship: "Priya
Naidu", "Meridian Coast Holdings Pty Ltd", "D. R. Okafor", "GT Financial
Services", "Harlow & Vance Legal", "Coastline Developments", every timestamp,
`AUX-AML-2026-000184`, `NPC-MTR-2026-0442`, the property address, and the
`$2,480,000` funding composition. Production renders projections only; empty /
loading / error / unauthorised states are first-class.

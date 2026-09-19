# Retention schedule audit (pre-rollout Stage A3)

Verified against the actual seeded rows in `aml.retention_schedules`
(migrations `20260716193413`, `20260728160000`, `20260805150000`) and the
record-class catalogue as corrected by
`20260828000000_aml_record_classification_correction.sql`. This table
replaces the Phase 6–8 report's unclear phrase "seeded s 107 defaults":
every value below is explicitly marked **statutory-floor**,
**programme-configured**, or **unresolved**.

Legend — *Basis*: **S** = statutory floor (AML/CTF Act 2006 (Cth) s 107 /
s 119 seven-year minimum measured from the recorded trigger event, never
from upload); **C** = programme-configured operational value the MLRO can
change via the existing `upsert_schedule` op; **U** = unresolved — requires
legal/MLRO/privacy confirmation before production use.

| Record code / entity type | Label | Class | Trigger | Seeded duration | Zone | Exportability | Disposal | Basis | Source | Required confirmation |
|---|---|---|---|---|---|---|---|---|---|---|
| `case` | AML case file | (case file; mixed) | relationship_end | 7y | structured_cdd_db | never | soft_delete | **S** | s 107 | none for the floor; MLRO may extend |
| `verification` | Verification outcome record | P3 (structured) | relationship_end | 7y | structured_cdd_db | via evidence path only | redact | **S** | s 107 | none |
| `screening` | Screening evidence | P4 content / P2 procedure facts | relationship_end | 7y | structured_cdd_db | procedure facts only (attestation) | soft_delete | **S** | s 107 | none |
| `transaction` | Transaction evidence | P3/P4 | transaction_date | 7y | structured_cdd_db | via evidence path only (P3 subset) | soft_delete | **S** | s 107 | none |
| `report` | Regulatory report records | **P5** | report_complete | 7y | restricted_reporting_vault | **never** | soft_delete | **S** | s 119 / reporting rules | none |
| `alert` | Monitoring alerts | P4 | relationship_end | 7y | structured_cdd_db | never | soft_delete | **S**(floor)/**C** | Rules Ch 8 | MLRO confirm scope |
| `biometric` | Retained facial image | **P6** | relationship_end (existing) + biometric_necessity_end (Phase 7) | 7y (existing seed) | biometric_vault | **never** | hard_delete | **U** | APP 11.2 vs s 107 tension | **Privacy/MLRO must confirm**: raw capture need NOT be held 7 years; the structured verification outcome carries the s 107 duty. Necessity-end trigger exists; the 7-year raw-object value is a pre-existing seed retained unchanged pending that decision. |
| `partner_case_link` | Partner-case link | P2 | partner_relationship_end | 7y | structured_cdd_db | link metadata partner-visible | soft_delete | **S** | s 107 (arrangement record) | none |
| `partner_records_request` | Records request | P3 | evidence_delivery_end | 7y | structured_cdd_db | own requests partner-visible | soft_delete | **S** | s 107 | none |
| `partner_evidence_delivery` | Evidence delivery read model | P3 | evidence_delivery_end | 7y | structured_cdd_db | own deliveries partner-visible | recorded_only in scans | **S** | s 107 | none |
| `partner_refresh_obligation` | Refresh obligation | P2 | audit_obligation_end | 7y | structured_cdd_db | safe fields partner-visible | soft_delete | **C** | programme | MLRO may shorten |
| `partner_notification` | Partner-safe notification | P2 | record_created (declared creation-date class) | **2y** | structured_cdd_db | own rows partner-visible | hard_delete | **C** | programme | MLRO confirm |
| `attestation` | Compliance attestation | P2 | relationship_end | 7y | attestation_store | sanitised projection only | recorded_only | **S** | s 107 | none |
| `reliance_grant` | Reliance grant | P2 | relationship_end | 7y | structured_cdd_db | own grants partner-visible | recorded_only | **S** | s 107 | none |
| `disclosure_manifest` | Disclosure manifest | P2 | relationship_end | 7y | attestation_store | never (origin record) | recorded_only | **S** | s 107 | none |
| `arrangement_assessment` | Arrangement assessment | **P4** | cdd_arrangement_end | 7y | structured_cdd_db | **never** | soft_delete | **S** | s 37A/s 107 | none |
| `partner_organisation` | Partner organisation record | P2 | partner_relationship_end | 7y | structured_cdd_db | never (origin record) | soft_delete | **S** | s 107 | none |
| `raw_id_document_copy` | Full ID-document image | **P3** (corrected from P5) | raw_id_copy_necessity_end | **0y — clock is necessity, not a period** | aml_document_vault | **controlled evidence path only**, never ordinary export | hard_delete | **U** | APP 11.2 | **Privacy/MLRO must set** the post-necessity disposal window. Deliberately NOT the universal 7-year raw-object period; structured attributes retain separately under `verification`. |
| `legal_hold` (no schedule row) | Legal hold | **P4** (corrected from P5) | legal_hold_release | ledger record — recorded_only, no disposal schedule | audit_retention_ledger | **never** | recorded_only | **C** | programme | none — blocking behaviour unchanged |
| `suspicious_matter_material` (catalogue row, no scan source) | SMR/reporting material | **P5** | report_complete | governed by `report` schedule | restricted_reporting_vault | **never** | recorded_only | **S** | s 119 / s 123 | none |
| ledger classes (`integration_event`, `delivery_attempt`, `access_event`, `retention_trigger`, `disposal_evidence`) | Audit/retention ledger | P4 | audit_obligation_end | no schedule rows — recorded_only | audit_retention_ledger | never | recorded_only | **C** | programme | **MLRO/privacy review recorded**: P4 is a conservative programme classification for internal ledger records; the controlled documents do not explicitly place them. Flagged in the legal/MLRO decision register. |
| `partner_membership_record` (catalogue row) | Portal membership mapping | P3 (as seeded) | partner_relationship_end | follows `partner_organisation` | structured_cdd_db | never | soft_delete | **C** | programme | **Recorded for review**: membership mapping is governance configuration, not CDD evidence; P3 retained pending MLRO/privacy confirmation (framework does not clearly place it). |

**Malformed/unexplained defaults found:** none — every schedule row carries
an explicit legal_basis string and a note. **Invented legal periods:** none —
the two necessity-based classes deliberately carry no fixed period and are
marked unresolved. Items marked **U** or "recorded for review" appear in the
legal/MLRO decision register (`docs/aml/rollout/legal-mlro-decision-register.md`)
and block the corresponding sign-off until confirmed.

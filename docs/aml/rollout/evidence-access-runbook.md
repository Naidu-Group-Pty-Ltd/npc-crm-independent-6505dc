# Evidence-delivery access runbook (Stage B path)

## Architecture (source implemented, locally tested)

Metadata and object are separate channels. `aml.partner_evidence_deliveries`
remains the metadata read model — **no path column exists**; it carries an
OPAQUE `evidence_document_id` → `aml.documents` (private `aml-documents`
bucket, service-role RLS). The only partner route to the object is
`get_partner_evidence_delivery_access` on `aml-reliance`:

1. session → canonical organisation (body can never choose org/tenant);
2. workspace master + portal surface flags; `aml_partner_evidence_delivery_write`;
3. active link, correct portal type, correct case assignment;
4. partner `compliance_officer` role on an active membership;
5. retrieval reason ≥ 10 chars; rate limit 10 attempts/min/membership;
6. runtime catalogue tripwire (raw ID copy must read P3 — else 503, fail
   closed);
7. delivery unrevoked + unexpired, traced to an approved request covering
   EXACTLY that record code for that org/link/case;
8. closed P3-only class rule — P1/P2/P4/P5/P6 and unknown vocabulary refused;
9. arrangement standing on reliance/outsourced routes; manifest revocation
   is a kill switch; any active legal hold withholds with GENERIC wording;
10. document must exist, belong to the case, be `accepted`, carry a path —
    else safe `evidence_object_unavailable` (nothing fabricated);
11. only then: 300-second signed URL via the existing secure mechanism —
    returned once; never persisted; never in DTOs, receipts, notifications,
    outbox payloads or logs; bucket/path never leave the server.

Every attempt (approved/denied/failed) lands in `aml.reliance_access_log`
(`action='evidence_access'`, nullable grant) with membership, portal, link,
delivery, record code, reason and safe result code; approvals append the
hash-chained case event and record the signed expiry (not the URL).

## Operations

- **Grant**: origin review approves the request codes; MLRO records the
  delivery, optionally attaching the accepted case document
  (`evidence_document_id`). Metadata-only deliveries stay valid and answer
  a safe unavailable state on access.
- **Revoke**: revoke the delivery (row-level) — new access stops
  immediately; an already-issued URL lapses within its ≤300 s lifetime.
  Manifest revocation kills all disclosure for the grant at once.
- **Suspend everything**: `aml_partner_evidence_delivery_write` → false
  (both recording and retrieval answer 409).
- **Audit**: filter `reliance_access_log` by `action='evidence_access'`;
  every denial carries a `denial_code`; storage failures appear as
  `result='failed'` with `storage_resolution_failed`.
- **Hold behaviour**: active case/delivery hold ⇒ partner sees only
  "temporarily unavailable" — never the hold's existence or reason.

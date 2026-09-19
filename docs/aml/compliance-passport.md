# Compliance Passport — one AML/CTF process, every portal

Implements the cross-portal flow in the owner's diagram: the Command Centre is
the single source of truth; a verified client's completed compliance is pushed
to the Client, Finance, Builder, Developer and Solicitor/Conveyancer portals;
and a partner organisation that wants its own assessment makes it **inside the
system**, against internally-transferred records — never by re-approaching the
client.

## Legal model

The mechanism is the AML/CTF Act 2006 (Cth) **Part 2 Division 7 (ss 37A–38)**:
a reporting entity may rely on the applicable customer identification
procedure carried out by another reporting entity, under a **written customer
due diligence arrangement** that is **regularly reviewed** — and the relying
entity **remains responsible for its own compliance**. All three statutory
conditions are enforced in code, not policy:

| Condition | Enforcement |
|---|---|
| Written arrangement | `agreement_reference` is NOT NULL; `create_agreement` refuses without it |
| Regular review | `next_review_due` NOT NULL; an overdue review **blocks new grants** (`review_overdue`) |
| Relying entity stays responsible | The independent-assessment path exists, and a partner's determination **never** writes to our case or service gate |

## The passport

An **attestation** is a versioned, SHA-256-addressed, sanitised snapshot of
*what procedures were performed*: parties verified (method, date, document
sighted, certifier capacity), consents held, screening performed with list
freshness, and a service-readiness boolean derived only from an explicitly
approved gate (same rule as the finance contract). It carries its own
`limitations` (no DVS; heuristic liveness) so honesty travels with it.

**Never in the payload:** risk rating or score, screening match content,
reviewer notes, MLRO commentary. A relying partner has no entitlement to our
investigation, and s 123 (tipping off) forbids sharing parts of it regardless.
A contract test pins the exclusion list. MLRO-only, and it refuses to issue
when no party is verified (`nothing_to_attest`).

## The flow

1. **Arrangement** (MLRO): record the written CDD agreement per partner.
2. **Client consent**: new optional `compliance_sharing` consent (APP 6.1(a)),
   published into catalogue v2026.2 so no existing client is re-asked.
   Declining costs the client nothing with us — the partner approaches them
   directly instead. The portal records optional consents **only when ticked**.
3. **Attestation** (MLRO): issue; hash-chained case event written.
4. **Grant** (MLRO): case + agreement → a bearer token, shown once, stored as
   a hash, 90-day expiry, revocable with a reason. Requires the consent
   (traceably — `consent_id` NOT NULL on the grant), an active agreement, a
   current review, and an attestation.
5. **Partner redeems** (`redeem_attestation`): gets the payload + the
   statutory notice that they remain responsible. Every access logged.
6. **Independent assessment** (`record_independent_assessment`): the partner's
   own determination — satisfied / not satisfied / records requested — pinned
   to the attestation's content hash and written to the case timeline. Their
   compliance is theirs; ours is ours; the link is evidence, not authority.

## Surfaces

- `supabase/functions/aml-reliance/` — staff ops (verifyAuth, MLRO-gated
  outward acts) + partner token ops (finance-handoff pattern).
- `src/components/aml/ReliancePassportSection.tsx` — case-workspace panel:
  arrangements, issue, grant, partner assessments at a glance.
- `scripts`/schema: `20260729090000_aml_reliance_passport.sql` (applied live).

## Partner domain phases 1–3 (2026-08)

Three additive, flag-gated layers extend the engine. Flag off = behaviour
above, unchanged. None of them encode a legal conclusion: every legal value
is recorded configuration with a safe incomplete default, reliance defaults
to unavailable, and the independent-CDD route is never gated.

1. **Canonical partner identity** (`aml_partner_identity`, migration
   `20260805100000`): `aml.partner_organisations` (classification requires
   evidence; reliance-capable values are structurally unusable without it),
   `partner_portal_memberships` (maps real portal users; no credentials
   duplicated), `partner_case_links` (the access root: case + org + role +
   one of the four distinct legal routes + documented purpose), and a
   reviewed exact-copy backfill queue for historical free-text agreement
   names (`partner_org_name_mappings` — no fuzzy matching, MLRO resolves
   every row). With the flag on, a new grant requires an ACTIVE
   reliance-route link; `partner_org_id`/`partner_case_link_id` are stamped
   onto grants. Guard: `_shared/aml/relianceEligibility.ts` (pure,
   vitest-covered).

2. **Arrangement governance** (`aml_arrangement_governance`, migration
   `20260805110000`): structured agreement scope + recorded eligibility
   classification + `aml.arrangement_assessments` — an immutable,
   supersede-only review history with one operative row per agreement.
   With the flag on, new reliance grants additionally require an in-force,
   in-scope, eligibility-recorded arrangement with an operative, current,
   suitable assessment. Denials are partner-safe reason codes.

3. **Attestation v2 + disclosure manifests** (`aml_attestation_v2`,
   migration `20260805120000`): v2 issuance requires the EXPLICIT
   approved/approved-with-controls `service_gate_decisions` record, hashes
   canonically (sorted keys), records a deterministic material-input hash
   (party/consent/screening/gate/limitations/subject — presentation fields
   excluded so they cannot force meaningless supersession) and reason
   codes. Each v2 grant carries an `aml.disclosure_manifests` row; every
   partner read is BUILT by intersecting the payload with the manifest
   (denied classes override allowed codes; unknown codes disclose nothing;
   expiry/revocation checked at read; superseded content never served —
   the partner gets `refresh_required`). A deep restricted-key tripwire
   refuses to store or serve a payload carrying internal vocabulary.
   Mechanics: `_shared/aml/attestationV2.ts` (pure, vitest-covered).
   v1 rows remain readable exactly as before.

## Commercialisation note

This is the module boundary for selling Command-Centre access: a partner
organisation's portal integration needs exactly one credential (the grant
token) and one endpoint, receives only the sanitised passport, and gets its
own compliance record out of it. Per-partner scoping, expiry, revocation and
a full access log are already the billing/entitlement seams.

---

## Phase 9 release-candidate status (controlled rollout)

The partner/reliance domain (Phases 1–8 + pre-rollout remediation) is
**source implemented and locally tested** on branch
`claude/aml-ctf-remediation-and-controlled-rollout`: record classifications
corrected (raw ID copy P3, legal hold P4, SMR P5 seeded), controlled
expiring audited P3 evidence access completed, action-level write flags
added (all default false; service/settlement blocking reserved and
enforced nowhere). The 60-migration chain, behaviour battery, rollback
rehearsal and flag dependency order were proven on a disposable local
Postgres (`supabase/tests/aml-local-rehearsal/`). **Staging is not
deployed, staging is not verified, production is not deployed** — no
statement in this document may be read as claiming otherwise. The rollout
sequence, evidence sheets, UAT plan, sign-off register (no sign-offs
obtained) and open legal/MLRO decisions live in `docs/aml/rollout/`.

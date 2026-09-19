# Passport Phase 4 Report — Partner Presentation

Phase 4 upgrades the shared Partner Compliance Workspace with the Passport
identity strip — one implementation, all three portals, presentation only.

## What was built

**`src/components/partner-compliance/PartnerPassportStrip.tsx`**, mounted in
`PartnerComplianceWorkspace` between the refresh banner and the compliance
summary. It renders, from fields the workspace DTO already discloses:

- "AML/CTF Compliance Passport · Issued by <origin>" with version, issue
  date and the shortened evidence fingerprint (full hash on hover);
- the attestation lifecycle badge (`current` / `superseded` /
  `refresh_required` / `revoked` / `expired`) mapped from the DTO's
  existing `attestation_state`;
- the partner's own decision as their seal (reliance-accepted stamp naming
  the PARTNER organisation) — only when a recorded determination exists;
- the version-awareness warning when the recorded decision responds to an
  earlier attestation (`determination.refresh_required`).

Renders **nothing** before an attestation is shared.

## Boundaries honoured

- **No new op, no new pathway, no new disclosure**: the strip consumes
  `PartnerWorkspaceDto` exactly as served by `aml-reliance`'s
  manifest-controlled workspace ops. Grant/expiry/revocation continue to
  fail closed server-side; the strip only presents the DTO's own states.
- **One shared implementation** across Finance / Solicitor / Builder
  (adapters supply labels only, per the existing "no adapter field
  participates in authorisation" rule; developer orgs ride the builder
  surface as the repo mandates).
- **Flag posture unchanged**: the workspace family
  (`aml_partner_compliance_workspace` + per-portal flags) still gates
  everything; no new partner flag exists.
- A partner stamp is constructed only from a real recorded determination —
  no decision, no seal (pinned by test).

## Evidence

| Check | Result |
|---|---|
| `src/components/partner-compliance` suite + new strip tests (4) | pass |
| `amlPortalAdapters.contract.test.ts` (portal independence pins) | pass |
| Combined run: 5 files / 32 tests | pass |

## Deliberately not done

Partner-side booklet, per-document disclosure chips (evidence-class model
stands), any write path. Partner exposure remains conditional on the
reliance rollout decisions recorded in Phase 0B.

# Synthetic pilot tenant (E5) — configuration

For a disposable local stack or a conclusively-identified non-production
staging project ONLY. Obviously-synthetic names; no real ABNs, document
numbers or individuals; the seed script must mint session tokens locally
and never commit them.

## Organisations

| Org | Type | Purpose |
|---|---|---|
| Synthetic Origin Entity Pty Ltd | originating test entity | the Command Center tenant |
| Synthetic Finance Relying Entity Pty Ltd | finance, `eligible_relying_reporting_entity` (with synthetic evidence recorded) | reliance-route pilot |
| Synthetic Finance NoArrangement Pty Ltd | finance, no current arrangement | S07 blocked-grant scenario |
| Synthetic Construction-Only Builders Pty Ltd | builder, `non_reporting_commercial` | S09 — never assumed regulated |
| Synthetic Direct-Sale Developments Pty Ltd | developer-type, served through the Builder/Developer surface ONLY | S26 fail-closed check |
| Synthetic Conveyancing Partners | solicitor_conveyancer | S10 P3 access scenario |

No standalone Developer Portal identity system is created — that absence is
itself a test (S26).

## Personas (all synthetic, `*@example.test`)

origin analyst · origin reviewer · origin MLRO · origin auditor · finance
operations user · finance compliance officer · builder operations user ·
builder compliance officer · solicitor operations user · solicitor
compliance officer · unauthorised cross-organisation attacker (a valid
session in the attacker org used against other orgs' links — S21/S22) ·
suspended-membership user (S24).

Roles matter: operations users must NOT hold `compliance_officer` — they
prepare, never decide, and must be denied determinations and evidence
retrieval.

## Synthetic case fixtures

Individual (documentary), joint purchasers (one late, one name
discrepancy), company (layered ownership + one owner needing
clarification), trust/SMSF (corporate trustee + appointor), biometrics
declined, sharing declined — matching UAT S01–S06. Plus: one accepted
`aml.documents` authority PDF (synthetic content) backing the P3 delivery;
one revoked and one expired delivery; deliveries that would be P4/P5/P6 by
requested code exist ONLY as rejection drills (they can never be approved —
the closed catalogue refuses the codes).

The env variables the E2E spec consumes are listed in
`tests-e2e/aml-partner-pilot/syntheticPilot.e2e.ts`.

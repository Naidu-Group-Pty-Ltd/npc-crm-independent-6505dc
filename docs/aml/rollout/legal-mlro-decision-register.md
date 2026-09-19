# Legal / MLRO / privacy decision register — open items

Nothing here is guessed in code: each item has a safe default that FAILS
CLOSED, and the code carries configuration points, not conclusions. An item
closes only when the named owner records a decision (date, decider,
rationale, config change if any).

| # | Item | Safe state today | Owner | Blocks |
|---|---|---|---|---|
| D1 | Post-necessity disposal window for raw ID-document copies (class P3, necessity clock, years=0 seed — deliberately not a period) | not stored by platform; class catalogued; disposal eligibility only after necessity-end trigger | Privacy + MLRO | sign-offs 3/4; any future raw-copy capture |
| D2 | Raw biometric retention: the pre-existing 7-year `biometric` schedule seed vs APP 11 prompt-destruction once necessity ends | necessity-end trigger exists; existing seed retained unchanged pending decision | Privacy + MLRO | sign-offs 3/4 |
| D3 | Classification of internal ledger classes (outbox events, delivery attempts, access events, retention triggers, disposal evidence) — P4 is a conservative programme default; the controlled documents do not place them explicitly | P4, never exportable, recorded_only | MLRO + privacy | sign-off 4 |
| D4 | `partner_membership_record` seeded P3; membership mapping is governance configuration, arguably not CDD evidence | P3 (more restrictive), never exportable | MLRO + privacy | sign-off 4 |
| D5 | Retention years for partner-domain classes marked programme-configured in `docs/aml/retention-schedule-audit.md` (`partner_notification` 2y, `partner_refresh_obligation` 7y, alert scope) | s 107 floor or conservative default | MLRO | sign-off 4 |
| D6 | SLA warn/escalate values in `aml.partner_sla_targets` | seeded operational targets, labelled non-statutory, MLRO-editable | Operations + MLRO | sign-off 6 |
| D7 | Which arrangement scopes/record classes each pilot partner may request (per-agreement `scope_record_classes`) | empty scope ⇒ every code needs origin review | MLRO | layer-4 enablement |
| D8 | Partner-organisation classifications for pilot orgs (reliance-capable values need recorded evidence — structurally enforced) | `unclassified` blocks reliance-capable behaviour | MLRO | read-only pilot usefulness |
| D9 | Evidence-access TTL (300 s server constant) and rate limit (10/min) — confirm or tune | conservative constants, server-side only | Security + MLRO | sign-off 2 |
| D10 | The controlled documents remain DRAFT frameworks pending legal/privacy/MLRO review — final wording of partner-facing copy and responsibility notices | current copy is safe-worded and fixed in code | Legal | sign-off 5 |

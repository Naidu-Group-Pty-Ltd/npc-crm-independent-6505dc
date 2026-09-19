# Partner compliance operations, reporting and readiness (Phase 8)

Phase 8 of the AML/CTF partner/reliance programme: actionable Command
Center queues, filtered registers, management reporting, SLA ageing and
environment-readiness evidence over the Phases 1–7 domain. Migration:
`supabase/migrations/20260805160000_aml_partner_operations_phase8.sql`
(operational-target configuration + flag only — everything else is read
paths).

## Queues (§8.1, §8.7)

`get_partner_operations_dashboard` (staff, flag-gated) serves twelve queues
— records requests awaiting review, approved-but-undelivered requests,
partner determinations outstanding, open refresh obligations, arrangement
reviews due/overdue, partner classification pending, retention approvals,
disposal failures, outbox retry/dead-letter, sanctions freshness. Each
entry carries: count, oldest item, age state, responsible role and the
register + filter the count was computed from.

Ownership honesty: `partner_determination_pending` and
`partner_refresh_required` belong to `partner_organisation` — the
originating MLRO is never assigned a partner's own decision.

Capability honesty: queues beyond the caller's capability (retention
approval, disposal failure = MLRO; outbox queues = investigator) are
**omitted** by the pure `buildQueueSummary` — never rendered as zeros or
placeholders.

Surfaces: the **Compliance Home** gains `PartnerOpsQueueStrip`
(fails closed — renders nothing while the flag is off or the op errors),
and the full page lives at `/admin/aml/partner-operations` inside the
guarded AML tree, with "Partner Operations" nav entries in both the legacy
and V3 navigation under Organisation Settings.

## Registers and deep links (§8.2)

`list_partner_register` serves thirteen read-only registers (organisations,
links, arrangements, attestations, requests, deliveries, determinations,
obligations, integration events/dead letters, retention candidates, legal
holds, disposal actions, sanctions sources). Capability boundaries come
from the shared `REGISTER_DEFS` — legal holds and disposal actions are
MLRO-only and answer 403 below that. No write verb exists anywhere in the
op: registers are never table administration.

Deep-link contract: a queue count sets `?register=…&status=…` on the
operations page; the page reads those URL params and asks the register op
for the SAME named filter the count used (`pending_review`,
`awaiting_delivery`, `overdue`, `retrying`, `dead_letter`, …) — so a
deep link reproduces exactly the record set behind the number.

## SLA and ageing (§8.3)

`aml.partner_sla_targets` records warn/escalate hours and a responsible
role per queue — **recorded operational targets the MLRO can tune, never
presented as statutory deadlines** (the seed notes and the dashboard's
`sla_note` both say so). The pure `ageState` derives ok/warn/escalate from
the recorded target, with `DEFAULT_SLA_TARGETS` as fallback.

## Management reporting (§8.4)

`get_partner_management_report` (staff, flag-gated, optional date range)
returns tenant-scoped measures — partners (links by legal route, grants
active/revoked/expired, access events, requests by status, deliveries,
determinations by outcome, open refresh), arrangements (overdue reviews,
eligibility states) and records (operative triggers, active holds, due
items, blocked disposals, approvals, failures, evidence receipts). Counts
and controlled codes only; no free-text or restricted column is read.
This deployment is single-tenant (`default`); every partner-domain table
already carries `tenant_id` for the day that changes.

## Readiness and preflight (§8.5, §8.6)

`get_partner_readiness` is BOTH the readiness feed and the read-only
preflight, and is deliberately **not** gated by the reporting flag — it is
the check an operator runs before enabling anything. It reports only:

- **structure probes** — head-only selects against the Phase 1–8 tables
  (`applied` / `missing`);
- **recorded flag values** for all eleven partner-domain flags
  (`enabled` / `disabled`, labelled "recorded configuration — not
  deployment state");
- **thresholds** — outbox backlog (a growing backlog is called out as
  "no consumer is being invoked — operator action required"), retention
  scan recency, sanctions freshness;
- **itself** — `aml-reliance` reports `responding` because it produced the
  response;
- **everything unverifiable from the database** — worker scheduling,
  security-registry currency, test-suite state — as
  `unknown — not verified`, with "source presence is not deployment truth"
  in the evidence.

The state vocabulary is CLOSED (`READINESS_STATES` in
`_shared/aml/partnerOperations.ts`): it contains unknown/missing/
action-required and structurally cannot say live, deployed, operational or
production-ready; `normaliseReadinessItem` collapses any uncatalogued
state to `unknown`. The op is read-only by construction (no write verb, no
RPC) and reads no environment variables, so no secret can leak.

## Flag and staged enablement (§8.8)

`aml_partner_operations_reporting` seeded **false**, never enabled
remotely. Off = dashboard/register/report ops answer 409, the home strip
renders nothing, the operations page shows its disabled notice — and the
readiness panel still reports what the database can evidence. On = the
full operations surface.

## Rollback

Migration header: drop `aml.partner_sla_targets`, delete the flag. Code
rollback: revert the Phase 8 commit.

## Tests

- `src/lib/aml/partnerOperations.test.ts` — behavioural: queue catalogue
  coverage, register linkage, partner-ownership, capability omission
  (absent, not zeroed), SLA defaults + operational-not-statutory wording,
  ageing math, closed readiness vocabulary with no environment-truth words,
  uncatalogued-state collapse.
- `src/lib/aml/amlPartnerOperations.contract.test.ts` — source contracts:
  flag gating (and the deliberate ungating of preflight), deep-link
  round-trip via URL params, fail-closed home strip, guarded route + nav,
  capability boundaries, read-only registers, tenant-scoped reporting with
  no restricted columns, read-only secret-free preflight, normaliser on
  every readiness item, accessibility hygiene (labelled tables, scoped
  headers, own-container scrolling), typed client coverage.

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

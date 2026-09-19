# Support escalation matrix — partner domain pilot

All owner fields are UNASSIGNED until the named humans accept them in the
sign-off register; an unassigned owner is a rollout blocker (E4/E13).

| Concern | First contact | Escalation | Notes |
|---|---|---|---|
| Partner cannot access workspace | platform support (____) | origin operations (____) | check membership, surface flag, link state — all server-side denials carry safe codes |
| Evidence access denied unexpectedly | origin operations (____) | MLRO (____) | read the access log denial_code; NEVER relay hold existence |
| Suspected restricted-info exposure | security owner (____) — SEV-1 | MLRO + privacy (____) | incident-runbook first moves |
| Outbox backlog growing | platform ops (____) | infrastructure owner (____) | worker not being invoked — scheduling is external |
| Sanctions staleness | MLRO (____) | security (____) | no "clear" statements while stale |
| Disposal failure | records operator (____) | MLRO (____) | pointer preserved; failure evidence retained |
| Queue unassigned/overdue (SLA escalate) | queue owner per `aml.partner_sla_targets.responsible_role` | operations lead (____) | partner-owned queues escalate to the PARTNER organisation, never the origin MLRO |
| Pilot partner question about their own obligations | their own compliance officer | — | we never advise a partner on its compliance; responsibility notice wording governs |

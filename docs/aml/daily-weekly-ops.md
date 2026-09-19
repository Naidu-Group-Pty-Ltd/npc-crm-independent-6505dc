# AML Daily & Weekly Operations

## Daily (per analyst)

- **Morning (first 30 min)**
  - Review Monitoring alerts overnight; acknowledge false positives, escalate the rest.
  - Sweep Investigations for cases without an update in >48 h.
  - Confirm no failed provider webhooks in Configuration → Providers.
- **Midday**
  - Clear Verification queue (auto-decisioned items only need spot-check).
  - Progress EDD cases past their SLA checkpoints.
- **End of day**
  - Log outcomes in Investigations before signing off.
  - Post a shift-handoff note (see `shift-handoff.md`).

## Daily (MLRO)

- Approve or reject AI proposals in Governance → AI Approvals within 24 h of creation (auto-expires).
- Review any high-risk EDD cases queued for MLRO decision.
- Sign off SMR / TTR drafts. Nothing is submitted without an MLRO decision.

## Weekly

- **Monday** — review release-gate history in Governance; open a ticket for any warn/fail.
- **Wednesday** — reconcile retention scans in Records & Privacy; approve deletions.
- **Friday** — walk the risk register in Launch Ops; retire mitigated items, refresh review dates.
- **Rolling** — one resilience drill per fortnight (Backup, Provider outage, Secret rotation, Tabletop). Log via Governance → Resilience Drills.

## Monthly

- MLRO board pack: export from Governance + Launch Ops.
- Provider metrics rollup: Configuration → Providers → 30-day view.
- Independent review checklist against the traceability matrix.

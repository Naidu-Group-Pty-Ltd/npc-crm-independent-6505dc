# AML Risk Register — baseline

Baseline governance risks tracked in **Launch Ops → Risks**. Owners update status; the MLRO reviews monthly.

| Code | Title | Category | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- | --- |
| R-01 | External provider outage (IDV / PEP / sanctions) | Provider | medium | high | Multi-provider fallback in `aml-tenant`; degraded-mode banner; alert MLRO |
| R-02 | Tipping-off breach via chat, notes, or export | People | low | critical | UI guard rails on shared notes, staff training, tipping-off rule scanner |
| R-03 | AI hallucinated write action reaching production | AI | low | high | Phase 13 AI guardrail: every write proposal requires MLRO approval; auto-expire in 24 h |
| R-04 | Retention schedule not enforced (data kept beyond obligation) | Data | medium | medium | Cron retention scan, legal-hold precedence, MLRO weekly review |
| R-05 | Rollout advance without acceptance evidence | Process | medium | high | broad_production requires latest release gate = pass; all advances need reason + audit entry |
| R-06 | Secret leak (service-role key, provider key) | Security | low | critical | Rotation runbook + Governance drills logged in `resilience_drills` |
| R-07 | Non-AML surfaces regress after AML change | Engineering | medium | medium | AS-13 tri-portal regression before every phase merge |
| R-08 | Backup / restore untested | Resilience | medium | high | Quarterly backup drill logged in Governance |

Extend as tenant-specific risks emerge — for example, jurisdictional expansion, new provider contracts, or unusual client segments.

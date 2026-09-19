# AML/CTF Operator Quick Start

Audience: AML analysts, MLRO, and operations engineers.

## First 15 minutes on a new shift

1. Sign in to the Command Centre and open **Admin → AML/CTF**.
2. Confirm the current rollout stage in **Launch Ops → Rollout**. If you were expecting broad_production and it shows anything else, stop and page the MLRO.
3. Open **AUSTRAC Reporting** and review any drafts pending MLRO sign-off.
4. Open **Monitoring → Alerts** and clear anything already triaged; anything unresolved older than 24 h becomes an EDD case.
5. Open **Investigations** and confirm no case has been stale for more than 3 business days without an update.

## Where things live

| Task | Surface | Guard |
| --- | --- | --- |
| KYC / verification queue | Intake Queue, Verification | `aml.view` |
| PEP / Sanctions review | Screening | `aml.investigate` |
| Case management | Investigations, EDD | `aml.investigate` |
| SMR / TTR / IFTI drafts | AUSTRAC Reporting | `aml.report` (MLRO) |
| Retention / disposal / privacy | Records & Privacy | `aml.view` |
| Release gates, AI approvals, drills | Governance | `aml.view` |
| Rollout stage, acceptance, risks | Launch Ops | `aml.view` |
| White-label + providers | Configuration | `aml.configure` (MLRO) |

## Step-up

MLRO-only surfaces (Reporting and Configuration) issue a 6-digit challenge and grant a 15-minute session. Sessions are visible in **Governance → Step-Up Sessions**; revoke any you did not initiate.

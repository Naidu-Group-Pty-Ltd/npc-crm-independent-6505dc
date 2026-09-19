# PDF Import Production Rollout Risk Register

## Usage

Use this register to track risks before and during controlled rollout.

Do not include:
- client PDFs
- raw extracted text
- screenshots
- signed URLs
- PII
- private logs
- secret values

## Risk Register

| ID | Domain | Risk | Severity | Likelihood | Status | Owner | Mitigation | Target Phase | Notes |
|---|---|---|---|---|---|---|---|---|---|
| PDF-ROLL-001 | permissions | No formal operator/admin role model yet | high | likely | open |  | Define role model + permission matrix | 11B |  |
| PDF-ROLL-002 | monitoring_alerting | No automated failure/degradation alerts | high | likely | open |  | Add alerting for failed imports, stuck finalize, sidecar errors, regression degradation | 11C |  |
| PDF-ROLL-003 | release_governance | CI/release gates not automated | high | possible | deferred |  | Enforce manual golden regression check until 11D | 11D |  |
| PDF-ROLL-004 | artifact_retention | No artifact/history retention policy | high | possible | deferred |  | Define retention + cleanup policy; monitor storage growth | 11E |  |
| PDF-ROLL-005 | support_runbooks | Runbooks/rollback SOPs not authored | high | possible | open |  | Author import failure, export parity, self-healing, rollback runbooks | 11F |  |
| PDF-ROLL-006 | client_impact | Client-safe reporting boundaries undefined | medium | possible | deferred |  | Define client-safe reporting/audit export | 11G |  |
| PDF-ROLL-007 | data_privacy | Historical imports predate Phase 10 metadata | low | frequent | accepted |  | Accepted; backfill optional | 11A |  |
| PDF-ROLL-008 | performance_cost | OCR/high-risk imports need manual review | medium | likely | accepted |  | Require manual review for OCR/high-risk categories | 11A |  |

## Domains

- phase10_lock
- security_access
- deployment
- operator_workflow
- permissions
- monitoring_alerting
- release_governance
- data_privacy
- support_runbooks
- performance_cost
- artifact_retention
- client_impact
- rollout_scope

## Severity Definitions

- **critical**: Blocks production rollout.
- **high**: Must be resolved before broader production rollout.
- **medium**: Acceptable for limited rollout only with mitigation.
- **low**: Improvement item.
- **info**: Observation.

## Status Definitions

- **open**: Needs action.
- **accepted**: Known and accepted with mitigation.
- **fixed**: Resolved.
- **deferred**: Moved to later phase.

## Final Rollout Decision

Decision: rollout_ready / rollout_ready_with_conditions / rollout_not_ready

Rollout mode: internal_dev_only / admin_limited / controlled_team_rollout / broad_production / blocked

Notes:

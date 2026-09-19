# PDF Import Initial Rollout Scope

## Rollout Mode

Recommended initial mode:

- internal_dev_only
- admin_limited
- controlled_team_rollout
- broad_production
- blocked

Selected mode: admin_limited

## Allowed Users

| Role/User | Allowed? | Notes |
|---|---|---|
| Developer Admin | yes | Full access |
| Product Admin | yes | With manual review discipline |
| QA Operator | no | Enable in controlled_team_rollout (Phase 11B) |
| General Operator | no | Enable after permissions + runbooks |
| Client/User | no | Never in admin_limited |

## Allowed PDF Types

| PDF Type | Allowed? | Required Review |
|---|---|---|
| simple_document | yes | standard |
| design_heavy | yes | manual review recommended |
| multi_page_report | yes | standard |
| table_heavy | yes | manual review recommended |
| image_heavy | yes | manual review recommended |
| scanned_ocr | yes | manual review required |
| mixed_complex | yes | manual review required |
| high_risk | yes | manual review required |
| unknown | yes | manual review required |

## Allowed Actions

| Action | Allowed? | Confirmation Required? | Notes |
|---|---|---|---|
| Evaluate Only | yes | no | read-only |
| Evaluate + Persist | yes | yes | admin only |
| Build Import Intelligence | yes | no |  |
| Build Repair Patterns | yes | no |  |
| Build Adaptive Policy | yes | no |  |
| Build Self-Healing Plan | yes | no | dry_run default |
| Build Performance Audit | yes | no |  |
| Build Operator Controls | yes | no |  |
| Run Export Parity Automation | yes | yes |  |
| Save Golden History | yes | yes |  |
| Mark Accepted | yes | yes | blocked on failing gate |
| Mark Accepted With Warnings | yes | yes |  |
| Mark Rejected | yes | yes |  |
| Mark Manual Review Required | yes | yes |  |
| Run AI Reconciliation | manual only | manual only | blocked if policy blocks AI |
| Apply Repair | manual only | manual only |  |
| Apply Reconciliation | manual only | manual only |  |
| Rerun Import | manual only | manual only |  |

## Required Manual Review Conditions

- scanned_ocr
- high_risk
- adaptive policy manual_review
- adaptive policy blocked
- repair pattern manual_review_only / block_until_review
- missing_major_visual_element
- export parity manual_required
- golden quality gate fail/blocked
- operator blocked / manual review state

## Rollback Plan

_Document Edge Function + frontend rollback (Phase 11F). Until then, rollback is a
manual redeploy of the previous known-good build/function by a developer admin._

## Support Escalation

_Escalate to a developer admin. Formal escalation SOP in Phase 11F._

## Monitoring Requirements

_Manual scheduled checks of `/admin/pdf-import-diagnostics` and the final SQL until
automated alerting lands in Phase 11C._

## Notes

# PDF Import Production Runbooks

## Purpose

This folder contains the operational runbooks and SOPs for the PDF import
production system.

## Audience

- PDF operators
- QA operators
- PDF admins
- developer admins
- business stakeholders

## How To Use These Runbooks

1. Identify the workflow or alert.
2. Open the relevant SOP.
3. Confirm your role/capability.
4. Follow the procedure.
5. Observe stop conditions.
6. Capture evidence.
7. Escalate when required.
8. Do not bypass quality gates.

## Runbook Index

| Runbook | Domain | Criticality | Audience |
|---|---|---|---|
| [Operator Quick Start](pdf-import-operator-quick-start.md) | orientation | critical | operator+ |
| [Daily Operations Checklist](pdf-import-daily-operations-checklist.md) | daily_operations | high | operator+ |
| [Weekly QA Checklist](pdf-import-weekly-qa-checklist.md) | weekly_operations | high | qa+ |
| [Evaluate Only SOP](pdf-import-evaluate-only-sop.md) | import_workflow | critical | operator+ |
| [Evaluate + Persist SOP](pdf-import-evaluate-persist-sop.md) | import_workflow | critical | admin+ |
| [Visual QA Review SOP](pdf-import-visual-qa-review-sop.md) | visual_quality | high | qa+ |
| [Repair Pattern Review SOP](pdf-import-repair-pattern-review-sop.md) | repair | high | qa+ |
| [Adaptive Reconciliation SOP](pdf-import-adaptive-reconciliation-sop.md) | adaptive_reconciliation | high | admin+ |
| [Self-Healing Review SOP](pdf-import-self-healing-review-sop.md) | self_healing | high | admin+ |
| [Export Parity Review SOP](pdf-import-export-parity-review-sop.md) | export_parity | high | qa+ |
| [Golden Regression Review SOP](pdf-import-golden-regression-review-sop.md) | golden_regression | high | qa+ |
| [Monitoring Alert Response SOP](pdf-import-monitoring-alert-response-sop.md) | monitoring_alerts | critical | admin+ |
| [Permission Denied SOP](pdf-import-permission-denied-sop.md) | permissions | critical | all |
| [Retention Candidate Review SOP](pdf-import-retention-candidate-review-sop.md) | retention | high | admin+ |
| [Release Gate Failure SOP](pdf-import-release-gate-failure-sop.md) | release_gate | high | developer_admin |
| [Incident Response SOP](pdf-import-incident-response-sop.md) | incident_response | critical | admin+ |
| [Rollback + Escalation SOP](pdf-import-rollback-escalation-sop.md) | rollback | critical | developer_admin |
| [Client Communication Boundaries](pdf-import-client-communication-boundaries.md) | client_communication | critical | admin / stakeholder |

## Golden Rules

- Do not call AI automatically.
- Do not mutate templates automatically.
- Do not delete artifacts.
- Do not bypass quality gates.
- Do not expose private PDFs or signed URLs.
- Do not send internal diagnostic details to clients.
- Escalate when blocked, uncertain, or unsafe.

## Key Admin Routes

- `/admin/pdf-golden-regression`
- `/admin/template-import-quality`
- `/admin/pdf-import-diagnostics`
- `/admin/pdf-import-monitoring`
- `/admin/pdf-import-retention`
- `/admin/pdf-import-engine`
- `/admin/template-builder`

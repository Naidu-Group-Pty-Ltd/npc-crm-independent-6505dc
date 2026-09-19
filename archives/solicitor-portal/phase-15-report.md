# Phase 15 — Cutover, regression and legacy removal

## Delivered
- Added a service-role-only, firm-scoped rollout control plane with an explicit transition graph, immutable history, approval evidence, reconciliation-run records, hash-only dual-read comparisons, and an always-available rollback.
- Added a guarded readiness decision covering mismatch divergence, dead letters, critical alerts, case-link issues, access exceptions, plaintext sessions, unsafe documents, four-party approval, and a stable release window.
- Wired matter authorization to preserve the legacy adapter in shadow/rollback modes, compare both models during dual-read stages, and use the target grant only at cutover.
- Added Command Centre rollout/readiness controls and an operator runbook.

## Phase gate
Phase 15 expansion is implemented. Contraction is intentionally **not** performed: this repository contains no production stable-window or firm approval evidence. Legacy removal requires a later reviewed migration after the readiness gate passes for every affected practice.

# PDF Import Phase 11C — Alert Policy

The canonical monitoring rule catalog: **34 rules across 16 domains**. Generated
from `src/lib/reportTemplate/ingestion/monitoring/monitoringEventRules.ts` — the
source of truth. Severity ladder: `info` < `warning` < `high` < `critical`.
Lifecycle statuses: `open`, `acknowledged`, `resolved`, `suppressed`,
`false_positive`.

`Release-blocking` marks rules whose active (open/acknowledged) instances should
be triaged before a production release. This layer is advisory and
**NON-remediating** — it never blocks, repairs, retries, reruns, or reconciles
anything by itself.

## Severity escalation

Some rules escalate their default severity based on how far past threshold the
metric is (see `monitoringEventSignals.ts`). For example, `import_failure_detected`
is `warning` at ≥1 failure, `high` at ≥3, and `critical` at ≥8 in 24h.

## Rule catalog

### import_pipeline

| Rule ID | Severity | Owner | Release-blocking | Title |
| --- | --- | --- | --- | --- |
| `import_failure_detected` | high | developer_fullstack | true | PDF import failures detected |
| `import_stuck_in_progress` | high | developer_backend | true | PDF imports stuck in progress |
| `import_error_rate_high` | high | developer_fullstack | true | PDF import error rate is high |
| `import_duration_regression` | warning | developer_backend | false | PDF import duration regression |

### sidecar_diagnostics

| Rule ID | Severity | Owner | Release-blocking | Title |
| --- | --- | --- | --- | --- |
| `sidecar_diagnostics_failed` | high | developer_sidecar | true | Sidecar diagnostics jobs failed |
| `sidecar_engine_version_missing` | warning | developer_backend | false | Engine version missing |
| `sidecar_unavailable` | critical | developer_sidecar | true | Sidecar unavailable |

### artifact_integrity

| Rule ID | Severity | Owner | Release-blocking | Title |
| --- | --- | --- | --- | --- |
| `source_raster_missing` | high | developer_backend | true | Source rasters missing |
| `artifact_bucket_public_exposure` | critical | security | true | Artifact bucket publicly exposed |

### visual_quality

| Rule ID | Severity | Owner | Release-blocking | Title |
| --- | --- | --- | --- | --- |
| `visual_qa_missing` | warning | developer_frontend | false | Visual QA missing |
| `visual_qa_low_similarity` | high | qa | true | Visual QA low similarity |

### repair

| Rule ID | Severity | Owner | Release-blocking | Title |
| --- | --- | --- | --- | --- |
| `repair_audit_missing` | warning | developer_backend | false | Repair audit missing |
| `repair_failure_rate_high` | high | developer_backend | true | Repair failure rate high |

### reconciliation

| Rule ID | Severity | Owner | Release-blocking | Title |
| --- | --- | --- | --- | --- |
| `reconciliation_manual_backlog` | warning | manual_review | false | Reconciliation manual backlog |
| `reconciliation_plan_unresolved` | warning | manual_review | false | Reconciliation plans unresolved |

### export_parity

| Rule ID | Severity | Owner | Release-blocking | Title |
| --- | --- | --- | --- | --- |
| `export_parity_missing` | warning | operator | false | Export parity missing |
| `export_parity_failed` | high | developer_frontend | true | Export parity failed |
| `export_parity_manual_required` | warning | manual_review | false | Export parity manual review required |

### golden_regression

| Rule ID | Severity | Owner | Release-blocking | Title |
| --- | --- | --- | --- | --- |
| `golden_quality_gate_failed` | critical | qa | true | Golden quality gate failed |
| `golden_quality_gate_blocked` | critical | operator | true | Golden quality gate blocked |
| `golden_baseline_degraded` | warning | qa | false | Golden baseline degraded |
| `golden_corpus_coverage_incomplete` | warning | qa | false | Golden corpus coverage incomplete |

### release_gates

| Rule ID | Severity | Owner | Release-blocking | Title |
| --- | --- | --- | --- | --- |
| `release_gate_blocked` | critical | developer_fullstack | true | Release gate blocked |
| `release_readiness_regressed` | high | developer_fullstack | true | Release readiness regressed |

### backend_contract

| Rule ID | Severity | Owner | Release-blocking | Title |
| --- | --- | --- | --- | --- |
| `backend_unknown_operation` | critical | developer_backend | true | Backend unknown operation detected |
| `backend_contract_drift` | high | developer_backend | true | Backend contract drift |

### security_privacy

| Rule ID | Severity | Owner | Release-blocking | Title |
| --- | --- | --- | --- | --- |
| `private_artifact_exposure_risk` | critical | security | true | Private artifact exposure risk |
| `raw_content_persistence_risk` | critical | security | true | Raw content persistence risk |

### permissions

| Rule ID | Severity | Owner | Release-blocking | Title |
| --- | --- | --- | --- | --- |
| `permission_escalation_detected` | critical | security | true | Permission escalation detected |
| `unauthorized_write_attempt` | high | security | false | Unauthorized write attempt |

### performance

| Rule ID | Severity | Owner | Release-blocking | Title |
| --- | --- | --- | --- | --- |
| `performance_budget_exceeded` | high | developer_backend | false | Performance budget exceeded |

### quality_gates

| Rule ID | Severity | Owner | Release-blocking | Title |
| --- | --- | --- | --- | --- |
| `quality_gate_regression` | high | qa | true | Quality gate regression |

### operator_controls

| Rule ID | Severity | Owner | Release-blocking | Title |
| --- | --- | --- | --- | --- |
| `operator_control_blocked_bypass` | critical | security | true | Blocked operator control bypass |

### monitoring_self

| Rule ID | Severity | Owner | Release-blocking | Title |
| --- | --- | --- | --- | --- |
| `monitoring_check_stale` | warning | developer_fullstack | false | Monitoring check is stale |


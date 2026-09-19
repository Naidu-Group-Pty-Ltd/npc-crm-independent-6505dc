# Market Updates Phase 10 — continuous automation

Phase 10 adds idempotent pg_cron scheduling for hourly ingestion and canonical 24-hour, weekly, bi-weekly, monthly, quarterly and annual digests. Dispatch reads the Supabase URL and dedicated cron secret from Vault by name at execution time; migration source contains no credential values. Scheduled digests pass a protected reference timestamp so they close the preceding canonical window.

Automation dispatches are recorded with safe request metadata. The existing database-backed ingestion acquisition function continues to provide single-flight execution and stale-run recovery. A scheduled evaluator maintains admin-only alerts for stale cron, repeated source failures, provider failures, failed digests and abnormal publication gaps.

The authoritative status contract exposes a sanitised heartbeat and configured-job count to authorised viewers, while required-secret readiness and operational alert details are returned only to administrators. Repository changes do not prove jobs exist in production: migration application, function deployment and live cron history inspection remain required.

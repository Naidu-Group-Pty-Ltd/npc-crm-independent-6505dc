# Market Updates Phase 11 — observability and safe errors

Market Updates requests now carry a generated or validated correlation ID from secure frontend invocation through status, ingestion, source fetches, classification, persistence, digest, Q&A and feed responses. Correlation IDs are stored on operational records through an additive migration and are safe identifiers rather than credentials.

A shared observability helper emits structured JSON events containing only function, stage, status, duration, run/source identity, provider route/model, retry/HTTP details and a sanitised error class. It classifies deployment, migration, RLS/session, provider, source, persistence, digest and cron failures without returning raw provider bodies or stack traces.

The frontend operational alert displays stage, function, HTTP status, correlation ID, retryability and remediation. Secure invocation no longer logs full Market Updates error bodies and preserves the same correlation ID across an authentication retry.

This repository phase does not deploy functions or verify production logs. Live log inspection and credential-leak review remain required after authorised deployment.

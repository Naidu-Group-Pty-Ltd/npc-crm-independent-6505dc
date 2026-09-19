# ADR 015: Correlated, privacy-safe portal observability

- **Status:** Accepted for Phase 14
- **Date:** 2026-07-30

Operational telemetry is separate from evidentiary audit. Every event requires a correlation ID, actor, portal, and optional case/matter/firm dimensions; metadata rejects private legal, financial-position, raw contract, SMR, and restricted AML keys. Evidentiary mutations continue to write their mandatory audit records.

High-severity security, audit, settlement, malware, privacy, cross-client linking, and authentication events create durable operator alerts. Metrics are derived from immutable operational events rather than mutable counters. Command Centre can inspect correlation chains, acknowledge alerts, resolve with notes, and use the existing guarded outbox replay control.

Workers emit delivery latency and outcome, notification failure, audit verification, malware, AI run, and projection telemetry. Solicitor commands emit audit-write outcome; authentication and stale writes emit dedicated events. Alert creation is transactional with its triggering event so critical failures cannot remain silent.

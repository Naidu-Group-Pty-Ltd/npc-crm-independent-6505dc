# ADR 014: Firm-governed contract intelligence

- **Status:** Accepted for Phase 13
- **Date:** 2026-07-30

## Decision
External legal AI is deny-by-default at both practice and immutable-document level. A run requires recorded firm consent, an approved provider/model, a versioned prompt, a clean reviewed immutable source, explicit document permission, token/cost limits, and an available circuit breaker.

The idempotency key is derived from matter, immutable source SHA-256, prompt version, and model. Every run records provider/model, prompt, source version/hash, redaction profile, jurisdiction, token/cost usage, correlation ID, output hash, requester, timestamps, failure code, and review/supersession history.

AI output remains assistive and `review_required`. It cannot update operational matter, Finance, or client-visible fields. Practitioner review is an append-only record; removing an analysis from the active workspace supersedes it without deleting provenance. Application logs contain identifiers and error codes only, never source document content or provider output.

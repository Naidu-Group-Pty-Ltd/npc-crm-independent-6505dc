# PDF Import Release Gate Policy

## Policy Summary

A release must not proceed if critical PDF import checks fail.

## Required Local Checks

- source integrity
- docs / schema / SQL presence
- test suite
- build
- private artifact scan
- safety pattern scan
- permission matrix sanity
- monitoring module sanity

## Optional Live Checks

- Supabase SQL validation
- monitoring function invocation
- Cloud Run sidecar health

## Decision Rules

### pass

All critical/high checks pass. No warnings or only info-level notices, and the
score is ≥ 95.

### pass_with_warnings

No critical failures and no disallowed high failures. Score ≥ 75. Warnings /
unknowns / accepted non-critical failures are documented.

### fail

Any critical failure, two or more high failures, or score < 75.

### skipped

Gate intentionally skipped (all checks skipped).

## Critical Failures

- no build
- tests fail
- private files staged
- service role exposed in frontend
- automatic AI execution
- automatic template mutation
- manual-only action auto-execution
- quality gate bypass
- missing permission matrix
- missing monitoring layer
- missing golden regression modules

## Warning Conditions

- optional live checks not configured
- GitHub Actions workflow not enabled yet
- some legacy imports missing Phase 10 metadata
- external alert channels not configured
- broad production rollout still blocked

## Required Human Review

A release with warnings requires:

- a reviewer note
- explicitly accepted warnings
- a named follow-up owner

The reviewer records these in the release gate report template
(`phase-11d-release-gate-report.template.md`).

# PDF Import Phase 11 Production Rollout Checklist

## Phase 11A — Rollout Readiness

- [ ] Phase 11A doc exists.
- [ ] Risk register template exists.
- [ ] Readiness report template exists.
- [ ] Initial rollout scope template exists.
- [ ] Rollout readiness SQL exists.
- [ ] Rollout readiness evaluator/tests pass.
- [ ] Recommended rollout mode recorded.

## Phase 11B — Role-Based Permissions

- [ ] Permission docs exist.
- [ ] Permission matrix exists.
- [ ] Permission schema exists.
- [ ] Permission evaluator/tests pass.
- [ ] Unknown/no_access denied.
- [ ] Admin writes gated.
- [ ] Manual-only actions remain manual.
- [ ] Backend write enforcement documented or implemented.

## Phase 11C — Monitoring + Alerting

- [ ] Monitoring docs exist.
- [ ] Alert policy exists.
- [ ] Monitoring events table exists.
- [ ] Monitoring Edge Function exists.
- [ ] Monitoring admin page exists.
- [ ] Alerts can be listed.
- [ ] Alerts can be acknowledged/resolved.
- [ ] Critical safety alerts detected.
- [ ] Monitoring tests pass.

## Phase 11D — Release Gate / CI

- [ ] Release gate docs exist.
- [ ] Release gate CLI exists.
- [ ] Release gate config exists.
- [ ] Release gate tests pass.
- [ ] Static release gate runs without secrets.
- [ ] Private artifact scan works.
- [ ] Unsafe source pattern scan works.
- [ ] Build included in release gate or documented.

## Phase 11E — Retention + Cleanup Policy

- [ ] Retention docs exist.
- [ ] Retention events table exists.
- [ ] Retention Edge Function exists.
- [ ] Retention admin page exists.
- [ ] Retention scan is dry-run only.
- [ ] No physical cleanup occurs.
- [ ] Retention tests pass.

## Phase 11F — Runbooks + SOPs

- [ ] Runbook folder exists.
- [ ] Operator quick start exists.
- [ ] Daily operations checklist exists.
- [ ] Weekly QA checklist exists.
- [ ] Critical SOPs exist.
- [ ] Escalation matrix template exists.
- [ ] Training checklist exists.
- [ ] Runbook registry/evaluator tests pass.

## Phase 11G — Client-Safe Reporting

- [ ] Client report docs exist.
- [ ] Client report policy exists.
- [ ] Client reports table exists.
- [ ] Client report Edge Function exists.
- [ ] Client report admin page exists.
- [ ] Sanitizer tests pass.
- [ ] Reports require approval before export.
- [ ] Unsafe content blocked/redacted.

## Final Technical Checks

- [ ] npm run build passes.
- [ ] Phase 11H tests pass.
- [ ] Phase 11A–11G tests pass.
- [ ] Phase 10 tests pass.
- [ ] Phase 9 foundation tests pass.
- [ ] Release gate passes or pass_with_warnings.
- [ ] Final SQL runs.
- [ ] Production preview smoke test passes.

## Final Safety Checks

- [ ] No automatic AI execution.
- [ ] No automatic template mutation.
- [ ] No automatic cleanup/deletion.
- [ ] Manual-only actions remain manual-only.
- [ ] Quality gates not bypassed.
- [ ] Permission gates active.
- [ ] Monitoring active.
- [ ] Retention dry-run only.
- [ ] Client reports sanitized.
- [ ] Private artifacts not staged.

## Final Decision

Decision:
- [ ] production_rollout_locked
- [ ] production_rollout_locked_with_conditions
- [ ] production_rollout_not_locked

Rollout mode:
- [ ] internal_dev_only
- [ ] admin_limited
- [ ] controlled_team_rollout
- [ ] broad_production
- [ ] blocked

Notes:

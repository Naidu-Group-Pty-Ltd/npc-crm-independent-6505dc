# AML Progressive Rollout Playbook

Four stages, gated per tenant. Every advance is written to `aml.rollout_stage_history` with actor, reason, and timestamp; broad production additionally requires the latest release gate to be `pass`.

## Stages

1. **internal_dev_only** — engineering + MLRO shadow use. Real data OFF.
2. **admin_limited** — MLRO + designated senior analyst run pilot cases. Read-only exposure to other admins.
3. **controlled_team_rollout** — full analyst team; client portal onboarding enabled behind allowlist.
4. **broad_production** — all clients; monitoring, reporting, and finance handoff live.

## Preconditions per advance

| Advance | Required evidence |
| --- | --- |
| dev → admin_limited | AS-01..AS-05 passed. Providers configured for at least one live check. Consent flow reviewed by legal. |
| admin_limited → controlled_team | AS-06..AS-11 passed. Two shift handoffs completed cleanly. All Phase 13 drills scheduled. |
| controlled_team → broad_production | AS-12 verified. Latest release-gate PASS. Risk register: zero `open` items with impact = `critical`. Independent review sign-off attached in "reason" field. |

## Rollback

- Anyone with MLRO role may roll back one stage at any time.
- Rollback writes to `rollout_stage_history` with the reason.
- Rollback does not disable the AML feature flag; use `feature_flags.aml_ctf = false` for full kill-switch.
- Post-rollback: run the release gate immediately, open a risk-register entry with owner + review date, then perform an incident review.

## Kill switch

- Set `feature_flags.aml_ctf.value = false`.
- `AmlGuard` denies all AML routes; step-up sessions are ignored.
- Data is retained; no destructive actions occur.

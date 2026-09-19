# NPC Messaging Governance — Phase 8 Scenario Validation

Phase 8 validates the required end-to-end messaging scenarios from the NPC Internal Messaging Workflow. In this repository the executable validation is intentionally dependency-free so it can run in Codex/staging environments where `npm install` may be blocked.

Run:

```bash
npm run test:messaging-governance
npm run test:messaging-phase8
```

## Scenario coverage

| Scenario | Validation focus |
| --- | --- |
| A. Command Centre → Finance private | Finance-only route stamps `command_finance_private`, notifies the governed finance assignee, excludes Client Portal notifications, and logs Finance-only governance recipients. |
| B. Command Centre → Client private | Staff client sends default to `command_client_private`, block Finance Portal in permissions, notify Client Portal, and log Client-only governance recipients. |
| C. Command Centre → Client + Finance allocation | UI exposes all allocation statuses, backend creates `command_client_with_finance_allocated` / `command_client_allocated`, grants Finance thread-level access only, notifies Finance, and records `thread_routed`. |
| D. Finance → Client direct | Finance Portal exposes direct client mode, notifies Client Portal and Command Centre, logs failures, and governance classifies partner messages as `finance_replied`. |
| E. Client → Finance reply | Client replies use `send_finance_reply`, verify authenticated client ownership and allowed scopes, notify the owning finance user and Command Centre, and governance classifies rows as `client_replied`. |
| F. Permission leak tests | Client scopes exclude finance-private threads, Finance scopes exclude client-private advisory threads, Finance reads are assignment-scoped, and Command Centre retains aggregate review access. |

## Why static scenario validation exists

The full smoke test still needs a staged Supabase project with one client, one assigned finance user, and one Command Centre user. The static Phase 8 script verifies that the code paths enforcing those scenarios are present before deployment, without needing credentials or seed data.

Manual staging smoke tests should still send real messages for all six scenarios and inspect:

- `message_governance_log`
- `notifications`
- `client_portal_notifications`
- `finance_portal_notifications`
- Finance Portal inbox/thread visibility
- Client Portal unified inbox visibility
- Command Centre message/governance views

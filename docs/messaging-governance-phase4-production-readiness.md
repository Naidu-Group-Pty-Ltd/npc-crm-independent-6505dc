# NPC Messaging Governance — Phase 4 Production Readiness

Phase 4 is the production cutover and operational hardening stage for the governed Command Centre / Finance Portal / Client Portal messaging workflow.

## Release Gate

Before promoting to production, all items below must be true:

1. The Phase 3 static preflight passes with `npm run test:messaging-governance`.
2. The Supabase migration version is unique and later than `20260609090000_three_way_address_sync.sql`.
3. `message-governance` is deployed with Command Centre admin-only access so Finance Portal and Client Portal sessions cannot query the full audit log.
4. All seven messaging functions are redeployed from the same commit:
   - `finance-portal-messages`
   - `client-portal-comms`
   - `staff-client-portal-messages`
   - `manage-portal-client-data`
   - `finance-portal-bulk-actions`
   - `finance-portal-nudges`
   - `message-governance`
5. The frontend is deployed after the migration and functions are live.
6. Scenario tests A-F from the Phase 3 plan pass in staging.

## Production Cutover Sequence

1. Take a database backup or confirm point-in-time recovery coverage.
2. Apply `supabase/migrations/20260609090100_internal_messaging_governance.sql`.
3. Confirm no duplicate migration version exists in Supabase migration history.
4. Redeploy the seven Supabase edge functions listed above.
5. Smoke test `message-governance` with a Command Centre admin session and confirm it returns audit events.
6. Smoke test `message-governance` with Finance Portal and Client Portal sessions and confirm both receive `403`.
7. Deploy the frontend.
8. Run one production-safe message through each route using test/staff-controlled records:
   - Command Centre → Finance only
   - Command Centre → Client only
   - Command Centre → Client + Finance allocation
   - Finance → Client direct
   - Client → Finance reply
9. Confirm the bell/notification centre has the expected notification fan-out for each route.
10. Confirm every smoke-test message has a corresponding `message_governance_log` entry.

## Post-Deployment Monitoring

Monitor these signals for the first business day after release:

- `message_governance_log` event volume by `event_type`.
- Any `message_governance_log.permission_status` records where a blocked portal unexpectedly becomes granted.
- Supabase edge-function errors for the seven messaging functions.
- Notification rows created for finance allocations, finance replies, client finance replies, and Command Centre alerts.
- Client Portal inbox queries for any `command_finance_private` visibility scope.
- Finance Portal thread queries for any unallocated `command_client_private` advisory messages.

## Incident Response

If a visibility leak is suspected:

1. Disable or hide Finance Portal direct client-thread sending in the frontend.
2. Keep Command Centre access online so staff can continue relationship management and inspect audit trails.
3. Query `message_governance_log` by `client_id`, `thread_id`, and `message_id` to identify the affected scope.
4. Revoke portal permissions or assignment rows for affected finance users if the leak is assignment-related.
5. Do not delete message history unless legal/compliance requires it; preserve the audit log for investigation.
6. Patch the affected edge function first, then redeploy the frontend if user-facing affordances also need to change.

## Acceptance Criteria

Phase 4 is complete when:

- Command Centre admins can query all governed audit events through `message-governance`.
- Non-Command Centre portal sessions receive `403` from `message-governance`.
- Finance Portal sees only finance-private, finance-allocated, and finance-client threads assigned to that finance user.
- Client Portal sees only authorised client-facing or finance-client threads for that client.
- No client inbox route exposes `command_finance_private` or `internal_command_only` messages.
- No Finance Portal route exposes unallocated `command_client_private` advisory messages.
- Notifications and governance log entries exist for all five primary message routes.

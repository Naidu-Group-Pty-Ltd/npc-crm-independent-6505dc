# NPC Messaging Governance — Phase 3 Rollout & Validation Plan

Phase 3 validates the governed Command Centre / Finance Portal / Client Portal messaging workflow end-to-end after the schema and backend hardening phases.

## Goals

- Confirm Command Centre remains the master communication, visibility, routing, permission, notification, and governance layer.
- Confirm Finance Portal and Client Portal only see threads/messages permitted by `visibility_scope`, `thread_type`, assignment, and ownership.
- Confirm every message event is traceable in `message_governance_log`.
- Confirm the UI labels make visibility clear before a user sends or replies.

## Required Deployments

Apply the migration and redeploy the functions below in this order:

1. Apply `supabase/migrations/20260609090100_internal_messaging_governance.sql`.
2. Redeploy Supabase edge functions:
   - `finance-portal-messages`
   - `client-portal-comms`
   - `staff-client-portal-messages`
   - `manage-portal-client-data`
   - `finance-portal-bulk-actions`
   - `finance-portal-nudges`
   - `message-governance`
3. Redeploy the frontend application.

## Static Preflight

Run the dependency-free static governance validation:

```bash
npm run test:messaging-governance
```

This validates migration uniqueness and the key code-level invariants that prevent visibility leaks.

## Staging Test Data

Create or identify:

- One Command Centre staff user.
- One active client portal user.
- One active finance portal user assigned to the client.
- One second finance portal user not assigned to the client for leak testing.

Record the IDs:

- `client_id`
- `finance_user_id`
- `unassigned_finance_user_id`
- `staff_user_id`

## Scenario Matrix

### A. Command Centre → Finance Private

1. In Command Centre, send `Finance only`.
2. Verify `finance_portal_threads.thread_type = 'command_finance'`.
3. Verify `finance_portal_messages.visibility_scope = 'command_finance_private'`.
4. Verify Finance Portal assigned user can read the thread.
5. Verify Client Portal unified inbox does not include the thread/message.
6. Verify `message_governance_log` contains the message event with client blocked in `permission_status`.

### B. Command Centre → Client Private

1. In Command Centre, send `Client only`.
2. Verify `client_portal_messages.visibility_scope = 'command_client_private'`.
3. Verify Client Portal sees the message.
4. Verify Finance Portal does not see the message in `list_threads` or `list_messages`.
5. Verify `message_governance_log` records the event.

### C. Command Centre → Client + Finance Allocation

1. In Command Centre, choose `Send to Client + allocate Finance`.
2. Choose each allocation status at least once:
   - Finance Action Required
   - Finance Review Required
   - Finance Input Required
   - Allocate to Finance
3. Verify Client Portal sees the client-facing message.
4. Verify Finance Portal sees only the `command_client_allocated` thread.
5. Verify Finance Portal receives a notification for the allocation.
6. Verify unrelated `command_client_private` messages remain hidden from Finance Portal.
7. Verify Command Centre governance log records allocation/routing.

### D. Finance → Client Direct

1. In Finance Portal client profile messaging, select `Client thread`.
2. Send a message.
3. Verify `finance_portal_threads.thread_type = 'finance_client'`.
4. Verify `finance_portal_messages.visibility_scope = 'finance_client_with_command_visibility'`.
5. Verify Client Portal sees the message.
6. Verify Command Centre receives a `finance_portal_message_received` notification.
7. Verify `message_governance_log.event_type = 'finance_replied'`.

### E. Client → Finance Reply

1. In Client Portal Messages, choose `Finance thread (Command Centre visible)`.
2. Send a reply.
3. Verify the reply preserves the thread's `visibility_scope` and `thread_type`.
4. Verify only the owning finance user receives `client_finance_reply` notification.
5. Verify Command Centre notification and governance log entries exist.
6. Attempt the same reply as a different client and confirm access is denied.

### F. Permission Leak Tests

Verify all of the following:

- Client Portal cannot see `command_finance_private` messages.
- Finance Portal cannot see `command_client_private` messages.
- Unassigned Finance Portal user cannot see assigned user's threads.
- Client cannot fetch/download attachments for finance-private messages.
- Command Centre can inspect all events through `message-governance`.

## Governance API Smoke Commands

Use authenticated staff credentials/session tokens in staging.

```bash
# List recent governance events
curl -X POST "$SUPABASE_URL/functions/v1/message-governance" \
  -H "Content-Type: application/json" \
  -H "x-session-token: $STAFF_SESSION_TOKEN" \
  -d '{"operation":"list_events","limit":25}'

# List all events for a client
curl -X POST "$SUPABASE_URL/functions/v1/message-governance" \
  -H "Content-Type: application/json" \
  -H "x-session-token: $STAFF_SESSION_TOKEN" \
  -d '{"operation":"list_by_client","client_id":"CLIENT_ID","limit":100}'
```

## Rollback Notes

- Do not drop the governance columns once deployed unless a full data rollback is planned.
- If a function deployment fails, keep portal UI deployment held until all four main messaging functions are deployed.
- If a visibility leak is detected, disable Finance Portal direct client-thread UI first, then inspect `message_governance_log` by `thread_id`.

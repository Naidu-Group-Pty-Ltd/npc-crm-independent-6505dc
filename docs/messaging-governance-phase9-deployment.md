# NPC Messaging Governance — Phase 9 Deployment Plan

Phase 9 is the deployment, smoke-test, monitoring, and rollback plan for the governed NPC Internal Messaging Workflow between Command Centre, Finance Portal, and Client Portal.

The deployment must preserve the core rule: **Command Centre remains the master communication, visibility, routing, permission, notification, and governance layer.** Finance Portal and Client Portal access must remain constrained by `visibility_scope`, `thread_type`, allocation status, assignment, and authenticated ownership.

## Release gate

Do not promote the release unless all checks below are complete:

1. Confirm the release commit includes the backend, frontend, migration, and validation changes from the same branch/commit.
2. Confirm the migration file exists and is ordered after address sync:
   - `supabase/migrations/20260609090100_internal_messaging_governance.sql`
   - must run after `supabase/migrations/20260609090000_three_way_address_sync.sql`
3. Confirm static validation passes:
   - `npm run test:messaging-governance`
   - `npm run test:messaging-phase8`
   - `npm run test:messaging-phase9`
   - `git diff --check`
   - `npx tsc --noEmit`
4. Confirm a database backup or point-in-time recovery window is available.
5. Confirm staging test users/data exist:
   - one Command Centre admin/staff user
   - one active Client Portal user
   - one active assigned Finance Portal user
   - one active unassigned Finance Portal user for leak tests
6. Confirm notification surfaces are enabled:
   - Command Centre `notifications`
   - Client Portal `client_portal_notifications`
   - Finance Portal `finance_portal_notifications`

## Deployment order

Deploy in this order. Do not deploy the frontend before the migration and edge functions are live.

### 1. Apply migration

Apply:

```bash
supabase db push
```

Required migration:

```text
supabase/migrations/20260609090100_internal_messaging_governance.sql
```

Post-migration checks:

```sql
select typname
from pg_type
where typname in ('message_visibility_scope', 'message_allocation_status');

select to_regclass('public.message_governance_log') as governance_log_table;

select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name in ('client_portal_messages', 'finance_portal_threads', 'finance_portal_messages')
  and column_name in ('visibility_scope', 'thread_type', 'allocation_status', 'permission_status', 'notification_status')
order by table_name, column_name;
```

Expected result:

- both enums exist
- `public.message_governance_log` exists
- visibility/allocation/permission/notification columns exist on the governed message/thread tables

### 2. Redeploy Supabase edge functions

Redeploy these functions from the same release commit:

```bash
supabase functions deploy finance-portal-messages
supabase functions deploy client-portal-comms
supabase functions deploy staff-client-portal-messages
supabase functions deploy manage-portal-client-data
supabase functions deploy finance-portal-bulk-actions
supabase functions deploy finance-portal-nudges
supabase functions deploy message-governance
```

Required functions for the primary messaging path:

- `finance-portal-messages`
- `client-portal-comms`
- `staff-client-portal-messages`
- `message-governance`

Related functions that can create or surface portal communications and must remain schema-compatible:

- `manage-portal-client-data`
- `finance-portal-bulk-actions`
- `finance-portal-nudges`

### 3. Redeploy frontend app

Redeploy the frontend only after the migration and functions above have succeeded.

Frontend surfaces affected:

- Command Centre client messaging panel
- Command Centre finance messaging panels
- Finance Portal messages tab and inbox
- Client Portal unified inbox and reply route selector
- notification/bell surfaces for Command Centre, Finance Portal, and Client Portal

### 4. Run staging smoke tests

Use one test client with an assigned finance user and a separate unassigned finance user.

#### A. Command Centre → Finance private

1. Command Centre sends using **Send to Finance only**.
2. Verify `finance_portal_messages.visibility_scope = 'command_finance_private'`.
3. Verify assigned Finance Portal user can see the thread/message.
4. Verify Client Portal cannot see the thread/message.
5. Verify `finance_portal_notifications` has the Finance notification.
6. Verify `message_governance_log` has the event with client blocked in `permission_status`.

#### B. Command Centre → Client private

1. Command Centre sends using **Send to Client only**.
2. Verify `client_portal_messages.visibility_scope = 'command_client_private'`.
3. Verify Client Portal can see the message.
4. Verify Finance Portal cannot see the message.
5. Verify `client_portal_notifications` has the Client notification.
6. Verify `message_governance_log` records the event.

#### C. Command Centre → Client + Finance allocation

1. Command Centre sends using **Send to Client + allocate Finance**.
2. Test all allocation statuses:
   - `finance_action_required`
   - `finance_review_required`
   - `finance_input_required`
   - `allocate_to_finance`
3. Verify Client Portal sees the client-facing message.
4. Verify Finance Portal sees only the allocated thread/component.
5. Verify Finance Portal receives the allocation notification.
6. Verify Command Centre remains the owner/controller.
7. Verify `message_governance_log` records `finance_allocated` and/or `thread_routed` with the allocation status.

#### D. Finance Portal → Client direct

1. Finance Portal sends from the direct **Client thread**.
2. Verify `finance_portal_messages.visibility_scope = 'finance_client_with_command_visibility'`.
3. Verify Client Portal receives the message.
4. Verify Command Centre receives a notification or can see the full thread through governance.
5. Verify `message_governance_log.event_type = 'finance_replied'`.

#### E. Client Portal → Finance reply

1. Client Portal chooses **Finance thread (Command Centre visible)** and replies.
2. Verify reply preserves the finance thread visibility scope and thread type.
3. Verify owning Finance Portal user receives the reply notification.
4. Verify Command Centre receives a notification.
5. Verify `message_governance_log.event_type = 'client_replied'`.
6. Try the same reply from a different client session and confirm access is denied.

#### F. Permission leak tests

Verify all of the following:

- Client Portal cannot see `command_finance_private` threads/messages.
- Client Portal cannot see `internal_command_only` messages.
- Finance Portal cannot see unrelated `command_client_private` advisory messages.
- Unassigned Finance Portal user cannot see allocated or private finance threads for another client.
- Command Centre can see all governed messages and audit events through `message-governance`.

## Command Centre governance smoke commands

Use a valid Command Centre admin/staff session token.

```bash
curl -X POST "$SUPABASE_URL/functions/v1/message-governance" \
  -H "Content-Type: application/json" \
  -H "x-session-token: $STAFF_SESSION_TOKEN" \
  -d '{"operation":"list_events","limit":25}'

curl -X POST "$SUPABASE_URL/functions/v1/message-governance" \
  -H "Content-Type: application/json" \
  -H "x-session-token: $STAFF_SESSION_TOKEN" \
  -d '{"operation":"list_client_timeline","client_id":"CLIENT_ID","limit":100}'
```

Expected:

- Command Centre admin/staff receives `success: true`.
- Finance Portal and Client Portal sessions receive `403` for `message-governance`.
- `list_client_timeline` includes client messages, finance threads, finance messages, and governance events.

## Monitoring after deployment

Monitor these tables and logs during the first business day:

- `message_governance_log`
  - event counts by `event_type`
  - `notification_failed` events
  - any `permission_status` where a blocked portal is unexpectedly granted
- `notifications`
  - Command Centre finance-client alerts
  - `metadata.visibility_scope`
  - `metadata.thread_id`
  - `metadata.message_id`
- `client_portal_notifications`
  - Client notifications for Command Centre/client and Finance/client messages
  - notification metadata includes `visibility_scope`, `thread_type`, and `allocation_status`
- `finance_portal_notifications`
  - Finance private messages
  - allocations
  - client finance replies
- Supabase function logs
  - `finance-portal-messages`
  - `client-portal-comms`
  - `staff-client-portal-messages`
  - `message-governance`

Useful monitoring queries:

```sql
select event_type, visibility_scope, count(*)
from public.message_governance_log
where created_at > now() - interval '24 hours'
group by event_type, visibility_scope
order by count(*) desc;

select *
from public.message_governance_log
where event_type = 'notification_failed'
  and created_at > now() - interval '24 hours'
order by created_at desc;

select id, client_id, visibility_scope, thread_type, allocation_status, permission_status, notification_status, created_at
from public.client_portal_messages
where created_at > now() - interval '24 hours'
order by created_at desc;

select id, thread_id, client_id, sender_type, visibility_scope, thread_type, allocation_status, permission_status, notification_status, created_at
from public.finance_portal_messages
where created_at > now() - interval '24 hours'
order by created_at desc;
```

## Rollback and containment

Because the migration is non-destructive and preserves message history, prefer containment over destructive rollback.

### If frontend deployment fails

1. Keep migration and edge functions deployed.
2. Roll back frontend to the previous build.
3. Confirm old frontend does not expose new routes incorrectly.
4. Continue monitoring backend governance logs.

### If an edge function deployment fails

1. Stop frontend promotion.
2. Redeploy the failed function from the release commit.
3. If still failing, redeploy the previous known-good function bundle and keep the frontend held.
4. Re-run `npm run test:messaging-governance` and `npm run test:messaging-phase8` locally against the release commit before retrying.

### If a visibility leak is suspected

1. Disable Finance Portal direct client-thread UI first.
2. Keep Command Centre governance access online.
3. Query `message_governance_log` by `client_id`, `thread_id`, and `message_id`.
4. Revoke affected `finance_portal_client_assignments` if assignment-related.
5. Patch backend permission enforcement before re-enabling UI.
6. Preserve message history and audit logs unless compliance/legal requires otherwise.

### If notifications fail

1. Inspect `message_governance_log.event_type = 'notification_failed'`.
2. Confirm whether failure affected Command Centre, Finance Portal, or Client Portal notification rows.
3. Use `notification_status` on the message row to identify failed recipient portals.
4. Manually notify affected staff/partners if client relationship risk exists.
5. Patch notification insert path and replay/repair only notification rows; do not duplicate message rows.

## Phase 9 exit criteria

Phase 9 is complete when:

- Migration has been applied in the target environment.
- Required Supabase edge functions are deployed from the same release commit.
- Frontend is deployed after backend readiness.
- Phase 8 static validation passes.
- Staging smoke scenarios A-F pass with real users/data.
- Command Centre can query all governed messages/events.
- Finance Portal and Client Portal cannot access blocked scopes.
- Notifications and governance rows exist for every test route.
- Monitoring and rollback owners know where to inspect failures.

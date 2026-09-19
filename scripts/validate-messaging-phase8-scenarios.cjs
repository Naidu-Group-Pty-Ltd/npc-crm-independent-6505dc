#!/usr/bin/env node
/*
 * Phase 8 scenario validation for the NPC Internal Messaging Workflow.
 *
 * These checks intentionally use only Node built-ins so they can run where npm
 * install/lint/build are blocked. They verify the code paths that implement the
 * six required smoke-test scenarios A-F without needing staging Supabase data.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const compact = (rel) => read(rel).replace(/\s+/g, ' ');

let failures = 0;
function pass(message) { console.log(`✅ ${message}`); }
function fail(message, detail = '') {
  failures += 1;
  console.error(`❌ ${message}${detail ? `\n   ${detail}` : ''}`);
}
function assertContains(rel, needle, message) {
  const body = read(rel);
  if (body.includes(needle)) pass(message);
  else fail(message, `Missing: ${needle}\n   File: ${rel}`);
}
function assertNotContains(rel, needle, message) {
  const body = read(rel);
  if (!body.includes(needle)) pass(message);
  else fail(message, `Unexpected: ${needle}\n   File: ${rel}`);
}
function assertCompactContains(rel, needle, message) {
  const body = compact(rel);
  const normalized = needle.replace(/\s+/g, ' ');
  if (body.includes(normalized)) pass(message);
  else fail(message, `Missing normalized snippet: ${normalized}\n   File: ${rel}`);
}

const migration = 'supabase/migrations/20260609090100_internal_messaging_governance.sql';
const financeFn = 'supabase/functions/finance-portal-messages/index.ts';
const clientComms = 'supabase/functions/client-portal-comms/index.ts';
const staffClient = 'supabase/functions/staff-client-portal-messages/index.ts';
const governanceFn = 'supabase/functions/message-governance/index.ts';
const commandUi = 'src/components/clients/ClientPortalMessagesPanel.tsx';
const financeUi = 'src/components/finance-portal/FinancePortalMessagesPanel.tsx';
const clientUi = 'src/pages/portal/PortalMessages.tsx';

console.log('NPC messaging Phase 8 scenario validation\n');

console.log('Scenario A — Command Centre → Finance private');
assertContains(commandUi, "route === 'finance_only'", 'Command Centre UI exposes a Finance-only route');
assertContains(commandUi, "visibility_scope: 'command_finance_private'", 'Finance-only route stamps command_finance_private');
assertContains(commandUi, "thread_type: 'command_finance'", 'Finance-only route uses command_finance thread type');
assertContains(financeFn, "portal_user_id: thread.finance_user_id", 'Finance-only notification targets the governed finance assignee');
assertContains(financeFn, "notification_type: insertRow.allocation_status !== 'none' ? insertRow.allocation_status : 'message_received'", 'Finance-only sends Finance Portal notification');
assertContains(financeFn, "if (['finance_client_with_command_visibility', 'command_client_with_finance_allocated'].includes(requestedScope))", 'Client notification path excludes command_finance_private');
assertContains(migration, "WHEN NEW.visibility_scope = 'command_finance_private' THEN ARRAY['finance_portal']", 'Governance log routes finance-private messages only to Finance Portal');

console.log('\nScenario B — Command Centre → Client private');
assertContains(commandUi, "route === 'client_finance'", 'Command Centre distinguishes client+finance from client-only route');
assertContains(staffClient, ": 'command_client_private'", 'Staff client send defaults to command_client_private');
assertContains(staffClient, "finance_portal: 'blocked'", 'Client-only permission status blocks Finance Portal');
assertContains(staffClient, "client_portal_notifications", 'Client-only sends a Client Portal notification');
assertContains(clientComms, ".in('visibility_scope', ['command_client_private', 'command_client_with_finance_allocated'])", 'Client Portal can list client-private messages only among client-facing command scopes');
assertContains(migration, "WHEN NEW.visibility_scope = 'command_client_private' THEN ARRAY['client_portal']", 'Governance log routes client-private messages only to Client Portal');

console.log('\nScenario C — Command Centre → Client with Finance Action/Review/Input/Allocation');
for (const status of ['finance_action_required', 'finance_review_required', 'finance_input_required', 'allocate_to_finance']) {
  assertContains(commandUi, status, `Command Centre UI exposes ${status}`);
}
assertContains(staffClient, "visibility_scope: 'command_client_with_finance_allocated'", 'Allocation creates command_client_with_finance_allocated scope');
assertContains(staffClient, "thread_type: 'command_client_allocated'", 'Allocation creates command_client_allocated thread');
assertContains(staffClient, "finance_portal_notifications", 'Allocation notifies Finance Portal');
assertContains(staffClient, "event_type: 'thread_routed'", 'Allocation writes thread_routed governance event');
assertContains(staffClient, "finance_portal: 'thread_granted'", 'Allocation grants Finance only thread-level access');
assertContains(financeUi, "visibility_scope: 'command_client_with_finance_allocated'", 'Finance Portal UI exposes allocated thread mode');
assertContains(financeUi, 'Reply/action only within this permitted thread', 'Finance Portal UI displays action boundary for allocated threads');

console.log('\nScenario D — Finance Portal → Client direct');
assertContains(financeUi, "visibility_scope: 'finance_client_with_command_visibility'", 'Finance Portal UI exposes direct Finance ↔ Client mode');
assertContains(financeFn, "finalNotificationStatus.command_centre = staffNotify.status", 'Finance direct message records Command Centre notification status');
assertContains(financeFn, "client_portal_notifications", 'Finance direct message notifies Client Portal');
assertContains(financeFn, "senderPortal: 'finance_portal'", 'Finance direct notification failures are attributed to Finance Portal');
assertContains(migration, "WHEN NEW.sender_type = 'partner' THEN 'finance_replied'", 'Governance trigger logs finance replies as finance_replied');
assertContains(governanceFn, "from('finance_portal_messages')", 'Command Centre read model includes finance messages for review');

console.log('\nScenario E — Client Portal → Finance reply');
assertContains(clientUi, 'Finance thread (Command Centre visible)', 'Client Portal labels finance replies as Command Centre-visible');
assertContains(clientComms, "operation === 'send_finance_reply'", 'Client Portal replies use controlled finance reply operation');
assertContains(clientComms, ".eq('client_id', clientId)", 'Client finance reply verifies authenticated client ownership');
assertContains(clientComms, ".in('visibility_scope', ['finance_client_with_command_visibility', 'command_client_with_finance_allocated'])", 'Client finance reply is limited to authorised finance/client scopes');
assertContains(clientComms, "portal_user_id: thread.finance_user_id", 'Client finance reply notifies owning Finance Portal user');
assertContains(clientComms, 'ensureCommandCentreFinanceReplyNotification', 'Client finance reply notifies Command Centre');
assertContains(migration, "WHEN NEW.sender_type = 'client' THEN 'client_replied'", 'Governance trigger logs client replies as client_replied');

console.log('\nScenario F — Permission leak tests');
assertContains(financeFn, "return ['command_client_with_finance_allocated', 'finance_client_with_command_visibility'];", 'Client actor permitted scopes exclude finance-private threads');
assertContains(financeFn, "return ['command_finance_private', 'command_client_with_finance_allocated', 'finance_client_with_command_visibility'];", 'Finance actor permitted scopes exclude command-client-private threads');
assertContains(financeFn, "thread.finance_user_id !== actor.portalUserId", 'Finance reads/writes are scoped to assigned finance user');
assertContains(clientComms, ".in('visibility_scope', ['command_client_private', 'command_client_with_finance_allocated'])", 'Client unified inbox blocks command_finance_private and internal_command_only command messages');
assertContains(clientComms, ".in('visibility_scope', ['finance_client_with_command_visibility', 'command_client_with_finance_allocated'])", 'Client unified inbox blocks finance-private finance threads');
assertContains(governanceFn, "operation === 'list_client_timeline'", 'Command Centre has aggregate review path');
assertContains(governanceFn, ".from('client_portal_messages')", 'Command Centre aggregate path includes client messages');
assertContains(governanceFn, ".from('finance_portal_threads')", 'Command Centre aggregate path includes finance threads');
assertContains(governanceFn, ".from('finance_portal_messages')", 'Command Centre aggregate path includes finance messages');
assertNotContains(clientComms, "'command_finance_private'", 'Client Portal comms endpoint does not query finance-private scope');

console.log('\nNotification fallback and audit coverage');
assertContains(financeFn, "event_type: 'notification_failed'", 'Finance message notification failures are logged');
assertContains(clientComms, "event_type: 'notification_failed'", 'Client finance reply notification failures are logged');
assertContains(staffClient, "event_type: 'notification_failed'", 'Staff client/allocation notification failures are logged');
assertContains(staffClient, "finance_portal: 'no_assigned_finance_user'", 'Missing Finance assignment is represented in notification status');
assertCompactContains(financeFn, ".update({ notification_status: finalNotificationStatus }) .eq('id', message.id);", 'Finance messages persist final notification_status');
assertCompactContains(clientComms, ".update({ notification_status: finalNotificationStatus }) .eq('id', inserted.id);", 'Client finance replies persist final notification_status');
assertCompactContains(staffClient, ".update({ notification_status: finalNotificationStatus }) .eq('id', data.id);", 'Staff client messages persist final notification_status');

if (failures > 0) {
  console.error(`\n${failures} Phase 8 scenario validation check(s) failed.`);
  process.exit(1);
}
console.log('\nAll Phase 8 messaging scenario checks passed.');

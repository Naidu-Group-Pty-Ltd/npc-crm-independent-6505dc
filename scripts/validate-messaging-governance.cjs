#!/usr/bin/env node
/*
 * Static governance workflow validation for NPC portal messaging.
 *
 * This intentionally uses only Node built-ins so it can run in Codex/staging
 * environments where npm install is blocked. It verifies the architectural
 * invariants that the messaging governance phases require before rollout testing.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

let failures = 0;
function pass(message) {
  console.log(`✅ ${message}`);
}
function fail(message) {
  failures += 1;
  console.error(`❌ ${message}`);
}
function assertContains(rel, needle, message) {
  const body = read(rel);
  if (body.includes(needle)) pass(message);
  else fail(`${message}\n   Missing: ${needle}\n   File: ${rel}`);
}
function assertRegex(rel, regex, message) {
  const body = read(rel);
  if (regex.test(body)) pass(message);
  else fail(`${message}\n   Missing pattern: ${regex}\n   File: ${rel}`);
}
function assertNotContains(rel, needle, message) {
  const body = read(rel);
  if (!body.includes(needle)) pass(message);
  else fail(`${message}\n   Unexpected: ${needle}\n   File: ${rel}`);
}

console.log('NPC messaging governance static validation\n');

// Migration hygiene.
const migrationDir = path.join(root, 'supabase/migrations');
const migrationFiles = fs.readdirSync(migrationDir).filter((name) => name.endsWith('.sql'));
const versions = new Map();
for (const file of migrationFiles) {
  const version = file.split('_', 1)[0];
  versions.set(version, [...(versions.get(version) || []), file]);
}
const duplicateVersions = [...versions.entries()].filter(([, files]) => files.length > 1);
if (duplicateVersions.length === 0) pass('Supabase migration versions are unique');
else fail(`Duplicate migration versions found: ${JSON.stringify(duplicateVersions)}`);

const governanceMigration = 'supabase/migrations/20260609090100_internal_messaging_governance.sql';
assertContains(governanceMigration, 'CREATE TABLE IF NOT EXISTS public.message_governance_log', 'Governance log table exists');
assertContains(governanceMigration, "'command_finance_private'", 'Finance-private scope exists');
assertContains(governanceMigration, "'command_client_private'", 'Client-private scope exists');
assertContains(governanceMigration, "'command_client_with_finance_allocated'", 'Client+finance allocation scope exists');
assertContains(governanceMigration, "'finance_client_with_command_visibility'", 'Finance-client Command Centre-visible scope exists');
assertContains(governanceMigration, 'DROP CONSTRAINT IF EXISTS finance_portal_threads_client_id_finance_user_id_key', 'Legacy one-thread-per-finance-client constraint is removed');
assertContains(governanceMigration, 'ON public.finance_portal_threads(client_id, finance_user_id, thread_type)', 'Finance threads are unique by governed thread type');
assertContains(governanceMigration, "SET visibility_scope = 'command_finance_private'", 'Existing finance messages backfill to finance-private');
assertContains(governanceMigration, "'client_portal', 'blocked', 'finance_portal', 'blocked'", 'Internal command notes block both client and finance portals');


// Command Centre secure invoke / CORS diagnostics for outbound messaging.
assertContains('src/lib/secureInvoke.ts', 'COMMAND_CENTRE_MESSAGING_FUNCTIONS', 'secureInvoke scopes Command Centre-only headers to messaging functions');
assertContains('src/lib/secureInvoke.ts', 'COMMAND_CENTRE_MESSAGING_FUNCTIONS.has(functionName)', 'secureInvoke gates Command Centre session propagation by function name');
assertContains('src/lib/secureInvoke.ts', "'x-command-centre-session-token': sessionToken", 'secureInvoke sends an explicit Command Centre session header only for messaging functions');
assertContains('src/lib/secureInvoke.ts', 'command_centre_session_token: sessionToken', 'secureInvoke mirrors the Command Centre session in the request body only for messaging functions');
assertNotContains('supabase/functions/_shared/auth.ts', "'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-session-token, x-command-centre-session-token, x-portal-session-token, x-finance-session-token'", 'Shared CORS defaults do not globally require Command Centre-only headers');
assertContains('supabase/functions/_shared/auth.ts', 'x-command-centre-session-token', 'Shared auth extracts explicit Command Centre session tokens');
assertContains('supabase/functions/staff-client-portal-messages/index.ts', 'x-command-centre-session-token', 'Staff client messaging CORS allows Command Centre session header');
assertContains('supabase/functions/finance-portal-messages/index.ts', 'const commandCentreToken =', 'Finance messaging resolves Command Centre staff sessions before portal sessions');
assertContains('supabase/functions/finance-portal-messages/index.ts', 'const financeToken = commandCentreToken ? null : extractFinancePortalToken', 'Finance messaging does not treat Command Centre sessions as finance partner sessions');
assertContains('supabase/functions/finance-portal-messages/index.ts', 'x-portal-session-token, x-session-token, x-command-centre-session-token', 'Finance messaging CORS allows portal and Command Centre session headers');

// Finance message backend enforcement.
const financeMessages = 'supabase/functions/finance-portal-messages/index.ts';
assertContains(financeMessages, "return ['command_finance_private', 'command_client_with_finance_allocated', 'finance_client_with_command_visibility'];", 'Finance actor permitted scopes are explicit');
assertContains(financeMessages, "return ['command_client_with_finance_allocated', 'finance_client_with_command_visibility'];", 'Client actor permitted scopes exclude finance-private');
assertContains(financeMessages, 'Clients cannot create finance threads; reply to an existing authorised thread', 'Clients cannot create finance threads directly');
assertContains(financeMessages, ".eq('thread_type', requestedThreadType)", 'Thread lookup includes governed thread type');
assertContains(financeMessages, "messageQuery = messageQuery.in('visibility_scope', messageAllowedScopes)", 'Finance message reads filter by message visibility scope');
assertContains(financeMessages, 'Thread visibility and type are immutable', 'Finance thread send path rejects scope/type mutation');
assertContains(financeMessages, 'isAttachmentPathForThread(attachment.path, thread.client_id, thread_id)', 'Finance message writes reject attachment paths outside the governed client/thread prefix');
assertContains(financeMessages, 'isAttachmentPathForThread(msg.attachment_path, msg.client_id, msg.thread_id)', 'Finance attachment signing rejects stored paths outside the governed client/thread prefix');
assertContains(financeMessages, "!permittedScopesForActor('client')!.includes(msg.visibility_scope)", 'Attachment access checks client message visibility');
assertContains(financeMessages, "['finance_client_with_command_visibility', 'command_client_with_finance_allocated'].includes(requestedScope)", 'Finance replies notify clients on direct and allocated client-visible threads');
assertContains(financeMessages, "event_type: 'notification_failed'", 'Finance message notification failures are captured in governance log');
assertContains(financeMessages, 'portal_user_id: thread.finance_user_id', 'Finance notifications are scoped to the governed thread assignee');
assertContains(financeMessages, 'finalNotificationStatus.command_centre = staffNotify.status', 'Finance-client messages record Command Centre notification status');
assertContains(financeMessages, ".update({ notification_status: finalNotificationStatus })", 'Finance messages persist final notification status');
assertContains(financeMessages, 'visibility_scope: requestedScope', 'Finance notification metadata carries visibility scope');

// Client reply backend enforcement.
const clientComms = 'supabase/functions/client-portal-comms/index.ts';
assertContains(clientComms, ".eq('client_id', clientId)", 'Client finance replies are scoped to authenticated client_id');
assertContains(clientComms, ".in('visibility_scope', ['command_client_private', 'command_client_with_finance_allocated'])", 'Client Portal message list excludes non-client-facing command scopes');
assertContains(clientComms, ".in('visibility_scope', ['finance_client_with_command_visibility', 'command_client_with_finance_allocated'])", 'Client finance replies only target authorised thread scopes');
assertContains(clientComms, 'visibility_scope: thread.visibility_scope', 'Client finance replies preserve thread scope');
assertContains(clientComms, 'portal_user_id: thread.finance_user_id', 'Client finance replies notify the owning finance user only');
assertContains(clientComms, "event_type: 'notification_failed'", 'Client finance reply notification failures are captured in governance log');
assertContains(clientComms, 'ensureCommandCentreFinanceReplyNotification', 'Client finance replies have Command Centre notification fallback');
assertContains(clientComms, "command_centre: commandNotify.status", 'Client finance replies persist Command Centre notification status');
assertContains(clientComms, 'visibility_scope: thread.visibility_scope', 'Client finance reply notifications carry visibility scope');

// Command Centre allocation and governance read model.
const staffMessages = 'supabase/functions/staff-client-portal-messages/index.ts';
assertContains(staffMessages, ".eq('thread_type', 'command_client_allocated')", 'Command Centre finance allocation uses allocated thread type');
assertContains(staffMessages, "visibility_scope: 'command_client_with_finance_allocated'", 'Command Centre allocation creates finance-allocated scope');
assertContains(staffMessages, "finance_portal: 'no_assigned_finance_user'", 'Command Centre allocation records missing finance assignment fallback');
assertContains(staffMessages, ".update({ notification_status: finalNotificationStatus })", 'Command Centre client messages persist final notification status');
assertContains('supabase/config.toml', '[functions.staff-client-portal-messages]', 'Command Centre client message function is configured');
assertContains('supabase/config.toml', 'verify_jwt = false', 'Messaging functions support custom secureInvoke session authentication without gateway JWT/CORS failures');
assertContains('supabase/functions/message-governance/index.ts', "from('message_governance_log')", 'Command Centre governance function reads governance log');
assertContains('supabase/functions/message-governance/index.ts', "from('user_roles')", 'Governance API verifies Command Centre staff role');
assertContains('supabase/functions/message-governance/index.ts', ".in('role', ['superadmin', 'admin'])", 'Governance API limits audit access to admin roles');
assertContains('supabase/functions/message-governance/index.ts', 'Command Centre admin access required', 'Governance API rejects non-staff portal sessions');
assertContains('supabase/functions/message-governance/index.ts', "operation === 'list_by_client'", 'Governance API supports client filtering');
assertContains('supabase/functions/message-governance/index.ts', "operation === 'list_by_thread'", 'Governance API supports thread filtering');
assertContains('supabase/functions/message-governance/index.ts', "operation === 'list_by_message'", 'Governance API supports message filtering');
assertContains('supabase/functions/message-governance/index.ts', "operation === 'list_client_timeline'", 'Command Centre has aggregate client timeline read model');
assertContains('supabase/functions/message-governance/index.ts', "from('finance_portal_messages')", 'Command Centre aggregate read model includes finance messages');
assertContains('supabase/functions/message-governance/index.ts', "from('client_portal_messages')", 'Command Centre aggregate read model includes client portal messages');

// UI affordances for Phase 3 rollout.
assertContains('src/components/finance-portal/FinancePortalMessagesPanel.tsx', "visibility_scope: 'command_finance_private'", 'Finance Portal exposes Command Centre-private mode');
assertContains('src/components/finance-portal/FinancePortalMessagesPanel.tsx', "visibility_scope: 'finance_client_with_command_visibility'", 'Finance Portal exposes direct finance-client mode');
assertContains('src/components/finance-portal/FinancePortalMessagesPanel.tsx', "visibility_scope: 'command_client_with_finance_allocated'", 'Finance Portal exposes Command Centre allocated thread mode');
assertContains('src/components/finance-portal/FinancePortalMessagesPanel.tsx', 'Reply/action only within this permitted thread', 'Finance Portal explains allocated thread action boundary');
assertContains('src/components/clients/ClientPortalMessagesPanel.tsx', "Send to Client + allocate Finance", 'Command Centre UI exposes client+finance allocation route');
assertContains('src/components/clients/ClientPortalMessagesPanel.tsx', "route === 'client_finance'", 'Command Centre client+finance route is a single governed allocation send');
assertContains('src/components/clients/ClientPortalMessagesPanel.tsx', 'Finance receives access only to this allocated client-facing thread', 'Command Centre UI explains Finance allocation boundary');
assertContains('src/components/clients/ClientPortalMessagesPanel.tsx', 'No finance assignment', 'Command Centre UI surfaces failed finance allocation notification status');
assertContains('src/pages/portal/PortalMessages.tsx', 'Finance thread (Command Centre visible)', 'Client Portal labels finance replies as Command Centre-visible');
assertContains('src/components/admin/finance-portal/StaffFinanceMessagesPanel.tsx', 'Client + CC visible', 'Staff finance UI distinguishes direct finance-client threads');

if (failures > 0) {
  console.error(`\n${failures} governance validation check(s) failed.`);
  process.exit(1);
}
console.log('\nAll messaging governance validation checks passed.');

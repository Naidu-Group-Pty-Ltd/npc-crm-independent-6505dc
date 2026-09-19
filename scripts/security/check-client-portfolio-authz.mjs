import { readFileSync } from 'node:fs';

const clientData = readFileSync('supabase/functions/get-client-data/index.ts', 'utf8');
const scenarios = readFileSync('supabase/functions/manage-bc-scenarios/index.ts', 'utf8');
const borrowingCapacity = readFileSync('supabase/functions/calculate-borrowing-capacity/index.ts', 'utf8');
const failures = [];

for (const required of [
  "requireModulePermission(supabase, actor, 'client_management', 'can_view')",
  // Audit item 36 — this named `canAccessClient(supabase, actor, id)`, the
  // per-id loop that call site used to run. The loop is gone: it made one
  // sequential round trip per id, and the CRM Conversations page resolves 722
  // names on every load, which took the request past the browser's abort and
  // rendered every conversation as "Unknown".
  //
  // `canAccessAllOf` returns the SAME all-or-nothing verdict — service role
  // allows, an empty list allows, a superadmin allows, otherwise every id must
  // be accessible, and a failed read denies. What this gate protects is
  // unchanged, and the ordering assertion below is new.
  'canAccessAllOf(supabase, actor, idsToFetch)',
  'canAccessAllClients(supabase, actor)',
  'assigned_team_user_id.eq.${userId}',
]) {
  if (!clientData.includes(required)) failures.push(`get-client-data missing: ${required}`);
}

for (const required of [
  "'client_management',",
  "operation === 'list'",
  "'can_view'",
  "'can_edit'",
  "'can_delete'",
  ".select('client_id')",
  'canAccessClient(supabase, actor, authorizedClientId)',
]) {
  if (!scenarios.includes(required)) failures.push(`manage-bc-scenarios missing: ${required}`);
}

const clientGate = clientData.indexOf("requireModulePermission(supabase, actor, 'client_management', 'can_view')");
const clientRead = clientData.indexOf(".from('clients')", clientData.indexOf('// Fetch base client data'));
if (clientGate < 0 || clientRead < 0 || clientGate > clientRead) {
  failures.push('get-client-data authorization does not precede sensitive client reads');
}

// The caller-supplied ids must be authorized before any of them is read, and a
// refusal must be a 404 rather than a partial answer — a per-id verdict would
// turn this broker into an id oracle.
const idGate = clientData.indexOf('canAccessAllOf(supabase, actor, idsToFetch)');
if (idGate < 0 || clientRead < 0 || idGate > clientRead) {
  failures.push('get-client-data does not authorize caller-supplied ids before reading them');
}
if (!/if \(!await canAccessAllOf\(supabase, actor, idsToFetch\)\) \{\s*\n\s*return new Response\(\s*\n\s*JSON\.stringify\(\{ error: 'Client not found', success: false \}\)/.test(clientData)) {
  failures.push('get-client-data does not refuse the whole request when an id is inaccessible');
}

const scenarioGate = scenarios.indexOf('const requiredPermission: ModulePerm');
const scenarioMutation = scenarios.indexOf(".insert(insertRow)");
if (scenarioGate < 0 || scenarioMutation < 0 || scenarioGate > scenarioMutation) {
  failures.push('scenario authorization does not precede mutations');
}

const capacityGate = borrowingCapacity.indexOf('canAccessClient(supabase, actor, clientId)');
const capacityClientRead = borrowingCapacity.indexOf('.from("clients")', capacityGate);
if (capacityGate < 0 || capacityClientRead < 0 || capacityGate > capacityClientRead) {
  failures.push('borrowing-capacity client authorization does not precede sensitive client reads');
}
if (borrowingCapacity.includes('overrides?.forceSegmentEngine') || /forceEnabled\s*:/.test(borrowingCapacity)) {
  failures.push('borrowing-capacity still accepts a caller-controlled segment-engine bypass');
}

if (failures.length) {
  console.error(`Client portfolio authorization FAILED:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}

console.log('Client portfolio authorization check passed.');

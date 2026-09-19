import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const edgeFunction = await readFile(
  new URL('../../supabase/functions/finance-portal-batch9-10/index.ts', import.meta.url),
  'utf8',
);

const handoffStart = edgeFunction.indexOf("if (operation === 'npc_handoff_info')");
const handoffEnd = edgeFunction.indexOf("if (operation === 'npc_ping')", handoffStart);
assert.notEqual(handoffStart, -1, 'npc_handoff_info operation must exist');
assert.notEqual(handoffEnd, -1, 'npc_handoff_info operation must have a bounded implementation');

const handoff = edgeFunction.slice(handoffStart, handoffEnd);
const assignmentCheck = handoff.indexOf(".from('finance_portal_client_assignments')");
const protectedDataLookup = handoff.indexOf(".from('client_deals')");

assert.notEqual(assignmentCheck, -1, 'NPC handoff must check the finance user client assignment');
assert.match(handoff, /\.eq\('finance_user_id', portalUser\.id\)/);
assert.match(handoff, /\.eq\('client_id', pf\.client_id\)/);
assert.ok(
  assignmentCheck < protectedDataLookup,
  'NPC handoff must authorize the purchase file before loading protected handoff data',
);

console.log('Finance portal NPC handoff authorization checks passed.');

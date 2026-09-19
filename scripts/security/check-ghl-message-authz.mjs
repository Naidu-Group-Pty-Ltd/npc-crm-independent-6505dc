import { readFileSync } from 'node:fs';

const source = readFileSync('supabase/functions/send-ghl-message/index.ts', 'utf8');
const failures = [];
if (/checkPermission\s*\(/.test(source)) failures.push('legacy checkPermission call remains');
for (const required of [
  "requireModulePermission(supabase, { userId, authMethod: 'human' }, 'conversations', 'can_edit')",
  'actorIsSuperadmin(supabase, userId!)',
  ".from('clients')",
  "select('created_by, assigned_team_user_id')",
  "status: 404",
]) if (!source.includes(required)) failures.push(`missing GHL authorization control: ${required}`);
const clientScope = source.indexOf(".from('clients')");
const providerCall = source.indexOf("fetch(ghlUrl");
if (clientScope < 0 || providerCall < 0 || clientScope > providerCall) failures.push('client scope check does not precede provider call');
if (failures.length) { console.error(`GHL message authorization FAILED:\n- ${failures.join('\n- ')}`); process.exit(1); }
console.log('GHL message authorization check passed.');

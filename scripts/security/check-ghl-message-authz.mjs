import { existsSync, readFileSync } from 'node:fs';

// Every CRM send path this tree carries is held to the same authorisation.
// On the independent CRM line `send-ghl-message` is not carried (Mission
// Control withholds it), so `crm-send-message` is the only path and the gate
// follows it rather than passing over an absent file.
const PATHS = [
  { file: 'supabase/functions/send-ghl-message/index.ts', provider: 'fetch(ghlUrl' },
  { file: 'supabase/functions/crm-send-message/index.ts', provider: 'fetch(' },
].filter(({ file }) => existsSync(file));

const failures = [];
if (PATHS.length === 0) failures.push('no CRM send path found — the gate has nothing to check');
for (const { file, provider } of PATHS) {
  const source = readFileSync(file, 'utf8');
  if (/checkPermission\s*\(/.test(source)) failures.push(`${file}: legacy checkPermission call remains`);
  for (const required of [
    "requireModulePermission(supabase, { userId, authMethod: 'human' }, 'conversations', 'can_edit')",
    'actorIsSuperadmin(supabase, userId!)',
    ".from('clients')",
    "select('created_by, assigned_team_user_id')",
    "status: 404",
  ]) if (!source.includes(required)) failures.push(`${file}: missing CRM message authorization control: ${required}`);
  const clientScope = source.indexOf("select('created_by, assigned_team_user_id')");
  const providerCall = source.indexOf(provider);
  if (clientScope < 0 || providerCall < 0 || clientScope > providerCall) failures.push(`${file}: client scope check does not precede provider call`);
}
if (failures.length) { console.error(`CRM message authorization FAILED:\n- ${failures.join('\n- ')}`); process.exit(1); }
console.log(`CRM message authorization check passed (${PATHS.map((p) => p.file).join(', ')}).`);

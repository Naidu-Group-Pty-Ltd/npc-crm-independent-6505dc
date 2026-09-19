import { readFileSync } from 'node:fs';
const qa = readFileSync('supabase/functions/market-updates-qa/index.ts', 'utf8');
const callers = ['market-qa-subscriptions', 'market-qa-digest-runner'].map((name) => [name, readFileSync(`supabase/functions/${name}/index.ts`, 'utf8')]);
const failures = [];
for (const required of ['requireHumanOrSignedInternal', "['market-qa-subscriptions', 'market-qa-digest-runner']", "parsed.value?.internal_action !== 'scheduled_qa'", 'target_user_id']) if (!qa.includes(required)) failures.push(`target missing ${required}`);
for (const [name, source] of callers) {
  if (!source.includes("callInternalFunction('market-updates-qa'")) failures.push(`${name} does not use signed internal call helper`);
  if (!source.includes("internal_action: 'scheduled_qa'")) failures.push(`${name} lacks explicit internal action`);
  if (!source.includes('target_user_id')) failures.push(`${name} lacks target-user binding`);
  if (source.includes("x-internal-edge-secret': Deno.env.get('INTERNAL_EDGE_SECRET')")) failures.push(`${name} still sends a static internal secret directly`);
}
if (failures.length) { console.error(`Market Q&A internal auth FAILED:\n- ${failures.join('\n- ')}`); process.exit(1); }
console.log('Market Q&A internal auth check passed.');

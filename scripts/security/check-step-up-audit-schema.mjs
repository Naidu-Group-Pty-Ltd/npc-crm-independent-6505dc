import { readFileSync } from 'node:fs';
for (const file of ['supabase/functions/security-step-up/index.ts', 'supabase/functions/_shared/stepUp.ts']) {
  const source = readFileSync(file, 'utf8');
  if (source.includes('event_type:') || source.includes('severity:') || source.includes('user_id: args.userId')) throw new Error(`legacy security_events columns remain in ${file}`);
  if (!source.includes('metadata_redacted:')) throw new Error(`canonical security event metadata missing in ${file}`);
}
console.log('Step-up events use the canonical security_events schema.');

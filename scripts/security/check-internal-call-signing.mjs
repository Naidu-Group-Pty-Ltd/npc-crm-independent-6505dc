import { readFileSync } from 'node:fs';
const source = readFileSync('supabase/functions/_shared/internalCall.ts', 'utf8');
const failures = [];
if (source.includes("'x-internal-edge-secret'")) failures.push('shared internal caller transmits x-internal-edge-secret');
if (!source.includes('signInternalRequest')) failures.push('shared internal caller does not sign requests');
if (!source.includes("'Authorization': `Bearer ${anonKey}`")) failures.push('shared internal caller no longer uses anon gateway routing');
if (failures.length) { console.error(`Internal call signing FAILED:\n- ${failures.join('\n- ')}`); process.exit(1); }
console.log('Internal call signing check passed.');

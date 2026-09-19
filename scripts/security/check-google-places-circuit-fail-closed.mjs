import { readFileSync } from 'node:fs';
const source = readFileSync('supabase/functions/google-places-autocomplete/index.ts', 'utf8');
for (const required of ['error: circuitReadError', 'if (circuitReadError) return j', 'error: circuitWriteError', 'if (circuitWriteError) return j', 'error: circuitResetError', 'if (circuitResetError) return j']) {
  if (!source.includes(required)) throw new Error(`Google Places circuit does not fail closed: ${required}`);
}
console.log('Google Places shared circuit RPC failures fail closed.');

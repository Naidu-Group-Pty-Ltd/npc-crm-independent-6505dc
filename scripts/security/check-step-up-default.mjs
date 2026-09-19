import { readFileSync } from 'node:fs';
const source = readFileSync('supabase/functions/_shared/stepUp.ts', 'utf8');
if (!source.includes('if (!raw) return "enforce";')) throw new Error('Step-up does not enforce by default');
if (/if \(!raw \|\| raw === "false"/.test(source)) throw new Error('Step-up audit fallback still includes an unset environment');
console.log('Step-up enforcement defaults to fail-closed.');

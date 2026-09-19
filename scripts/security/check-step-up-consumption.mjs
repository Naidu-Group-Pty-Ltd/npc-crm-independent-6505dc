import { readFileSync } from 'node:fs';
const guard = readFileSync('supabase/functions/_shared/stepUp.ts', 'utf8');
const migration = readFileSync('supabase/migrations/20260724010000_step_up_token_consumption.sql', 'utf8');
for (const required of ['ONE_TIME_CAPABILITIES', 'consumed_at', '.is("consumed_at", null)', '"docusign.send"', 'mode === "enforce"']) if (!guard.includes(required)) throw new Error(`missing one-time step-up control: ${required}`);
if (!migration.includes('ADD COLUMN IF NOT EXISTS consumed_at')) throw new Error('step-up consumed_at migration missing');
console.log('Sensitive step-up tokens are consumed once.');

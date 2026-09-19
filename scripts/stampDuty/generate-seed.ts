/**
 * Emits the SQL that seeds `stamp_duty_rates_cache` from the shipped schedules.
 *
 * The seed is generated rather than hand-written for the same reason the rates
 * live in one file: a duty table transcribed a second time is a duty table that
 * will eventually disagree with the first. Run this after changing
 * `schedules.pure.ts` if the seeded rows need to move with it.
 *
 *   npx tsx scripts/stampDuty/generate-seed.ts
 */
import { DUTY_SCHEDULES, SCHEDULES_VERIFIED_ON } from '../../supabase/functions/_shared/stampDuty/schedules.pure.ts';

const rows = Object.values(DUTY_SCHEDULES).map((schedule) => {
  const json = JSON.stringify(schedule).replace(/'/g, "''");
  return `  ('${schedule.state}', '${json}'::jsonb, 'built_in', '${schedule.sourceUrl}', '${SCHEDULES_VERIFIED_ON}'::date)`;
});

process.stdout.write(rows.join(',\n') + '\n');

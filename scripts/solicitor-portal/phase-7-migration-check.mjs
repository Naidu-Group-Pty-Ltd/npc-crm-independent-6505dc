import fs from 'node:fs';
const sql=fs.readFileSync('supabase/migrations/20260730230000_unified_milestones_settlement_runway_phase7.sql','utf8');
for (const token of ['case_milestones','case_tasks','case_task_assignments','case_task_status_history','case_milestone_conflicts','get_case_runway','update_case_task_status','source_refs','STALE_VERSION','TASK_DOMAIN_FORBIDDEN','enqueue_integration_event']) if (!sql.includes(token)) throw new Error(`Missing ${token}`);
if (/property_address/i.test(sql)) throw new Error('Phase 7 backfill must not infer links by address');
console.log('Phase 7 migration contract passed');

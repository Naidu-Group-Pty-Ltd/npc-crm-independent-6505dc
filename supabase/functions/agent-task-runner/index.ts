import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyInternal, logSecurityEvent } from "../_shared/auth_v2.ts";
import { callInternalFunction } from "../_shared/internalCall.ts";
import { internalError } from '../_shared/errorResponse.ts';

/**
 * Agent Scheduled Task Runner
 * Triggered by pg_cron every 5 minutes. Checks for:
 * 1. Enabled scheduled tasks whose next_run_at has passed
 * 2. Checklist templates with cron_enabled that are due for instance generation
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!.trim();
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!.trim();
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')?.trim() || '';
    const sb = createClient(supabaseUrl, serviceRoleKey);

    // AUTH (Critical 6): trust the caller ONLY as a real internal/service
    // invocation — a valid service-role-key Bearer (the pg_cron vault pattern)
    // or an HMAC-signed internal request. The previous check trusted
    // `body.source === 'scheduled'` and fell through on any anon key /
    // Authorization header, so a public caller could drive privileged
    // scheduled automation. Body fields are never a trust signal.
    const rawBody = await req.text().catch(() => '');
    const internal = await verifyInternal(sb, req, rawBody, { strict: true, allowedCallers: ['pg_cron'] });
    if (!internal.ok) {
      await logSecurityEvent(sb, {
        action: 'agent_task_runner.invoke',
        decision: 'deny',
        reason_code: internal.errorCode ?? 'unauthorized',
        actor_type: 'cron',
      });
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    }

    const now = new Date().toISOString();
    console.log(`[agent-task-runner] Starting run at ${now}`);

    let processed = 0;
    let failed = 0;

    // ─── 1. Process scheduled tasks from agent_scheduled_tasks ───
    const { data: dueTasks, error: fetchErr } = await sb
      .from('agent_scheduled_tasks')
      .select('*')
      .eq('is_enabled', true)
      .lte('next_run_at', now)
      .order('next_run_at', { ascending: true })
      .limit(10);

    if (fetchErr) {
      console.error('[agent-task-runner] Fetch error:', fetchErr.message);
    }

    if (dueTasks && dueTasks.length > 0) {
      console.log(`[agent-task-runner] ${dueTasks.length} scheduled task(s) due`);

      for (const task of dueTasks) {
        try {
          console.log(`[agent-task-runner] Executing task: ${task.name} (${task.id})`);
          let result: any = null;

          if (task.task_type === 'playbook' && task.playbook_id) {
            result = await callAgent(supabaseUrl, serviceRoleKey, anonKey, {
              action: 'execute-tool',
              tool_name: 'run_playbook',
              tool_args: { playbook_id: task.playbook_id },
              user_id: task.user_id,
              task_id: task.id,
              source: 'scheduled_task',
            });
          } else if (task.task_type === 'single_tool' && task.tool_name) {
            result = await callAgent(supabaseUrl, serviceRoleKey, anonKey, {
              action: 'execute-tool',
              tool_name: task.tool_name,
              tool_args: task.tool_arguments || {},
              user_id: task.user_id,
              task_id: task.id,
              source: 'scheduled_task',
            });
          } else {
            result = { error: `Invalid task configuration: type=${task.task_type}` };
          }

          const nextRun = calculateNextRun(task.schedule_cron);
          const runStatus = result?.error ? 'error' : 'success';

          await sb.from('agent_scheduled_tasks').update({
            last_run_at: now,
            last_run_status: runStatus,
            last_run_result: result,
            next_run_at: nextRun,
            run_count: (task.run_count || 0) + 1,
            updated_at: now,
          }).eq('id', task.id);

          if (runStatus === 'success') { processed++; } else { failed++; }
          console.log(`[agent-task-runner] Task "${task.name}" ${runStatus}`);
        } catch (err: any) {
          failed++;
          console.error(`[agent-task-runner] Task "${task.name}" threw:`, err.message);
          const nextRun = calculateNextRun(task.schedule_cron);
          await sb.from('agent_scheduled_tasks').update({
            last_run_at: now,
            last_run_status: 'error',
            last_run_result: { error: err.message },
            next_run_at: nextRun,
            updated_at: now,
          }).eq('id', task.id);
        }
      }
    } else {
      console.log('[agent-task-runner] No scheduled tasks due');
    }

    // ─── 2. Process checklist templates with cron_enabled ───
    const { data: cronTemplates, error: cronErr } = await sb
      .from('checklist_templates')
      .select('*')
      .eq('cron_enabled', true)
      .eq('is_active', true);

    if (cronErr) {
      console.error('[agent-task-runner] Checklist cron fetch error:', cronErr.message);
    }

    if (cronTemplates && cronTemplates.length > 0) {
      console.log(`[agent-task-runner] ${cronTemplates.length} cron-enabled checklist template(s) found`);

      for (const tmpl of cronTemplates) {
        try {
          // Determine if this template is due for generation
          const isDue = isChecklistCronDue(tmpl.cron_expression, tmpl.last_generated_at);
          if (!isDue) {
            console.log(`[agent-task-runner] Template "${tmpl.name}" not yet due, skipping`);
            continue;
          }

          const occurrenceDate = now.slice(0, 10);
          const ownerContext = tmpl.created_by || 'global';
          const recurrenceKey = `cron:${tmpl.id}:${occurrenceDate}:${ownerContext}`;

          // Recurrence audit note: Daily Operations and other cron templates must generate instances, not templates.
          // Idempotency is enforced per template/date so completed or archived occurrences are not regenerated
          // for the same day and only future valid occurrences can appear in Active.
          const { data: existingInstance, error: existingErr } = await sb
            .from('checklist_instances')
            .select('id,status')
            .eq('recurrence_key', recurrenceKey)
            .eq('template_id', tmpl.id)
            .eq('due_date', occurrenceDate)
            .eq('generated_by', 'cron')
            .limit(1)
            .maybeSingle();

          if (existingErr) {
            console.error(`[agent-task-runner] Failed to check existing checklist occurrence for "${tmpl.name}":`, existingErr.message);
            failed++;
            continue;
          }

          if (existingInstance) {
            await sb.from('checklist_templates').update({
              last_generated_at: now,
              updated_at: now,
            }).eq('id', tmpl.id);
            console.log(`[agent-task-runner] Checklist occurrence already exists for ${tmpl.name} on ${occurrenceDate} (${existingInstance.status}), skipping`);
            continue;
          }

          console.log(`[agent-task-runner] Generating checklist from template: ${tmpl.name} (${tmpl.id}) for ${occurrenceDate}`);

          // Fetch template sections and items
          const { data: sections } = await sb
            .from('checklist_template_sections')
            .select('*, checklist_template_items(*)')
            .eq('template_id', tmpl.id)
            .order('display_order', { ascending: true });

          // Create instance
          const { data: instance, error: instErr } = await sb.from('checklist_instances').insert({
            template_id: tmpl.id,
            name: tmpl.name,
            description: tmpl.description,
            icon: tmpl.icon,
            generated_by: 'cron',
            status: 'in_progress',
            progress_percent: 0,
            due_date: occurrenceDate,
            recurrence_key: recurrenceKey,
          }).select().single();

          if (instErr || !instance) {
            if (instErr?.code === '23505') {
              console.log(`[agent-task-runner] Checklist occurrence was created concurrently for ${tmpl.name} on ${occurrenceDate}, skipping duplicate`);
              continue;
            }
            console.error(`[agent-task-runner] Failed to create instance for "${tmpl.name}":`, instErr?.message);
            failed++;
            continue;
          }

          // Create instance items from template sections/items
          const instanceItems: any[] = [];
          for (const sec of (sections || [])) {
            for (const item of (sec.checklist_template_items || []).sort((a: any, b: any) => a.display_order - b.display_order)) {
              instanceItems.push({
                instance_id: instance.id,
                section_title: sec.title,
                section_icon: sec.icon,
                section_order: sec.display_order,
                label: item.label,
                display_order: item.display_order,
                is_checked: item.is_pre_checked || false,
              });
            }
          }

          if (instanceItems.length > 0) {
            const { error: itemsErr } = await sb.from('checklist_instance_items').insert(instanceItems);
            if (itemsErr) {
              console.error(`[agent-task-runner] Failed to create items for "${tmpl.name}":`, itemsErr.message);
            }
          }

          // Update template's last_generated_at
          await sb.from('checklist_templates').update({
            last_generated_at: now,
            updated_at: now,
          }).eq('id', tmpl.id);

          processed++;
          console.log(`[agent-task-runner] Checklist "${tmpl.name}" generated successfully (${instanceItems.length} items)`);
        } catch (err: any) {
          failed++;
          console.error(`[agent-task-runner] Checklist template "${tmpl.name}" threw:`, err.message);
        }
      }
    }

    console.log(`[agent-task-runner] Done: ${processed} succeeded, ${failed} failed`);
    return new Response(
      JSON.stringify({ success: true, processed, failed }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('[agent-task-runner] Fatal error:', err.message);
    return new Response(
      JSON.stringify(internalError(err, 'agent-task-runner')),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ─── Helper: call ai-dashboard-agent ───
async function callAgent(_supabaseUrl: string, _serviceRoleKey: string, _anonKey: string, body: any): Promise<any> {
  // AUTH-002: authenticate via the dedicated internal secret, not the
  // service-role key. ai-dashboard-agent's execute-tool accepts it as service.
  const r = await callInternalFunction('ai-dashboard-agent', body, 'agent-task-runner');
  return r.data ?? { error: r.error || 'Failed to parse response' };
}

// ─── Check if a checklist cron template is due ───
function isChecklistCronDue(cronExpression: string | null, lastGeneratedAt: string | null): boolean {
  if (!cronExpression) return false;
  
  const now = new Date();
  
  // If never generated, it's due
  if (!lastGeneratedAt) return true;
  
  const lastGen = new Date(lastGeneratedAt);
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  
  const [minute, hour, , , dayOfWeek] = parts;

  // Check day-of-week constraint
  if (dayOfWeek !== '*') {
    const allowedDays = parseCronField(dayOfWeek, 0, 6);
    if (!allowedDays.includes(now.getUTCDay())) return false;
  }

  // Check if the scheduled time has passed today (UTC)
  const targetHour = hour !== '*' ? parseInt(hour) : 0;
  const targetMinute = minute !== '*' ? parseInt(minute) : 0;
  
  const scheduledToday = new Date(now);
  scheduledToday.setUTCHours(targetHour, targetMinute, 0, 0);
  
  // Must be past the scheduled time
  if (now < scheduledToday) return false;
  
  // Must not have been generated today already
  const lastGenDate = lastGen.toISOString().slice(0, 10);
  const todayDate = now.toISOString().slice(0, 10);
  if (lastGenDate === todayDate) return false;
  
  return true;
}

// ─── Calculate next run time from cron ───
function calculateNextRun(cron: string): string {
  const now = new Date();
  const parts = cron.trim().split(/\s+/);

  if (parts.length !== 5) {
    return new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  }

  const [minute, hour, , , dayOfWeek] = parts;

  // Handle interval patterns: */N minutes
  if (minute.startsWith('*/') && hour === '*') {
    const interval = parseInt(minute.slice(2)) || 60;
    return new Date(now.getTime() + interval * 60 * 1000).toISOString();
  }

  // Specific minute, */N hours
  if (hour.startsWith('*/')) {
    const interval = parseInt(hour.slice(2)) || 1;
    return new Date(now.getTime() + interval * 60 * 60 * 1000).toISOString();
  }

  // Specific time daily or weekday
  if (minute !== '*' && hour !== '*') {
    const targetMinute = parseInt(minute) || 0;
    const targetHour = parseInt(hour) || 0;

    const next = new Date(now);
    next.setHours(targetHour, targetMinute, 0, 0);

    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }

    if (dayOfWeek !== '*') {
      const allowedDays = parseCronField(dayOfWeek, 0, 6);
      let safety = 0;
      while (!allowedDays.includes(next.getDay()) && safety < 8) {
        next.setDate(next.getDate() + 1);
        safety++;
      }
    }

    return next.toISOString();
  }

  return new Date(now.getTime() + 60 * 60 * 1000).toISOString();
}

function parseCronField(field: string, min: number, max: number): number[] {
  if (field === '*') return Array.from({ length: max - min + 1 }, (_, i) => min + i);

  const values: number[] = [];
  for (const part of field.split(',')) {
    if (part.includes('-')) {
      const [a, b] = part.split('-').map(Number);
      for (let i = a; i <= b; i++) values.push(i);
    } else if (part.startsWith('*/')) {
      const step = parseInt(part.slice(2)) || 1;
      for (let i = min; i <= max; i += step) values.push(i);
    } else {
      values.push(parseInt(part));
    }
  }
  return values;
}

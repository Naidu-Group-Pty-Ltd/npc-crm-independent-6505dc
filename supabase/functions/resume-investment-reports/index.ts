// resume-investment-reports
// Cron-triggered worker that drives stalled investment reports to completion.
//
// Why this exists: a Compass report needs several minutes of model time, but a
// Supabase edge invocation is killed at ~150s. `generate-investment-report` now
// stops at a wall-clock budget and returns `resumeRequired: true` rather than
// being killed mid-section — but something has to call it back. Before this
// worker the only thing that ever did was an open browser tab running the
// progress widget, so closing the tab abandoned the report partway through
// with status stuck on 'processing'.
//
// Auth: accepts only signed requests from the investment-report-resume pg_cron
// job, exactly as resume-bulk-generation does.

import 'https://deno.land/x/xhr@0.1.0/mod.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { enforceRawBodyLimit, securityJsonError, verifySignedInternal } from '../_shared/requestSecurity.ts';
import { internalError } from '../_shared/errorResponse.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

const INTERNAL_EDGE_SECRET = (Deno.env.get('INTERNAL_EDGE_SECRET') || '').trim();

// This worker runs under the same ~150s ceiling as the function it calls, so it
// budgets its own wall clock too: stop claiming new reports once we are this far
// in, and never let a single inner call run past the ceiling.
const WORKER_BUDGET_MS = 100_000;
const INNER_CALL_TIMEOUT_MS = 130_000;
const MAX_REPORTS_PER_TICK = 3;

interface ClaimedReport {
  id: string;
  property_address: string;
  last_completed_section: number | null;
  total_sections: number | null;
  resume_attempts: number;
}

/**
 * Drive one report forward by a single budgeted invocation of the generator.
 * The generator persists progress per section, so a call that is cut short
 * still advances the report — we only need to know whether it finished.
 */
async function resumeOne(
  report: ClaimedReport,
  signal: AbortSignal,
): Promise<{ isComplete: boolean; sectionCompleted: number | null; error?: string }> {
  const supabaseUrl = (Deno.env.get('SUPABASE_URL') || '').trim();
  const anonKey = (Deno.env.get('SUPABASE_ANON_KEY') || '').trim();

  const response = await fetch(`${supabaseUrl}/functions/v1/generate-investment-report`, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      // The gateway wants a JWT; verifyAuth recognises the internal credential.
      'Authorization': `Bearer ${INTERNAL_EDGE_SECRET}`,
      'apikey': anonKey,
    },
    body: JSON.stringify({
      reportId: report.id,
      propertyAddress: report.property_address,
      // continueFrom makes the generator skip everything already banked and
      // pick up at last_completed_section. A report that already has all its
      // sections falls straight through to finalisation, which is how rows that
      // died during post-processing get rescued.
      continueFrom: true,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    return { isComplete: false, sectionCompleted: null, error: `HTTP ${response.status}: ${text.slice(0, 300)}` };
  }

  const json = await response.json().catch(() => null);
  if (!json) return { isComplete: false, sectionCompleted: null, error: 'Unparseable response' };

  // The generator reports completion in one of two shapes: `isComplete: true`
  // from the chunked path, or a plain success with no resume flag from the run
  // that finished post-processing.
  const isComplete = json.isComplete === true || (json.success === true && !json.resumeRequired);

  return {
    isComplete,
    sectionCompleted: typeof json.sectionCompleted === 'number' ? json.sectionCompleted : null,
    error: json.success === false ? String(json.error || 'Generator reported failure') : undefined,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startedAt = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const boundedBody = await enforceRawBodyLimit(req, 1024);
    if (!boundedBody.ok) return boundedBody.error;

    // The sibling worker's trap, closed here before it fires. This one's live
    // schedule still carries `investment-report-resume-cron` and works, but it
    // is the only other job in the fleet that does not sign as `pg_cron` — so
    // one out-of-band re-schedule taking the default argument would silently
    // stop every investment-report resume, exactly as it did for
    // `resume-bulk-generation`. See the note there for why accepting both
    // spellings widens nothing.
    const auth = await verifySignedInternal(
      supabase,
      req,
      boundedBody.raw,
      ['investment-report-resume-cron', 'pg_cron'],
    );
    if (!auth.ok) {
      console.warn('[resume-investment-reports] rejected unauthorized invocation', {
        correlationId: auth.correlationId,
        errorCode: auth.errorCode,
      });
      return securityJsonError(401, 'authentication_required', auth.correlationId);
    }

    if (INTERNAL_EDGE_SECRET.length === 0) {
      console.error('[resume-investment-reports] INTERNAL_EDGE_SECRET is unset — cannot call the generator');
      return securityJsonError(503, 'missing_credentials', auth.correlationId);
    }

    const workerId = `cron-${startedAt.toString(36)}`;
    const { data: claims, error: claimErr } = await supabase.rpc('claim_stalled_investment_reports', {
      p_limit: MAX_REPORTS_PER_TICK,
      p_worker: workerId,
    });
    if (claimErr) throw claimErr;

    const reports: ClaimedReport[] = claims || [];
    if (reports.length === 0) {
      return new Response(JSON.stringify({ success: true, claimed: 0, results: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[resume-investment-reports] claimed ${reports.length} stalled report(s) as ${workerId}`);

    const results: Array<Record<string, unknown>> = [];

    for (const report of reports) {
      // Do not start a report we have no time to make progress on — it would
      // just burn an attempt. Leave it claimed; the lease expires in 5 minutes.
      if (Date.now() - startedAt > WORKER_BUDGET_MS) {
        console.log(`[resume-investment-reports] budget reached, deferring ${report.id} to the next tick`);
        await supabase.rpc('release_investment_report_resume', {
          p_report_id: report.id,
          // Not a failure — never count a deferral against the attempt budget.
          p_made_progress: true,
        });
        results.push({ reportId: report.id, deferred: true });
        continue;
      }

      const before = report.last_completed_section ?? 0;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort('inner call timeout'), INNER_CALL_TIMEOUT_MS);

      try {
        const outcome = await resumeOne(report, controller.signal);
        const after = outcome.sectionCompleted ?? before;
        const madeProgress = outcome.isComplete || after > before;

        await supabase.rpc('release_investment_report_resume', {
          p_report_id: report.id,
          p_made_progress: madeProgress,
        });

        console.log(
          `[resume-investment-reports] ${report.property_address}: ${before} → ${after}` +
          `${outcome.isComplete ? ' (complete)' : ''}${outcome.error ? ` error=${outcome.error}` : ''}`
        );
        results.push({
          reportId: report.id,
          sectionsBefore: before,
          sectionsAfter: after,
          isComplete: outcome.isComplete,
          madeProgress,
          error: outcome.error,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[resume-investment-reports] resume failed for ${report.id}:`, message);
        // Release without progress so the attempt counts — a report that keeps
        // throwing needs to reach the retirement threshold, not spin forever.
        await supabase.rpc('release_investment_report_resume', {
          p_report_id: report.id,
          p_made_progress: false,
        });
        results.push({ reportId: report.id, error: message });
      } finally {
        clearTimeout(timeout);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      claimed: reports.length,
      elapsedMs: Date.now() - startedAt,
      results,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[resume-investment-reports] error:', error);
    return new Response(JSON.stringify({
      ...internalError(error, 'resume-investment-reports'),
      success: false,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

/**
 * Performs one workflow step that needs credentials or network the browser
 * should not have.
 *
 * Deliberately one *step*, not a whole workflow. The engine that decides what a
 * workflow means lives in `_shared/workflow/engine.pure.ts`; when a person
 * presses "Run live" that engine is running in their page, and it calls here
 * once per step because the page holds no credentials and CORS would stop it
 * reaching most of these endpoints anyway.
 *
 * What a step *does* is not decided here either — that is
 * `_shared/workflow/stepExecutor.ts`, shared with `dispatch-workflow-triggers`
 * so a step started by a captured event behaves exactly as it does when a
 * person starts it. This file is the human-authenticated door onto it: verify
 * the session, require admin, refuse anything off the allow-list.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  verifyAuth,
  createCorsHeaders,
  createUnauthorizedResponse,
  createForbiddenResponse,
} from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import {
  LIVE_CAPABLE_STEP_TYPES,
  executeStep,
  type StepClient,
} from '../_shared/workflow/stepExecutor.ts';

interface StepRequest {
  nodeType?: string;
  /** Config with every {{…}} already resolved by the engine. */
  config?: Record<string, unknown>;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body: StepRequest = await req.json().catch(() => ({}));

    const authResult = await verifyAuth(supabase, req.headers, body as Record<string, unknown>);
    if (authResult.error) return createUnauthorizedResponse(authResult.error, corsHeaders);

    // Running a live step can reach any endpoint the workflow names, which is
    // the same privilege as editing the integrations themselves.
    const { data: roleData } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', authResult.userId)
      .in('role', ['superadmin', 'admin'])
      .maybeSingle();

    if (!roleData) {
      return createForbiddenResponse('Forbidden: admin access required', corsHeaders);
    }

    const nodeType = String(body.nodeType ?? '');
    if (!LIVE_CAPABLE_STEP_TYPES.has(nodeType)) {
      return new Response(
        JSON.stringify({
          status: 'failed',
          error: `“${nodeType}” has no server-side executor. Use Test run, or an HTTP request step.`,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const outcome = await executeStep(
      nodeType,
      (body.config ?? {}) as Record<string, unknown>,
      {
        supabase: supabase as unknown as StepClient,
        userId: authResult.userId as string,
      },
    );

    return new Response(JSON.stringify(outcome), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The step could not be performed.';
    console.error('[execute-workflow-step]', message);
    return new Response(JSON.stringify({ status: 'failed', error: message }), {
      status: 200, // The engine records a failed step; the call itself succeeded.
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

/**
 * The browser's route to the outside world.
 *
 * The engine takes a `perform` function and never opens a socket itself. In the
 * browser that function has to go through `execute-workflow-step`, because the
 * page has neither the credentials nor the right to call an arbitrary endpoint:
 * a fetch from here would carry the user's cookies, be visible in devtools, and
 * be stopped by CORS on most of the endpoints a workflow wants to reach.
 *
 * So this module does not implement steps. It hands the step's already-resolved
 * config to the edge function and reports what came back — the same shape the
 * engine gets from `simulate`, so the two are interchangeable.
 */

import { invokeSecureFunction } from '@/lib/secureInvoke';
import type { Perform, PerformInput, PerformOutcome } from './engine';
import { LIVE_CAPABLE } from './performers';

interface StepResponse {
  status?: string;
  output?: Record<string, unknown>;
  error?: string;
}

/** Statuses the engine understands; anything else is treated as a failure. */
const isOutcomeStatus = (value: string): value is PerformOutcome['status'] =>
  value === 'succeeded' || value === 'failed' || value === 'simulated';

/**
 * Live performer for the browser.
 *
 * Refuses locally rather than calling for steps the server would reject anyway,
 * so an unsupported step gives a useful message instead of a 400.
 */
/**
 * Steps that live mode performs without leaving the browser.
 *
 * `core.webhook_respond` shapes the response the *caller* of an inbound webhook
 * receives; there is no outbound call and no credential involved, so sending it
 * to the executor gained nothing and cost correctness — the endpoint's allow-list
 * does not include it, so a live run containing one failed with "no server-side
 * executor" for a step that never needed one.
 */
const HANDLED_LOCALLY = new Set(['core.webhook_respond']);

export function createServerPerformer(): Perform {
  return async ({ definition, node, config }: PerformInput): Promise<PerformOutcome> => {
    if (HANDLED_LOCALLY.has(node.type)) {
      return {
        status: 'succeeded',
        output: { status: Number(config.status ?? 200), body: config.body ?? null },
      };
    }

    if (!LIVE_CAPABLE.has(node.type)) {
      return {
        status: 'failed',
        error: `${definition.name} has no executor yet, so a live run cannot perform it. Use Test run, or replace it with an HTTP request step.`,
      };
    }

    const { data, error } = await invokeSecureFunction<StepResponse>('execute-workflow-step', {
      nodeType: node.type,
      config,
    });

    if (error) {
      return {
        status: 'failed',
        error: error.message ?? 'The step could not be sent to the server.',
      };
    }

    const status = String(data?.status ?? 'failed');
    return {
      status: isOutcomeStatus(status) ? status : 'failed',
      output: data?.output ?? {},
      error: data?.error,
    };
  };
}

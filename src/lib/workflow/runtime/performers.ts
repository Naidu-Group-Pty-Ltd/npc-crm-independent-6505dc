/**
 * What happens when a step is not control flow.
 *
 * Two performers, and the difference between them is the whole safety story:
 *
 *   simulate — resolves the step's inputs and reports what *would* be sent,
 *              without sending it. This is what Test run uses, so pressing it
 *              never emails a client or writes to a CRM.
 *   live     — actually performs the call, but only for steps with a correct
 *              generic implementation. Anything else reports "no executor"
 *              rather than silently succeeding, because a workflow that claims
 *              to have sent an email it did not send is worse than one that
 *              admits it cannot.
 *
 * The honest list of what live mode can do today is `LIVE_CAPABLE`.
 */

import type { CatalogNode } from '../types';
import type { Perform, PerformInput, PerformOutcome } from './engine';
import { CLIENT_CAPABLE_STEP_TYPES } from '@/lib/workflow/liveCapability';
import { sampleOutput } from './sampleData';

/**
 * Steps live mode can genuinely execute.
 *
 * Derived from the catalog, in `liveCapability.pure.ts`, which the executor and
 * the dispatcher read too — so the three cannot hold different opinions about
 * what runs.
 */
export const LIVE_CAPABLE = CLIENT_CAPABLE_STEP_TYPES;

/** A short, plain-language account of what a step was about to do. */
export function describeIntent(definition: CatalogNode, config: Record<string, unknown>): string {
  const target =
    config.to ?? config.url ?? config.channel ?? config.address ?? config.email ?? config.recipient;

  if (target) return `${definition.name} → ${String(target)}`;
  if (definition.integrationId) return `${definition.name} via ${definition.integrationId}`;
  return definition.name;
}

/** Test-run performer: resolves and reports, never sends. */
export const simulate: Perform = async ({ definition, config }: PerformInput): Promise<PerformOutcome> => ({
  status: 'simulated',
  output: sampleOutput(definition),
  simulationNote: `Would call ${describeIntent(definition, config)}. Nothing was sent.`,
});

export interface LiveTransport {
  /** Performs an HTTP request. Injected so the executor owns the network. */
  request: (init: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
  }) => Promise<{ status: number; headers: Record<string, string>; body: unknown }>;
  /** Posts an in-dashboard notification. */
  notify?: (input: { recipient: string; title: string; body?: string; priority?: string }) => Promise<string>;
  /** Saved MCP server, used when a step does not override it. */
  mcp?: { serverUrl?: string; accessToken?: string };
}

const asKeyValueHeaders = (value: unknown): Record<string, string> => {
  if (!Array.isArray(value)) return {};
  const headers: Record<string, string> = {};
  for (const pair of value as { key?: string; value?: string }[]) {
    if (pair?.key) headers[pair.key] = String(pair.value ?? '');
  }
  return headers;
};

/**
 * Live performer. Executes what it can and is explicit about what it cannot,
 * so an unsupported step fails the run rather than quietly reporting success.
 */
export function createLivePerformer(transport: LiveTransport): Perform {
  return async ({ definition, node, config }: PerformInput): Promise<PerformOutcome> => {
    if (!LIVE_CAPABLE.has(node.type)) {
      return {
        status: 'failed',
        error: `${definition.name} has no executor yet, so a live run cannot perform it. Use Test run, or replace it with an HTTP request step.`,
      };
    }

    switch (node.type) {
      case 'core.http': {
        const url = String(config.url ?? '');
        if (!url) return { status: 'failed', error: 'No URL to call.' };
        const method = String(config.method ?? 'GET').toUpperCase();
        const response = await transport.request({
          url,
          method,
          headers: { 'Content-Type': 'application/json', ...asKeyValueHeaders(config.headers) },
          body: ['POST', 'PUT', 'PATCH'].includes(method) && config.body != null
            ? typeof config.body === 'string'
              ? config.body
              : JSON.stringify(config.body)
            : undefined,
        });
        return {
          status: response.status >= 200 && response.status < 400 ? 'succeeded' : 'failed',
          output: { status: response.status, body: response.body, headers: response.headers },
          error:
            response.status >= 400 ? `The endpoint answered ${response.status}.` : undefined,
        };
      }

      case 'core.graphql': {
        const url = String(config.url ?? '');
        if (!url) return { status: 'failed', error: 'No endpoint to call.' };
        const response = await transport.request({
          url,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...asKeyValueHeaders(config.headers) },
          body: JSON.stringify({ query: config.query, variables: config.variables ?? {} }),
        });
        const body = (response.body ?? {}) as { data?: unknown; errors?: unknown[] };
        return {
          status: body.errors?.length ? 'failed' : 'succeeded',
          output: { data: body.data ?? null, errors: body.errors ?? [], status: response.status },
          error: body.errors?.length ? 'The endpoint returned GraphQL errors.' : undefined,
        };
      }

      case 'core.notify_team': {
        if (!transport.notify) {
          return { status: 'failed', error: 'Notifications are not available in this environment.' };
        }
        const notificationId = await transport.notify({
          recipient: String(config.recipient ?? ''),
          title: String(config.title ?? ''),
          body: config.body == null ? undefined : String(config.body),
          priority: String(config.priority ?? 'normal'),
        });
        return { status: 'succeeded', output: { notificationId } };
      }

      case 'core.webhook_respond':
        // The executor owns the response; the step records the intent.
        return {
          status: 'succeeded',
          output: { status: Number(config.status ?? 200), body: config.body ?? null },
        };

      case 'mcp.list_tools':
      case 'mcp.call_tool':
      case 'mcp.read_resource':
      case 'mcp.get_prompt':
        return performMcp(node.type, config, transport);

      default:
        return { status: 'failed', error: `${definition.name} has no executor.` };
    }
  };
}

/** MCP over JSON-RPC. One shape for all four operations. */
async function performMcp(
  type: string,
  config: Record<string, unknown>,
  transport: LiveTransport,
): Promise<PerformOutcome> {
  const serverUrl = String(config.serverUrl || transport.mcp?.serverUrl || '');
  if (!serverUrl) {
    return {
      status: 'failed',
      error: 'No MCP server. Add one on the Integrations page, or set a server on this step.',
    };
  }

  const method =
    type === 'mcp.list_tools'
      ? 'tools/list'
      : type === 'mcp.call_tool'
        ? 'tools/call'
        : type === 'mcp.read_resource'
          ? 'resources/read'
          : 'prompts/get';

  const params: Record<string, unknown> =
    type === 'mcp.call_tool'
      ? { name: config.toolName, arguments: config.arguments ?? {} }
      : type === 'mcp.read_resource'
        ? { uri: config.uri }
        : type === 'mcp.get_prompt'
          ? { name: config.promptName, arguments: config.arguments ?? {} }
          : {};

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = transport.mcp?.accessToken;
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await transport.request({
    url: serverUrl,
    method: 'POST',
    headers,
    // id is fixed: one request per step, so there is nothing to correlate.
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });

  const body = (response.body ?? {}) as {
    result?: Record<string, unknown>;
    error?: { message?: string };
  };

  if (body.error) {
    return { status: 'failed', error: body.error.message ?? 'The MCP server returned an error.' };
  }

  const result = body.result ?? {};
  const content = Array.isArray(result.content) ? (result.content as { text?: string }[]) : [];
  const text = content.map((part) => part?.text ?? '').filter(Boolean).join('\n');

  return {
    status: 'succeeded',
    output: {
      ...result,
      text: text || undefined,
      count: Array.isArray(result.tools) ? result.tools.length : undefined,
    },
  };
}

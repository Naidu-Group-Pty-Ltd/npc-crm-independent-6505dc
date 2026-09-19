/**
 * The one place a workflow step actually reaches the outside world.
 *
 * Two callers need this and must not disagree about what a step does:
 *
 *   • `execute-workflow-step` — one step at a time, for a person pressing
 *     "Run live" in the browser. The engine runs in the page and calls out per
 *     step, because the page holds no credentials and CORS would stop it anyway.
 *   • `dispatch-workflow-triggers` — whole workflows, with nobody watching,
 *     started by a captured platform event.
 *
 * Splitting the executor out is what lets the second one exist without becoming
 * a second implementation of the first. The allow-list below is the safety
 * boundary for both: a step type that is not on it is refused, so neither
 * caller can be turned into a general-purpose proxy.
 *
 * Note this is `.ts`, not `.pure.ts` — it performs IO and reads the
 * environment, so it is deliberately not part of the browser bundle.
 */

import { getCatalogNode } from './catalog/index.pure.ts';
import { SERVER_CAPABLE_STEP_TYPES } from './liveCapability.pure.ts';
import { buildRequest, mapOutputs, requestFailure } from './httpRequest.pure.ts';
import type { CatalogNode } from './types.pure.ts';
import { meteredFetch } from '../meteredFetch.ts';

/**
 * Everything the server will perform. Derived from the catalog — see
 * `liveCapability.pure.ts` for why this is not a list.
 */
export const LIVE_CAPABLE_STEP_TYPES = SERVER_CAPABLE_STEP_TYPES;

/** Credential keys the descriptors reference, so a caller can fetch just those. */
export function secretsRequiredBy(node: CatalogNode): string[] {
  const request = node.request;
  if (!request) return [];
  const keys = new Set<string>(request.requires ?? []);
  // Anything the templates reach for, whether or not it was declared required.
  const scan = (value: unknown): void => {
    if (typeof value === 'string') {
      for (const match of value.matchAll(/\{\{\s*secret\.([A-Z0-9_]+)/g)) keys.add(match[1]);
      return;
    }
    if (Array.isArray(value)) return value.forEach(scan);
    if (value && typeof value === 'object') Object.values(value).forEach(scan);
  };
  scan(request.url);
  scan(request.headers);
  scan(request.query);
  scan(request.body);
  if (request.auth && request.auth.type !== 'none') {
    if (request.auth.type === 'basic') {
      keys.add(request.auth.userSecret);
      keys.add(request.auth.passSecret);
    } else {
      keys.add(request.auth.secret);
    }
  }
  return [...keys];
}

/** Hosts that are never callable, whatever the workflow says. */
const BLOCKED_HOSTS = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  'metadata.google.internal',
  '169.254.169.254', // cloud instance metadata
];

const MAX_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 512 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface StepOutcome {
  status: 'succeeded' | 'failed' | 'simulated';
  output?: unknown;
  error?: string;
}

/**
 * Only the client surface this module uses.
 *
 * `ReturnType<typeof createClient>` collapses the untyped generic defaults to
 * `never`, which makes any insert unwritable; naming the shape we actually use
 * keeps the call typed without pulling the generated database types into Deno.
 */
export interface StepClient {
  from(table: string): {
    insert(row: Record<string, unknown>): {
      select(columns: string): {
        single(): Promise<{ data: { id?: string } | null; error: { message: string } | null }>;
      };
    };
    select(columns: string): {
      in(column: string, values: string[]): Promise<{
        data: { key_name?: string; key_value?: string | null }[] | null;
        error: { message: string } | null;
      }>;
    };
  };
}

export interface StepExecutionContext {
  supabase: StepClient;
  /**
   * Whose authority the step runs under. A notification with no addressable
   * recipient goes here rather than nowhere.
   *
   * Null when nobody can be resolved — a dispatched run has no operator, and
   * the workflow it came from may have no recorded owner. Steps that need to
   * address a person say so rather than proceeding: `notifications` allows a
   * null `target_user_id`, so writing one anyway would produce a notification
   * addressed to nobody and report it as a success.
   */
  userId: string | null;
}

/**
 * Refuses anything that is not a public HTTP(S) endpoint. Without this, a
 * workflow could be pointed at cloud metadata or an internal service and used
 * to read things the browser could never reach itself.
 */
export function assertCallableUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`“${raw}” is not a valid URL.`);
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Only http and https endpoints can be called.');
  }

  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.includes(host)) {
    throw new Error('That host is not reachable from workflows.');
  }
  // Private ranges, in case a public name resolves inward.
  if (/^(10\.|192\.168\.|127\.|169\.254\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
    throw new Error('Private network addresses are not reachable from workflows.');
  }
  return url;
}

const keyValueHeaders = (value: unknown): Record<string, string> => {
  if (!Array.isArray(value)) return {};
  const headers: Record<string, string> = {};
  for (const pair of value as { key?: string; value?: string }[]) {
    if (pair?.key) headers[String(pair.key)] = String(pair.value ?? '');
  }
  return headers;
};

async function readBoundedBody(response: Response): Promise<unknown> {
  const text = (await response.text()).slice(0, MAX_RESPONSE_BYTES);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function request(init: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}) {
  assertCallableUrl(init.url);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.min(init.timeoutMs ?? MAX_TIMEOUT_MS, MAX_TIMEOUT_MS),
  );
  try {
    const response = await fetch(init.url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      signal: controller.signal,
      redirect: 'follow',
    });
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: await readBoundedBody(response),
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Reads the credentials a descriptor needs out of `integration_configs`.
 *
 * Only the keys that step actually references are fetched. A step that sends an
 * SMS has no business pulling every API key in the workspace into memory, and a
 * narrower read is a smaller blast radius if an output ever gets logged.
 */
async function loadSecrets(supabase: StepClient, keys: string[]): Promise<Record<string, string>> {
  if (!keys.length) return {};
  const { data } = await supabase.from('integration_configs').select('key_name, key_value').in('key_name', keys);
  const secrets: Record<string, string> = {};
  for (const row of data ?? []) {
    if (row.key_name && typeof row.key_value === 'string' && row.key_value.trim() !== '') {
      secrets[row.key_name] = row.key_value;
    }
  }
  return secrets;
}

/** Keeps credential values out of anything that gets stored or logged. */
function redact(value: unknown, secrets: string[]): unknown {
  if (!secrets.length) return value;
  const scrub = (text: string) =>
    secrets.reduce((acc, secret) => (secret ? acc.split(secret).join('[redacted]') : acc), text);

  if (typeof value === 'string') return scrub(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, secrets));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redact(v, secrets)]),
    );
  }
  return value;
}

/**
 * Performs any operation the catalog gave a request descriptor.
 *
 * This is the whole of "expanding endpoint coverage": every integration wired
 * this way runs through here, so there is one place where a credential is
 * resolved, one place where a vendor's own error shape is read, and one place
 * where the response is mapped onto the outputs the canvas promised downstream
 * steps.
 */
async function executeDescribedStep(
  definition: CatalogNode,
  config: Record<string, unknown>,
  ctx: StepExecutionContext,
): Promise<StepOutcome> {
  const descriptor = definition.request!;
  const secrets = await loadSecrets(ctx.supabase, secretsRequiredBy(definition));

  const built = buildRequest({ request: descriptor, config, secrets });
  if (built.ok === false) return { status: 'failed', error: built.failure.error };

  assertCallableUrl(built.request.url);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MAX_TIMEOUT_MS);
  let response: Response;
  try {
    // `meteredFetch` resolves the credential from the host and logs the call,
    // so a vendor added here is billed without anybody remembering to say so.
    response = await meteredFetch(built.request.url, {
      method: built.request.method,
      headers: built.request.headers,
      body: built.request.body,
      signal: controller.signal,
      redirect: 'follow',
    }, { feature: `workflow/${definition.id}` });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'The request could not be sent.';
    return {
      status: 'failed',
      error: controller.signal.aborted ? `${definition.name} timed out after 30 seconds.` : message,
    };
  } finally {
    clearTimeout(timeout);
  }

  const shape = { status: response.status, body: await readBoundedBody(response) };
  const failure = requestFailure(descriptor, shape);
  const output = redact(mapOutputs(definition, shape), built.request.secretValues) as Record<string, unknown>;

  if (failure) return { status: 'failed', output, error: `${definition.name}: ${failure}` };
  return { status: 'succeeded', output };
}

/**
 * Performs one step.
 *
 * Throws only for programmer error; an endpoint that refuses, times out or
 * answers 500 is a *failed step*, not a failed call, and is reported as such so
 * the engine can record it and carry on deciding what happens next.
 */
export async function executeStep(
  nodeType: string,
  config: Record<string, unknown>,
  ctx: StepExecutionContext,
): Promise<StepOutcome> {
  // A declared operation is performed by the generic executor. Checked before
  // the hand-written cases so a descriptor can supersede one later without
  // leaving the old branch silently in charge.
  const definition = getCatalogNode(nodeType);
  if (definition?.request) return executeDescribedStep(definition, config, ctx);

  switch (nodeType) {
    case 'core.http': {
      const method = String(config.method ?? 'GET').toUpperCase();
      const response = await request({
        url: String(config.url ?? ''),
        method,
        headers: { 'Content-Type': 'application/json', ...keyValueHeaders(config.headers) },
        body: ['POST', 'PUT', 'PATCH'].includes(method) && config.body != null
          ? typeof config.body === 'string' ? config.body : JSON.stringify(config.body)
          : undefined,
        timeoutMs: Number(config.timeoutSeconds ?? 30) * 1000,
      });
      return {
        status: response.status >= 200 && response.status < 400 ? 'succeeded' : 'failed',
        output: response,
        error: response.status >= 400 ? `The endpoint answered ${response.status}.` : undefined,
      };
    }

    case 'core.graphql': {
      const response = await request({
        url: String(config.url ?? ''),
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...keyValueHeaders(config.headers) },
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
      const title = String(config.title ?? 'Workflow notification');
      // The recipient field is free text ("Team or user"), so only a literal
      // user id can be addressed; anything else goes to whoever ran it rather
      // than to nobody.
      const recipient = String(config.recipient ?? '').trim();
      const target = UUID.test(recipient) ? recipient : ctx.userId;
      if (!target) {
        return {
          status: 'failed',
          error:
            'There is nobody to notify: “Team or user” is not a user id, and this run has no '
            + 'operator to fall back to. Put a user id in that field.',
        };
      }
      const { data, error } = await ctx.supabase
        .from('notifications')
        .insert({
          target_user_id: target,
          created_by: ctx.userId,
          type: 'workflow',
          title,
          // NOT NULL in the schema — an empty body still needs something.
          message: config.body == null || config.body === '' ? title : String(config.body),
          metadata: { source: 'workflow', priority: String(config.priority ?? 'normal'), recipient },
          read: false,
        })
        .select('id')
        .single();
      if (error) return { status: 'failed', error: error.message };
      return { status: 'succeeded', output: { notificationId: data?.id } };
    }

    case 'mcp.list_tools':
    case 'mcp.call_tool':
    case 'mcp.read_resource':
    case 'mcp.get_prompt': {
      const serverUrl = String(config.serverUrl || Deno.env.get('MCP_SERVER_URL') || '');
      if (!serverUrl) {
        return { status: 'failed', error: 'No MCP server configured. Add one on the Integrations page.' };
      }

      const method = nodeType === 'mcp.list_tools'
        ? 'tools/list'
        : nodeType === 'mcp.call_tool'
          ? 'tools/call'
          : nodeType === 'mcp.read_resource'
            ? 'resources/read'
            : 'prompts/get';

      const params = nodeType === 'mcp.call_tool'
        ? { name: config.toolName, arguments: config.arguments ?? {} }
        : nodeType === 'mcp.read_resource'
          ? { uri: config.uri }
          : nodeType === 'mcp.get_prompt'
            ? { name: config.promptName, arguments: config.arguments ?? {} }
            : {};

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const token = Deno.env.get('MCP_ACCESS_TOKEN');
      if (token) headers.Authorization = `Bearer ${token}`;

      const response = await request({
        url: serverUrl,
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });

      const body = (response.body ?? {}) as { result?: Record<string, unknown>; error?: { message?: string } };
      if (body.error) return { status: 'failed', error: body.error.message ?? 'The MCP server returned an error.' };

      const result = body.result ?? {};
      const content = Array.isArray(result.content) ? result.content as { text?: string }[] : [];
      const text = content.map((part) => part?.text ?? '').filter(Boolean).join('\n');
      return {
        status: 'succeeded',
        output: { ...result, text: text || undefined, count: Array.isArray(result.tools) ? result.tools.length : undefined },
      };
    }

    default:
      return { status: 'failed', error: `${nodeType} cannot be performed here.` };
  }
}

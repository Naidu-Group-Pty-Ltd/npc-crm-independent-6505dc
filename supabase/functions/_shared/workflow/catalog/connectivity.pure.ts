/**
 * Model Context Protocol, and the generic API escapes.
 *
 * MCP matters here because it inverts the usual problem: rather than this
 * catalog needing an entry for every service anyone might want, an MCP server
 * describes its own tools at run time and the workflow discovers them. One
 * integration, an open-ended set of capabilities.
 *
 * The generic nodes are the deliberate escape hatch. A catalog of 240-odd
 * operations will still miss something, and a workflow that cannot call an
 * arbitrary endpoint pushes people back to writing code elsewhere.
 */

import { f, native, opt, outs, provider } from './builders.pure.ts';
import type { CatalogNode } from '../types.pure.ts';

/** Lets a step point at a different server than the saved default. */
const SERVER_OVERRIDE = f.text('serverUrl', 'Server', {
  placeholder: 'Uses the saved MCP server',
  help: 'Only set this to reach a different server than the one on the Integrations page.',
});

export const CONNECTIVITY_NODES: CatalogNode[] = [
  ...provider(
    { integrationId: 'mcp', category: 'infrastructure', docs: 'https://modelcontextprotocol.io/docs' },
    [
      {
        op: 'list_tools',
        name: 'List server tools',
        summary: 'Asks an MCP server what it can do and returns its tool list.',
        docsUrl: 'https://modelcontextprotocol.io/docs/concepts/tools',
        fields: [SERVER_OVERRIDE],
        outputs: outs('tools:array:Tools', 'count:number', 'serverName:string:Server name'),
        keywords: ['mcp', 'discover', 'capabilities', 'tools'],
      },
      {
        op: 'call_tool',
        name: 'Call a server tool',
        summary: 'Runs one tool on an MCP server and returns what it produced.',
        docsUrl: 'https://modelcontextprotocol.io/docs/concepts/tools',
        fields: [
          SERVER_OVERRIDE,
          f.text('toolName', 'Tool', { required: true, placeholder: 'search_documents' }),
          f.json('arguments', 'Arguments', {
            help: 'JSON matching the tool’s input schema. Values may reference earlier steps.',
          }),
          f.number('timeoutSeconds', 'Timeout (seconds)', { defaultValue: 60 }),
        ],
        outputs: outs(
          'content:array:Content',
          'text:string:Text output',
          'structured:object:Structured output',
          'isError:boolean:Reported an error',
        ),
        keywords: ['mcp', 'tool', 'invoke', 'agent', 'call'],
      },
      {
        op: 'read_resource',
        name: 'Read a server resource',
        summary: 'Fetches a resource an MCP server exposes, by URI.',
        docsUrl: 'https://modelcontextprotocol.io/docs/concepts/resources',
        fields: [SERVER_OVERRIDE, f.expr('uri', 'Resource URI', { required: true, placeholder: 'file:///reports/latest.md' })],
        outputs: outs('contents:array:Contents', 'text:string', 'mimeType:string:MIME type'),
        keywords: ['mcp', 'resource', 'read', 'context'],
      },
      {
        op: 'get_prompt',
        name: 'Get a server prompt',
        summary: 'Fetches a named prompt template from an MCP server, with arguments filled in.',
        docsUrl: 'https://modelcontextprotocol.io/docs/concepts/prompts',
        fields: [
          SERVER_OVERRIDE,
          f.text('promptName', 'Prompt', { required: true }),
          f.keyValue('arguments', 'Arguments'),
        ],
        outputs: outs('messages:array:Messages', 'text:string:Rendered prompt'),
        keywords: ['mcp', 'prompt', 'template'],
      },
    ],
  ),

  // ── Generic API escapes ──────────────────────────────────────────────────
  ...native('logic', [
    {
      id: 'core.graphql',
      name: 'GraphQL request',
      summary: 'Sends a GraphQL query or mutation to any endpoint.',
      icon: 'globe',
      keywords: ['graphql', 'query', 'mutation', 'api'],
      fields: [
        f.expr('url', 'Endpoint', { required: true, placeholder: 'https://api.example.com/graphql' }),
        f.textarea('query', 'Query', { required: true, placeholder: 'query($id: ID!) { property(id: $id) { price } }' }),
        f.json('variables', 'Variables'),
        f.keyValue('headers', 'Headers'),
      ],
      outputs: outs('data:object:Data', 'errors:array:Errors', 'status:number:Status code'),
    },
    {
      id: 'core.poll',
      name: 'Wait for a condition',
      summary: 'Re-checks a URL until it returns what you are waiting for, or gives up.',
      icon: 'timer',
      keywords: ['poll', 'retry', 'until', 'wait', 'async', 'long running'],
      fields: [
        f.expr('url', 'URL', { required: true }),
        f.expr('until', 'Continue when', {
          required: true,
          placeholder: '{{poll.body.status}}',
          help: 'Checked after each attempt.',
        }),
        f.select(
          'operator',
          'Condition',
          [opt('eq', 'is equal to'), opt('neq', 'is not equal to'), opt('contains', 'contains'), opt('exists', 'has any value')],
          { required: true, defaultValue: 'eq' },
        ),
        f.expr('value', 'Compared with', { showWhen: { field: 'operator', equals: ['eq', 'neq', 'contains'] } }),
        f.duration('interval', 'Check every', { defaultValue: '30s' }),
        f.duration('giveUpAfter', 'Give up after', { defaultValue: '15m' }),
      ],
      outputs: outs('body:object:Final response', 'attempts:number:Attempts', 'timedOut:boolean:Gave up'),
    },
    {
      id: 'core.webhook_respond',
      name: 'Reply to the webhook',
      summary: 'Sends a response back to whatever called this workflow’s webhook.',
      icon: 'webhook',
      keywords: ['respond', 'reply', 'http', 'synchronous', 'callback'],
      fields: [
        f.number('status', 'Status code', { defaultValue: 200 }),
        f.json('body', 'Body'),
        f.keyValue('headers', 'Headers'),
      ],
      outputs: [],
    },
    {
      id: 'core.batch',
      name: 'Collect into batches',
      summary: 'Groups a list into fixed-size batches so a rate-limited API is called fewer times.',
      icon: 'package',
      keywords: ['batch', 'chunk', 'group', 'rate limit', 'bulk'],
      fields: [
        f.expr('items', 'List', { required: true, placeholder: '{{search.results}}' }),
        f.number('size', 'Batch size', { required: true, defaultValue: 25 }),
      ],
      outputs: outs('batches:array:Batches', 'count:number:Batch count'),
    },
    {
      id: 'core.retry',
      name: 'Retry on failure',
      summary: 'Runs the steps after it again if they fail, backing off between attempts.',
      icon: 'repeat',
      keywords: ['retry', 'backoff', 'resilience', 'error', 'transient'],
      branches: [
        { id: 'success', label: 'Succeeded' },
        { id: 'exhausted', label: 'Still failing' },
      ],
      fields: [
        f.number('maxAttempts', 'Attempts', { required: true, defaultValue: 3 }),
        f.duration('initialDelay', 'Wait before retrying', { defaultValue: '10s' }),
        f.select('backoff', 'Backoff', [opt('exponential', 'Double each time'), opt('fixed', 'Same each time')], {
          defaultValue: 'exponential',
        }),
      ],
      outputs: outs('attempts:number:Attempts used', 'lastError:string:Last error'),
    },
  ]),
];

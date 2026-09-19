/**
 * Agent tool registry for the Report Q&A agent.
 *
 * Phase 2.1 scaffolding — provides the contract that Phase 2.2 (calculators)
 * and Phase 2.3 (live-data services) will register into.
 *
 * Contract:
 *   - A tool exposes an OpenAI-style JSON-schema parameter definition.
 *   - The `execute` function runs the tool with parsed args and a context
 *     object (auth, conversationId, supabase client, etc) and returns a
 *     JSON-serialisable result.
 *   - Tool results are surfaced to the model as `role: "tool"` messages
 *     AND to the UI as `_tool` SSE events for transparency.
 */

// deno-lint-ignore-file no-explicit-any

export interface AgentToolContext {
  supabase: any;
  userId: string | null;
  conversationId: string | null;
  // Reports currently attached to the conversation, so tools can auto-extract
  // values (price, rent, postcode...) without re-asking the user.
  reportContents?: Array<{ name?: string; content?: string }>;
  reportNames?: string[];
}

export interface AgentToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
    additionalProperties?: boolean;
  };
  /**
   * Execute the tool. Throw on hard failure — the loop will surface the
   * error message to the model as the tool result so it can recover.
   */
  execute: (args: any, ctx: AgentToolContext) => Promise<any>;
}

export interface ToolInvocation {
  id: string; // matches the tool_call id from the model
  name: string;
  arguments: any;
  result?: any;
  error?: string;
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
}

// -------------------------------------------------------------------------
// Registry
// -------------------------------------------------------------------------

const REGISTRY = new Map<string, AgentToolDefinition>();

export function registerTool(tool: AgentToolDefinition): void {
  if (REGISTRY.has(tool.name)) {
    console.warn(`[agent-tools] Overwriting existing tool: ${tool.name}`);
  }
  REGISTRY.set(tool.name, tool);
}

export function listTools(): AgentToolDefinition[] {
  return Array.from(REGISTRY.values());
}

export function getTool(name: string): AgentToolDefinition | undefined {
  return REGISTRY.get(name);
}

// -------------------------------------------------------------------------
// Model-format adapters
// -------------------------------------------------------------------------

/**
 * Returns tool definitions formatted for OpenAI-style chat-completions
 * tool calling (used by OpenAI direct, Lovable AI Gateway for OpenAI and
 * Gemini models — both follow the same shape).
 */
export function getOpenAIToolDefinitions(toolNames?: string[]): any[] {
  const tools = toolNames
    ? toolNames.map((n) => REGISTRY.get(n)).filter(Boolean) as AgentToolDefinition[]
    : listTools();

  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

// -------------------------------------------------------------------------
// Executor
// -------------------------------------------------------------------------

/**
 * Execute a single tool call. Always resolves — errors are returned in the
 * invocation record so the agent loop can feed them back to the model.
 */
export async function executeToolCall(
  toolCall: { id: string; function: { name: string; arguments: string } },
  ctx: AgentToolContext,
): Promise<ToolInvocation> {
  const started = Date.now();
  const startedIso = new Date(started).toISOString();
  const name = toolCall.function?.name || 'unknown';

  let parsedArgs: any = {};
  try {
    parsedArgs = toolCall.function?.arguments
      ? JSON.parse(toolCall.function.arguments)
      : {};
  } catch (e) {
    return {
      id: toolCall.id,
      name,
      arguments: { _raw: toolCall.function?.arguments },
      error: `Invalid JSON arguments: ${(e as Error).message}`,
      started_at: startedIso,
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - started,
    };
  }

  const tool = REGISTRY.get(name);
  if (!tool) {
    return {
      id: toolCall.id,
      name,
      arguments: parsedArgs,
      error: `Unknown tool: ${name}`,
      started_at: startedIso,
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - started,
    };
  }

  try {
    const result = await tool.execute(parsedArgs, ctx);
    return {
      id: toolCall.id,
      name,
      arguments: parsedArgs,
      result,
      started_at: startedIso,
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - started,
    };
  } catch (e) {
    return {
      id: toolCall.id,
      name,
      arguments: parsedArgs,
      error: (e as Error).message || String(e),
      started_at: startedIso,
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - started,
    };
  }
}

/**
 * Format a ToolInvocation as a chat message the model can consume on the
 * next turn (OpenAI tool-message shape).
 */
export function toolInvocationToMessage(inv: ToolInvocation): {
  role: 'tool';
  tool_call_id: string;
  name: string;
  content: string;
} {
  const payload = inv.error
    ? { error: inv.error }
    : { result: inv.result };
  return {
    role: 'tool',
    tool_call_id: inv.id,
    name: inv.name,
    content: JSON.stringify(payload).slice(0, 12000), // hard cap to keep context tight
  };
}

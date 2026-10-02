/**
 * Tool use on the native Anthropic route, in the router's OpenAI vocabulary.
 *
 * Every caller of `llmRouter` speaks the OpenAI chat shape: `tools` as
 * `{ type: 'function', function: { name, description, parameters } }`, a
 * `tool_choice`, assistant turns carrying `tool_calls`, and `role: 'tool'`
 * results. The gateway, OpenRouter and native OpenAI routes take that shape as
 * it is. The native Anthropic route did not: `callAnthropicNative` was handed
 * neither `tools` nor `tool_choice`, kept only the text blocks of the answer,
 * and folded a `role: 'tool'` turn into a user turn of JSON. So an agent
 * assigned a Claude model on the native route could never call a tool — the
 * Strategy Advisor answered every brief in prose and drew no scenario cards,
 * and with the tool now REQUIRED in scenario mode, every such attempt would be
 * recorded as "required tool call missing" and passed down the chain.
 *
 * This module is the translation, both ways. The router engages it only when
 * a call carries tools or a tool turn (`needsAnthropicToolTranslation`), so a
 * call without them builds the same request and reads the same answer as
 * before, byte for byte.
 */

type ContentConverter = (content: unknown) => unknown;

/** The OpenAI-shaped message the router is handed. */
export interface RouterMessage {
  role: string;
  content: unknown;
  tool_call_id?: string;
  tool_calls?: unknown;
  name?: string;
}

export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: Array<Record<string, unknown>>;
}

export interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** Anthropic accepts `^[a-zA-Z0-9_-]+$` as a tool-use id; another route's id may not match. */
export function anthropicToolUseId(id: unknown, index: number): string {
  const cleaned = typeof id === 'string' ? id.replace(/[^a-zA-Z0-9_-]/g, '_') : '';
  return cleaned.length > 0 ? cleaned : `toolu_${index}`;
}

/** Does this call need the tool translation at all? */
export function needsAnthropicToolTranslation(
  messages: ReadonlyArray<RouterMessage>,
  tools: unknown,
): boolean {
  if (Array.isArray(tools) && tools.length > 0) return true;
  return messages.some(
    (m) => m.role === 'tool' || (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0),
  );
}

/** OpenAI function tools → Anthropic tools. Anything that is not a named function is dropped. */
export function anthropicToolsFrom(tools: unknown): AnthropicTool[] | undefined {
  if (!Array.isArray(tools)) return undefined;
  const out: AnthropicTool[] = [];
  for (const tool of tools) {
    const fn = (tool as any)?.function ?? tool;
    const name = typeof fn?.name === 'string' ? fn.name : '';
    if (!name) continue;
    const schema = fn?.parameters ?? fn?.input_schema;
    out.push({
      name,
      ...(typeof fn?.description === 'string' && fn.description ? { description: fn.description } : {}),
      input_schema: schema && typeof schema === 'object' ? schema : { type: 'object', properties: {} },
    });
  }
  return out.length > 0 ? out : undefined;
}

/**
 * OpenAI `tool_choice` → Anthropic `tool_choice`.
 * `auto` → auto, `required` → any, `none` → none, a named function → that tool.
 * Absent or unrecognised: undefined, which Anthropic reads as `auto`.
 */
export function anthropicToolChoiceFrom(choice: unknown): Record<string, unknown> | undefined {
  if (choice === 'auto') return { type: 'auto' };
  if (choice === 'required' || choice === 'any') return { type: 'any' };
  if (choice === 'none') return { type: 'none' };
  if (choice && typeof choice === 'object') {
    const c = choice as any;
    const name = c?.function?.name ?? (c?.type === 'tool' ? c?.name : undefined);
    if (typeof name === 'string' && name) return { type: 'tool', name };
    if (c?.type === 'auto' || c?.type === 'any' || c?.type === 'none') return { type: c.type };
  }
  return undefined;
}

function asBlocks(content: unknown): Array<Record<string, unknown>> {
  if (typeof content === 'string') return content.trim() ? [{ type: 'text', text: content }] : [];
  if (Array.isArray(content)) {
    return content.filter((b) => !(b?.type === 'text' && !(typeof b.text === 'string' && b.text.trim())));
  }
  if (content == null) return [];
  return [{ type: 'text', text: JSON.stringify(content) }];
}

function toolInput(args: unknown): Record<string, unknown> {
  if (args && typeof args === 'object' && !Array.isArray(args)) return args as Record<string, unknown>;
  if (typeof args === 'string' && args.trim()) {
    try {
      const parsed = JSON.parse(args);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch { /* an unparseable argument string is sent as no input */ }
  }
  return {};
}

function toolResultContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content == null) return '';
  return JSON.stringify(content);
}

/**
 * The non-system messages, as Anthropic messages.
 *
 * An assistant turn's `tool_calls` become `tool_use` blocks after its text; a
 * `role: 'tool'` turn becomes a user turn holding one `tool_result`; and
 * consecutive turns of one role are merged, because the results of one
 * assistant turn's calls must arrive together in the next user turn, ahead of
 * anything else said in it.
 */
export function anthropicMessagesFrom(
  messages: ReadonlyArray<RouterMessage>,
  convertContent: ContentConverter,
): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  let toolIndex = 0;
  // The tool_use ids of the latest assistant turn still awaiting a result. A
  // result names its call by id; where that id was lost on the way here (one
  // route mints none, a caller falls back to `call_0`), it answers the next
  // call still waiting, because Anthropic refuses a result for no call.
  let awaiting: string[] = [];
  const push = (role: 'user' | 'assistant', blocks: Array<Record<string, unknown>>) => {
    if (blocks.length === 0) return;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else out.push({ role, content: [...blocks] });
  };

  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      const named = anthropicToolUseId(m.tool_call_id, toolIndex);
      const id = awaiting.includes(named) ? named : (awaiting[0] ?? named);
      awaiting = awaiting.filter((waiting) => waiting !== id);
      push('user', [{
        type: 'tool_result',
        tool_use_id: id,
        content: toolResultContent(m.content),
      }]);
      continue;
    }
    if (m.role === 'assistant') {
      const blocks = asBlocks(convertContent(m.content));
      awaiting = [];
      if (Array.isArray(m.tool_calls)) {
        for (const call of m.tool_calls as any[]) {
          const name = call?.function?.name;
          if (typeof name !== 'string' || !name) continue;
          const id = anthropicToolUseId(call?.id, toolIndex++);
          awaiting.push(id);
          blocks.push({ type: 'tool_use', id, name, input: toolInput(call?.function?.arguments) });
        }
      }
      push('assistant', blocks);
      continue;
    }
    push('user', asBlocks(convertContent(m.content)));
  }
  return out;
}

/** An Anthropic answer as the OpenAI assistant message every caller reads. */
export function openAiMessageFromAnthropic(data: unknown): {
  role: 'assistant';
  content: string;
  tool_calls?: OpenAiToolCall[];
} {
  const blocks: any[] = Array.isArray((data as any)?.content) ? (data as any).content : [];
  const content = blocks.map((b) => (b?.type === 'text' || b?.type === undefined ? b?.text : undefined))
    .filter(Boolean).join('\n');
  const toolCalls: OpenAiToolCall[] = blocks
    .filter((b) => b?.type === 'tool_use' && typeof b?.name === 'string')
    .map((b, i) => ({
      id: typeof b.id === 'string' && b.id ? b.id : `toolu_${i}`,
      type: 'function' as const,
      function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
    }));
  return toolCalls.length > 0
    ? { role: 'assistant', content, tool_calls: toolCalls }
    : { role: 'assistant', content };
}

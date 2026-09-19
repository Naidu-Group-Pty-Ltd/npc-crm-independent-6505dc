/**
 * Minimal Anthropic Messages API adapter that accepts OpenAI-style chat
 * messages + tools and returns an OpenAI-shaped response so call-sites can
 * keep their existing `choices[0].message.tool_calls[0]` parsing.
 *
 * Supports:
 *  - system messages (concatenated into Anthropic's top-level `system`)
 *  - text + image_url content parts (image_url converted to base64 source)
 *  - one tool definition with JSON-schema parameters (mapped to input_schema)
 *  - tool_choice "required" or { type:'function', function:{ name } }
 *
 * Default model: claude-sonnet-4-5-20250929 (override via ANTHROPIC_MODEL env or arg).
 *
 * The credential arrives as a resolved `AnthropicCredential` rather than a raw
 * key string, because a deployment may reach Anthropic with a short-lived
 * federated token and on a workspace of its own — see `anthropicRoute.pure.ts`.
 */

import {
  ANTHROPIC_MESSAGES_URL,
  type AnthropicCredential,
  anthropicJsonHeaders,
} from './anthropicRoute.pure.ts';

const DEFAULT_MODEL = Deno.env.get('ANTHROPIC_MODEL') || 'claude-opus-4-8';

type Role = 'system' | 'user' | 'assistant';
interface OAMessage {
  role: Role;
  content: any; // string OR array of { type:'text'|'image_url', ... }
}

interface OATool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: any;
  };
}

interface CallArgs {
  credential: AnthropicCredential;
  model?: string;
  messages: OAMessage[];
  tools?: OATool[];
  tool_choice?: 'auto' | 'required' | { type: 'function'; function: { name: string } };
  max_tokens?: number;
}

function dataUrlToSource(dataUrl: string): { type: 'base64'; media_type: string; data: string } | null {
  const m = /^data:(image\/(?:png|jpe?g|webp|gif));base64,(.+)$/i.exec(dataUrl);
  if (!m) return null;
  return { type: 'base64', media_type: m[1].toLowerCase(), data: m[2] };
}

function convertContent(content: any): any {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content ?? '');
  const parts: any[] = [];
  for (const p of content) {
    if (p?.type === 'text') parts.push({ type: 'text', text: String(p.text ?? '') });
    else if (p?.type === 'image_url') {
      const url = typeof p.image_url === 'string' ? p.image_url : p.image_url?.url;
      const src = dataUrlToSource(String(url || ''));
      if (src) parts.push({ type: 'image', source: src });
    }
  }
  return parts.length ? parts : '';
}

export async function callAnthropic({
  credential,
  model,
  messages,
  tools,
  tool_choice,
  max_tokens = 8192,
}: CallArgs): Promise<{ ok: boolean; status: number; data?: any; errorText?: string }> {
  // Anthropic: top-level system string, then user/assistant turns only.
  const systemParts: string[] = [];
  const turns: any[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      const t = typeof m.content === 'string' ? m.content : Array.isArray(m.content)
        ? m.content.filter((c: any) => c?.type === 'text').map((c: any) => c.text).join('\n')
        : String(m.content ?? '');
      if (t.trim()) systemParts.push(t);
      continue;
    }
    turns.push({ role: m.role, content: convertContent(m.content) });
  }

  const body: any = {
    model: model || DEFAULT_MODEL,
    max_tokens,
    system: systemParts.join('\n\n'),
    messages: turns,
  };

  if (tools?.length) {
    body.tools = tools.map((t) => ({
      name: t.function.name,
      description: t.function.description || '',
      input_schema: t.function.parameters,
    }));
    if (tool_choice === 'required') {
      body.tool_choice = { type: 'any' };
    } else if (tool_choice && typeof tool_choice === 'object' && tool_choice.type === 'function') {
      body.tool_choice = { type: 'tool', name: tool_choice.function.name };
    }
  }

  const resp = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: 'POST',
    headers: anthropicJsonHeaders(credential),
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => '');
    return { ok: false, status: resp.status, errorText };
  }

  const data = await resp.json();

  // Convert Anthropic response → OpenAI-shaped { choices:[{ message:{ content, tool_calls } }] }
  const blocks: any[] = data?.content || [];
  const textBlocks = blocks.filter((b) => b?.type === 'text').map((b) => b.text).join('\n');
  const toolUses = blocks.filter((b) => b?.type === 'tool_use');
  const tool_calls = toolUses.map((t: any) => ({
    id: t.id,
    type: 'function',
    function: {
      name: t.name,
      arguments: JSON.stringify(t.input ?? {}),
    },
  }));

  const openAIShape = {
    choices: [
      {
        message: {
          role: 'assistant',
          content: textBlocks || null,
          tool_calls: tool_calls.length ? tool_calls : undefined,
        },
        finish_reason: data?.stop_reason || 'stop',
      },
    ],
    usage: data?.usage,
    model: data?.model,
  };

  return { ok: true, status: 200, data: openAIShape };
}

/**
 * claudeReconstruct.ts — Claude reconstruction adapter (wired into
 * template-design-agent).
 *
 * Drop-in for `_shared/anthropicAdapter.ts#callAnthropic` — same OpenAI-shaped
 * return — but targets Claude's latest model (`claude-opus-4-8`) and uses the
 * modern surface: native vision + native PDF documents, strict tool output
 * (schema-valid `tool_calls` by construction), a prompt-cached system prompt,
 * adaptive thinking + `effort` on the non-forced path, and opt-in SSE streaming.
 * No `temperature` (400 on Opus 4.8).
 *
 * All request/response shaping lives in `claudeReconstruct.pure.ts` (Deno-free,
 * unit-tested by vitest). This file owns only the env + fetch + stream concerns.
 */
import {
  buildAnthropicRequestBody,
  toOpenAIShape,
  type ClaudeReconstructArgs,
  type ClaudeReconstructResult,
} from './claudeReconstruct.pure.ts';
import { logApiUsage } from './logApiUsage.ts';
import { ANTHROPIC_MESSAGES_URL, anthropicJsonHeaders } from './anthropicRoute.pure.ts';
import {
  CLAUDE_RECONSTRUCT_BINDING,
  extractUsageTokens,
  resolveModelUsed,
} from './llmUsageBinding.pure.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

export type {
  ClaudeReconstructArgs,
  ClaudeReconstructResult,
  OAMessage,
  OATool,
  Effort,
} from './claudeReconstruct.pure.ts';

/** Latest model. Override per-deploy via env; falls back through the legacy var. */
export const RECONSTRUCT_MODEL =
  Deno.env.get('ANTHROPIC_RECONSTRUCT_MODEL') ||
  Deno.env.get('ANTHROPIC_MODEL') ||
  'claude-opus-4-8';

/**
 * Aggregate an Anthropic SSE stream → a single message object (same shape the
 * non-streaming endpoint returns), so callers parse it identically.
 */
async function aggregateStream(resp: Response): Promise<any> {
  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  const blocks: any[] = [];
  const toolJson: Record<number, string> = {};
  let stop_reason: string | undefined;
  let usage: any;
  let model: string | undefined;
  let buf = '';

  const handle = (evt: any) => {
    switch (evt.type) {
      case 'message_start':
        model = evt.message?.model;
        usage = evt.message?.usage;
        break;
      case 'content_block_start':
        blocks[evt.index] = { ...evt.content_block };
        if (evt.content_block?.type === 'tool_use') toolJson[evt.index] = '';
        break;
      case 'content_block_delta': {
        const d = evt.delta;
        if (d?.type === 'text_delta') blocks[evt.index].text = (blocks[evt.index].text || '') + d.text;
        else if (d?.type === 'input_json_delta') toolJson[evt.index] += d.partial_json || '';
        break;
      }
      case 'content_block_stop':
        if (toolJson[evt.index] != null && blocks[evt.index]?.type === 'tool_use') {
          try { blocks[evt.index].input = JSON.parse(toolJson[evt.index] || '{}'); } catch { blocks[evt.index].input = {}; }
        }
        break;
      case 'message_delta':
        if (evt.delta?.stop_reason) stop_reason = evt.delta.stop_reason;
        if (evt.usage) usage = { ...usage, ...evt.usage };
        break;
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const frames = buf.split('\n\n');
    buf = frames.pop() ?? '';
    for (const frame of frames) {
      const line = frame.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try { handle(JSON.parse(payload)); } catch { /* ignore keep-alives */ }
    }
  }
  return { content: blocks.filter(Boolean), stop_reason, usage, model };
}

/**
 * Build + send the claude-opus-4-8 request and return an OpenAI-shaped result
 * that is a drop-in for `callAnthropic`.
 */
/**
 * Write one `api_usage_log` row for a successful reconstruction.
 *
 * Deliberately best-effort and detached: metering is a ledger concern, and a
 * failure to record must not turn a completed reconstruction into an error the
 * user sees. `logApiUsage` already swallows its own failures; the try/catch
 * here covers the client construction above it.
 */
async function meterReconstructCall(data: unknown, responseMs: number, requestedModel: string): Promise<void> {
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) return;
    const tokens = extractUsageTokens(data);
    await logApiUsage(createClient(url, key), {
      service_name: CLAUDE_RECONSTRUCT_BINDING.serviceName,
      endpoint: '/v1/messages',
      model_used: resolveModelUsed(data, requestedModel),
      prompt_tokens: tokens?.promptTokens ?? 0,
      completion_tokens: tokens?.completionTokens ?? 0,
      tokens_used: tokens?.totalTokens ?? 0,
      response_time_ms: responseMs,
      status: 'success',
      // The exact credential beats the derived one — see logApiUsage's header.
      metadata: { secret_name: CLAUDE_RECONSTRUCT_BINDING.secretName, source: 'claudeReconstruct' },
    });
  } catch (e) {
    console.warn('[claudeReconstruct] usage metering failed (non-fatal)', e);
  }
}

export async function callClaudeReconstruct(args: ClaudeReconstructArgs): Promise<ClaudeReconstructResult> {
  const startedAt = Date.now();
  const { body } = buildAnthropicRequestBody(args, RECONSTRUCT_MODEL);
  if (args.stream) body.stream = true;

  let resp: Response;
  const controller = args.timeoutMs ? new AbortController() : undefined;
  const timer = controller ? setTimeout(() => controller.abort(), args.timeoutMs) : undefined;
  try {
    resp = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers: anthropicJsonHeaders(args.credential),
      body: JSON.stringify(body),
      signal: controller?.signal,
    });
  } catch (e) {
    return { ok: false, status: 504, errorText: `claudeReconstruct fetch failed: ${String(e)}` };
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => '');
    return { ok: false, status: resp.status, errorText };
  }

  const message = args.stream ? await aggregateStream(resp) : await resp.json();
  const data = toOpenAIShape(message);
  // BILLING. This adapter never goes through `llmRouter`, so router-side
  // metering does not cover it — and it is the Template Builder's entire
  // reconstruction path. Every call here spends ANTHROPIC_API_KEY, which in a
  // Mission-Control-provisioned workspace is the prime's key: unlogged, the
  // tenant is never recharged. Fire-and-forget by contract (`logApiUsage`
  // swallows its own errors); a metering failure must never fail a render.
  void meterReconstructCall(data, Date.now() - startedAt, args.model ?? RECONSTRUCT_MODEL);
  return { ok: true, status: 200, data };
}

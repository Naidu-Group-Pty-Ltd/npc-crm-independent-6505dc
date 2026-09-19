/**
 * Multi-turn streaming agent loop for the Report Q&A agent.
 *
 * Wraps a chat-completions call (OpenAI-compatible: OpenAI direct, Gemini
 * via Lovable AI Gateway, GPT-5.2 via Lovable AI Gateway) and:
 *
 *   1. Streams assistant tokens straight through to the client SSE stream
 *   2. Accumulates any `delta.tool_calls` emitted during the stream
 *   3. When the upstream `finish_reason === "tool_calls"`, executes each
 *      tool via the shared registry
 *   4. Emits `data: {"_tool": <invocation>}` SSE frames so the UI can
 *      render a transparency chip in real time
 *   5. Appends the assistant tool-call message and `role: "tool"` results
 *      to the message history, then re-issues the request
 *   6. Repeats until the model returns plain text or MAX_TURNS reached
 *
 * Returns a ReadableStream<Uint8Array> ready to be piped to the client.
 * Perplexity is NOT supported here (no reliable function calling) — the
 * caller must guard against that before invoking.
 */

// deno-lint-ignore-file no-explicit-any

import {
  type AgentToolContext,
  type ToolInvocation,
  executeToolCall,
  getOpenAIToolDefinitions,
  toolInvocationToMessage,
  listTools,
} from './agent-tools.ts';

export type AgentLoopProvider = 'openai-direct' | 'gemini' | 'openai-gateway';

export interface RunAgentLoopOptions {
  provider: AgentLoopProvider;
  apiKey: string;
  endpoint: string;
  extraHeaders?: Record<string, string>;
  model: string;
  messages: any[];
  maxCompletionTokensField: 'max_tokens' | 'max_completion_tokens';
  maxCompletionTokens: number;
  toolContext: AgentToolContext;
  /** Optional allow-list of tool names; defaults to entire registry. */
  enabledTools?: string[];
  /** Hard cap on tool-call rounds to bound cost/latency. */
  maxTurns?: number;
  /** Emitted at the very start of the stream, before any tokens. */
  leadingMetaEvent?: Record<string, any>;
  /** Called once when the full conversation is complete (success or error). */
  onComplete?: (summary: {
    finalText: string;
    toolInvocations: ToolInvocation[];
    turns: number;
  }) => void | Promise<void>;
}

const DEFAULT_MAX_TURNS = 5;

const encoder = new TextEncoder();

function sseEvent(payload: any): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

interface ParsedDelta {
  contentDelta?: string;
  toolCallDeltas?: Array<{
    index: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }>;
  finishReason?: string;
}

function parseStreamLine(jsonStr: string): ParsedDelta | null {
  try {
    const parsed = JSON.parse(jsonStr);
    const choice = parsed.choices?.[0];
    if (!choice) return null;
    return {
      contentDelta: choice.delta?.content,
      toolCallDeltas: choice.delta?.tool_calls,
      finishReason: choice.finish_reason || undefined,
    };
  } catch {
    return null;
  }
}

interface AccumulatedToolCall {
  id: string;
  function: { name: string; arguments: string };
}

/**
 * Read one upstream SSE stream, forward content tokens to the output
 * controller, and accumulate any tool_calls. Returns the assembled
 * assistant message (text + tool_calls) plus the finish_reason.
 */
async function pumpUpstreamStream(
  upstreamBody: ReadableStream<Uint8Array>,
  outController: ReadableStreamDefaultController<Uint8Array>,
  forwardTokens: boolean,
): Promise<{
  textContent: string;
  toolCalls: AccumulatedToolCall[];
  finishReason: string | null;
}> {
  const reader = upstreamBody.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let textContent = '';
  const toolCallMap = new Map<number, AccumulatedToolCall>();
  let finishReason: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      let line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (!line.startsWith('data: ')) continue;

      const jsonStr = line.slice(6).trim();
      if (jsonStr === '[DONE]') {
        return { textContent, toolCalls: Array.from(toolCallMap.values()), finishReason };
      }

      const delta = parseStreamLine(jsonStr);
      if (!delta) continue;

      if (delta.contentDelta) {
        textContent += delta.contentDelta;
        if (forwardTokens) {
          // Re-emit a clean OpenAI-style delta frame the existing UI parser
          // already understands.
          outController.enqueue(
            sseEvent({ choices: [{ delta: { content: delta.contentDelta } }] }),
          );
        }
      }

      if (delta.toolCallDeltas && Array.isArray(delta.toolCallDeltas)) {
        for (const tcd of delta.toolCallDeltas) {
          const idx = tcd.index ?? 0;
          const existing = toolCallMap.get(idx) || {
            id: '',
            function: { name: '', arguments: '' },
          };
          if (tcd.id) existing.id = tcd.id;
          if (tcd.function?.name) existing.function.name += tcd.function.name;
          if (tcd.function?.arguments) existing.function.arguments += tcd.function.arguments;
          toolCallMap.set(idx, existing);
        }
      }

      if (delta.finishReason) finishReason = delta.finishReason;
    }
  }

  return { textContent, toolCalls: Array.from(toolCallMap.values()), finishReason };
}

export function runAgentLoop(opts: RunAgentLoopOptions): ReadableStream<Uint8Array> {
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;
  const allInvocations: ToolInvocation[] = [];
  let workingMessages = [...opts.messages];

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (opts.leadingMetaEvent) {
          controller.enqueue(sseEvent(opts.leadingMetaEvent));
        }

        const tools = getOpenAIToolDefinitions(opts.enabledTools);
        const hasTools = tools.length > 0;

        let finalText = '';
        let turn = 0;

        while (turn < maxTurns) {
          turn++;

          const body: Record<string, any> = {
            model: opts.model,
            messages: workingMessages,
            stream: true,
            stream_options: { include_usage: true },
            [opts.maxCompletionTokensField]: opts.maxCompletionTokens,
          };
          if (hasTools) {
            body.tools = tools;
            body.tool_choice = 'auto';
          }

          const upstream = await fetch(opts.endpoint, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${opts.apiKey}`,
              'Content-Type': 'application/json',
              ...(opts.extraHeaders ?? {}),
            },
            body: JSON.stringify(body),
          });

          if (!upstream.ok || !upstream.body) {
            const errText = await upstream.text().catch(() => '');
            console.error(
              `[agent-loop] Upstream error (turn ${turn}, status ${upstream.status}): ${errText.slice(0, 400)}`,
            );
            controller.enqueue(
              sseEvent({
                _error: {
                  status: upstream.status,
                  message: 'Upstream model error',
                },
              }),
            );
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
            await opts.onComplete?.({
              finalText,
              toolInvocations: allInvocations,
              turns: turn,
            });
            return;
          }

          const { textContent, toolCalls, finishReason } = await pumpUpstreamStream(
            upstream.body,
            controller,
            /* forwardTokens */ true,
          );

          finalText += textContent;

          // If no tool calls were made, we're done.
          if (!toolCalls.length || finishReason !== 'tool_calls') {
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
            await opts.onComplete?.({
              finalText,
              toolInvocations: allInvocations,
              turns: turn,
            });
            return;
          }

          // Append the assistant message that requested the tool calls.
          workingMessages.push({
            role: 'assistant',
            content: textContent || null,
            tool_calls: toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function',
              function: { name: tc.function.name, arguments: tc.function.arguments },
            })),
          });

          // Execute tools in parallel, emit SSE events as each starts/finishes.
          const invocations = await Promise.all(
            toolCalls.map(async (tc) => {
              controller.enqueue(
                sseEvent({
                  _tool: {
                    phase: 'started',
                    id: tc.id,
                    name: tc.function.name,
                    arguments_raw: tc.function.arguments,
                  },
                }),
              );
              const inv = await executeToolCall(tc, opts.toolContext);
              controller.enqueue(sseEvent({ _tool: { phase: 'completed', ...inv } }));
              return inv;
            }),
          );

          allInvocations.push(...invocations);

          // Append tool results so the model can use them next turn.
          for (const inv of invocations) {
            workingMessages.push(toolInvocationToMessage(inv));
          }

          // Loop and call the model again.
        }

        // Hit max turns — emit a notice and close.
        controller.enqueue(
          sseEvent({
            _error: {
              status: 'max_turns_exceeded',
              message: `Agent stopped after ${maxTurns} tool-call rounds.`,
            },
          }),
        );
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
        await opts.onComplete?.({
          finalText,
          toolInvocations: allInvocations,
          turns: turn,
        });
      } catch (err) {
        console.error('[agent-loop] Fatal loop error:', err);
        try {
          controller.enqueue(
            sseEvent({
              _error: {
                status: 'loop_exception',
                message: (err as Error).message || 'Unknown error',
              },
            }),
          );
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch {
          /* already closed */
        }
        await opts.onComplete?.({
          finalText: '',
          toolInvocations: allInvocations,
          turns: 0,
        });
      }
    },
  });
}

/** Convenience: are any tools currently registered? */
export function agentLoopHasTools(enabledTools?: string[]): boolean {
  if (enabledTools) {
    return enabledTools.some((n) => listTools().some((t) => t.name === n));
  }
  return listTools().length > 0;
}

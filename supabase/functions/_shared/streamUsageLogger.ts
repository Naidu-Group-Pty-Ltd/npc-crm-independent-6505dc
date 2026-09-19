/**
 * Stream Usage Logger
 * Intercepts SSE streams to extract token usage from the final chunk,
 * then logs it via logApiUsage. The stream is forwarded to the client unchanged.
 */

import { logApiUsage, estimateCost } from './logApiUsage.ts';

interface StreamLogOptions {
  supabase: any;
  serviceName: string;
  modelUsed: string;
  userId?: string;
  metadata?: Record<string, any>;
}

/**
 * Wraps an SSE ReadableStream, intercepts chunks to find usage data
 * in the final SSE message, and logs token counts + cost.
 * Returns a new ReadableStream that can be sent to the client.
 */
export function createUsageTrackingStream(
  originalStream: ReadableStream<Uint8Array>,
  options: StreamLogOptions
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let buffer = '';
  let usageData: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null = null;

  const transformStream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      // Forward chunk to client immediately
      controller.enqueue(chunk);

      // Also parse for usage data
      buffer += decoder.decode(chunk, { stream: true });

      // Process complete SSE lines
      const lines = buffer.split('\n');
      // Keep the last potentially incomplete line in the buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          // OpenAI/compatible APIs include usage in the final chunk
          if (parsed.usage) {
            usageData = {
              prompt_tokens: parsed.usage.prompt_tokens || 0,
              completion_tokens: parsed.usage.completion_tokens || 0,
              total_tokens: parsed.usage.total_tokens || 0,
            };
          }
          // Some providers put it under x_groq or other keys
          if (parsed.x_groq?.usage) {
            usageData = {
              prompt_tokens: parsed.x_groq.usage.prompt_tokens || 0,
              completion_tokens: parsed.x_groq.usage.completion_tokens || 0,
              total_tokens: parsed.x_groq.usage.total_tokens || 0,
            };
          }
        } catch {
          // Not valid JSON, skip
        }
      }
    },

    flush(_controller) {
      // Process any remaining buffer
      if (buffer.trim()) {
        const lines = buffer.split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.usage) {
              usageData = {
                prompt_tokens: parsed.usage.prompt_tokens || 0,
                completion_tokens: parsed.usage.completion_tokens || 0,
                total_tokens: parsed.usage.total_tokens || 0,
              };
            }
          } catch { /* skip */ }
        }
      }

      // Log the usage (fire-and-forget)
      const promptTokens = usageData?.prompt_tokens || 0;
      const completionTokens = usageData?.completion_tokens || 0;
      const totalTokens = usageData?.total_tokens || (promptTokens + completionTokens);
      const cost = estimateCost(options.modelUsed, promptTokens, completionTokens);

      logApiUsage(options.supabase, {
        service_name: options.serviceName,
        endpoint: '/v1/chat/completions',
        model_used: options.modelUsed,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        tokens_used: totalTokens,
        cost_estimate_usd: cost > 0 ? cost : undefined,
        status: 'success',
        user_id: options.userId,
        metadata: {
          ...options.metadata,
          streaming: true,
          usage_captured: usageData !== null,
        },
      }).catch((err) => {
        console.warn('[streamUsageLogger] Failed to log:', err);
      });
    },
  });

  return originalStream.pipeThrough(transformStream);
}

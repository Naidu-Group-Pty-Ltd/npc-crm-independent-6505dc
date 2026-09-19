// Token-aware context budgeter for chat messages.
//
// Rough char→token heuristic (≈4 chars/token for English). Good enough for
// budgeting — the upstream provider does the real tokenisation.
//
// Slots are prioritised (highest first):
//   1. system head     — preamble + role definition (must keep, never trimmed)
//   2. final user msg  — the current question (must keep)
//   3. system context  — RAG / summary block appended to system prompt
//   4. recent history  — drop oldest message-pairs first
//
// When the assembled messages exceed `maxInputTokens`, we drop oldest history
// pairs, then progressively truncate the system context tail.

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function totalMessageTokens(messages: Array<{ role: string; content: string }>): number {
  // ~4 tokens/message overhead (role, separators) — OpenAI's published rule of thumb.
  return messages.reduce((sum, m) => sum + estimateTokens(m.content || '') + 4, 0);
}

export interface BudgetResult {
  messages: Array<{ role: string; content: string }>;
  trimmed: { historyDropped: number; systemTruncatedChars: number };
  estimatedTokens: number;
}

/**
 * Per-model input-token caps. Reserve ~8k for completion.
 */
export function inputBudgetForModel(model: string): number {
  const m = (model || '').toLowerCase();
  // Gemini 2.5/3.x — 1M context. Cap to 200k to keep prompts affordable.
  if (m.includes('gemini')) return 200_000;
  // GPT-5.x — 400k context.
  if (m.includes('gpt-5')) return 200_000;
  // GPT-4.1 — 1M context, cap 200k.
  if (m.includes('gpt-4.1')) return 200_000;
  // Perplexity llama-3.1-sonar-large-128k
  if (m.includes('sonar') || m.includes('perplexity')) return 100_000;
  // Conservative default.
  return 120_000;
}

/**
 * Trim a chat-completions `messages` array down to `maxInputTokens`.
 *
 * - The first message (system) is preserved but its tail may be truncated.
 * - The last message (assumed user) is always preserved in full.
 * - Intermediate history is dropped in oldest-first pairs (user+assistant).
 */
export function fitMessagesToBudget(
  messages: Array<{ role: string; content: string }>,
  maxInputTokens: number,
  options: { systemContextSeparator?: string } = {}
): BudgetResult {
  if (messages.length === 0) {
    return { messages: [], trimmed: { historyDropped: 0, systemTruncatedChars: 0 }, estimatedTokens: 0 };
  }

  // Work on a shallow copy so caller's array is untouched.
  const work = messages.map(m => ({ ...m }));
  let historyDropped = 0;
  let systemTruncatedChars = 0;

  let tokens = totalMessageTokens(work);
  if (tokens <= maxInputTokens) {
    return { messages: work, trimmed: { historyDropped, systemTruncatedChars }, estimatedTokens: tokens };
  }

  // Step 1: drop oldest history (everything between system[0] and last user).
  while (tokens > maxInputTokens && work.length > 2) {
    // Drop oldest non-system message
    work.splice(1, 1);
    historyDropped++;
    tokens = totalMessageTokens(work);
  }
  if (tokens <= maxInputTokens) {
    return { messages: work, trimmed: { historyDropped, systemTruncatedChars }, estimatedTokens: tokens };
  }

  // Step 2: truncate system prompt tail. Keep the head (role definition).
  const sep = options.systemContextSeparator || '\n\n## ';
  const sys = work[0];
  if (sys && sys.role === 'system' && sys.content) {
    const overage = tokens - maxInputTokens;
    // Translate token overage back to chars (×4 + small safety margin).
    let cutChars = overage * 4 + 200;
    const headIdx = sys.content.indexOf(sep);
    const minKeep = headIdx > 0 ? headIdx : Math.min(2000, sys.content.length);
    const maxCut = Math.max(0, sys.content.length - minKeep);
    cutChars = Math.min(cutChars, maxCut);
    if (cutChars > 0) {
      systemTruncatedChars = cutChars;
      sys.content = sys.content.slice(0, sys.content.length - cutChars)
        + '\n\n[... earlier context truncated to fit model context window. Ask for specifics if needed.]';
      tokens = totalMessageTokens(work);
    }
  }

  return { messages: work, trimmed: { historyDropped, systemTruncatedChars }, estimatedTokens: tokens };
}

/**
 * Proposing a binding by asking, with the scorer as the fallback.
 *
 * `binding.pure.ts › proposeBinding` matches on shared words. That is exactly
 * right for one of our own reports read back — after the chapter list was
 * fixed, a Borrowing Capacity Snapshot binds its three chapters at 88, 96 and
 * 91 without any model at all — and it is not enough for a stranger's template,
 * where "Serviceability Assessment" has to reach "How the capacity is built".
 * Those share no word. The scorer scores zero and the chapter goes unfilled
 * while the section goes to the appendix, which is a safe answer and a poor one.
 *
 * So: ask, then fall back. The model's answer is not trusted — it goes through
 * `readBindingPlan`, the same reader that validates a plan a person edited in
 * the browser, which re-checks every index against the structure and enforces
 * one-to-one. On any failure at all the scorer's answer is used and the screen
 * says which one it got.
 *
 * The prompt and the schema are in the pure module beside the reader; this file
 * is the fetch.
 */
import {
  BINDING_JSON_SCHEMA,
  bindingPrompt,
  FORMAT_CHAPTERS,
  formatName,
  isPassthroughFormat,
  proposeBinding,
  readBindingPlan,
  type BindingPlan,
} from './binding.pure.ts';
import type { ReportArchetypeId } from '../../reportDesign/structure.pure.ts';
import type { ExtractedStructure } from './structure.pure.ts';
import type { BindingSource } from './route.pure.ts';

import {
  ANTHROPIC_MESSAGES_URL,
  type AnthropicCredential,
  anthropicJsonHeaders,
} from '../../anthropicRoute.pure.ts';

export const BINDING_MODEL = Deno.env.get('ANTHROPIC_MODEL') || 'claude-opus-4-8';

/** A list of titles and 200-character previews. This is plenty. */
export const BINDING_TIMEOUT_MS = 60_000;

export interface ProposedBinding {
  plan: BindingPlan;
  source: BindingSource;
  /** Why the scorer was used, when it was. Empty when the model answered. */
  note: string;
}

/**
 * Propose a binding, preferring the model.
 *
 * Never throws and never returns without a plan. The fallback is not an error
 * path bolted on — it is the same function the converter shipped with, and it
 * is a correct answer.
 */
export async function proposeBindingWithModel(
  credential: AnthropicCredential | null | undefined,
  format: ReportArchetypeId,
  structure: ExtractedStructure,
): Promise<ProposedBinding> {
  const scored = proposeBinding(format, structure);
  const chapters = FORMAT_CHAPTERS[format] ?? [];
  // A pass-through format's chapters are the template's own sections, so the
  // binding is the identity and there is no judgement to buy. Said out loud
  // rather than left to fall through the empty-chapters guard below, which
  // would reach the same plan and label it a wording match.
  if (isPassthroughFormat(format)) {
    return { plan: scored, source: 'scorer', note: 'this format takes its chapters from the template' };
  }
  if (!credential) {
    return { plan: scored, source: 'scorer', note: 'matched on wording — no model is configured' };
  }
  if (!chapters.length || !structure.sections.length) return { plan: scored, source: 'scorer', note: '' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BINDING_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers: anthropicJsonHeaders(credential),
      body: JSON.stringify({
        model: BINDING_MODEL,
        max_tokens: 2_000,
        tools: [{
          name: 'binding',
          description: 'Which section of the template plays each chapter.',
          input_schema: BINDING_JSON_SCHEMA,
        }],
        tool_choice: { type: 'tool', name: 'binding' },
        messages: [{
          role: 'user',
          content: bindingPrompt(formatName(format), chapters, structure.sections),
        }],
      }),
      signal: controller.signal,
    });
  } catch (e) {
    return { plan: scored, source: 'scorer', note: `matched on wording — the model did not answer (${String(e).slice(0, 120)})` };
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    return { plan: scored, source: 'scorer', note: `matched on wording — the model refused (${response.status})` };
  }

  const message = await response.json().catch(() => null) as
    | { content?: Array<{ type?: string; name?: string; input?: unknown }> }
    | null;
  const tool = (Array.isArray(message?.content) ? message!.content : [])
    .find((b) => b?.type === 'tool_use' && b?.name === 'binding');
  if (!tool?.input || typeof tool.input !== 'object') {
    return { plan: scored, source: 'scorer', note: 'matched on wording — the model proposed nothing' };
  }

  // The same reader a browser-edited plan goes through. An answer that names a
  // section twice, or an index the structure does not have, is degraded here
  // rather than rejected — the chapter simply ends up unbound, which the
  // document already handles.
  const plan = readBindingPlan(tool.input, format, structure);

  // An answer that bound nothing is not better than the scorer's, and the
  // scorer's is free. This is the one case where a syntactically valid model
  // answer is discarded.
  const bound = plan.bindings.filter((b) => b.sectionIndex !== null).length;
  const scoredBound = scored.bindings.filter((b) => b.sectionIndex !== null).length;
  if (bound === 0 && scoredBound > 0) {
    return { plan: scored, source: 'scorer', note: 'matched on wording — the model bound nothing' };
  }

  return { plan, source: 'model', note: '' };
}

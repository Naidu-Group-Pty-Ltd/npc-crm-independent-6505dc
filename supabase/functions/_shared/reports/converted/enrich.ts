/**
 * Enrichment, the part that talks to Anthropic.
 *
 * Everything decidable is next door in `enrich.pure.ts` — the vocabulary, the
 * schema, the prompts, the reader, the quota — and `faithfulness.pure.ts` holds
 * the figure check. This file owns the fetch, the concurrency and the one
 * retry, and nothing else. That split is what lets the guards be tested by
 * handing them bad blocks rather than by mocking an API.
 *
 * ## It cannot fail the render
 *
 * Every failure path here — no key, a timeout, a refusal, a guard rejecting
 * twice, zero blocks — resolves to *that chapter having no entry* in the
 * returned map, and `render.pure.ts` renders a chapter with no entry exactly as
 * the converter always did. So the worst outcome of this whole module going
 * wrong is the output the converter produced before it existed. Nothing here
 * throws, and `enrichChapters` has no rejection path.
 *
 * ## Why chapters are enriched separately
 *
 * One call per chapter, not one per document. A chapter is the unit a person
 * confirms on the review screen, it is the unit the page budget is costed in,
 * and — the reason that actually decides it — a single document-wide call
 * fails as a single document-wide unit. Six chapters means six independent
 * chances to succeed, and a run where five chapters designed and one fell back
 * to prose is a good outcome rather than a wasted eleven seconds.
 */
import {
  checkQuota,
  dropRedundantLede,
  ENRICHMENT_JSON_SCHEMA,
  enrichedText,
  enrichmentPrompt,
  enrichmentRetryPrompt,
  parseEnrichment,
  partitionForEnrichment,
  tooShortNote,
  FIDELITY_RULE_FOR,
  FIGURE_RULE,
  type ConversionFidelity,
  type EnrichedBlock,
} from './enrich.pure.ts';
import { checkFaithful } from './faithfulness.pure.ts';
import {
  COMPOSE_JSON_SCHEMA,
  composePrompt,
  composedIsDesigned,
  htmlText,
  MAX_SHEETS,
  sanitiseComposedHtml,
} from './composeHtml.pure.ts';


import {
  ANTHROPIC_MESSAGES_URL,
  type AnthropicCredential,
  anthropicJsonHeaders,
} from '../../anthropicRoute.pure.ts';

/** The repo-wide standard. Overridable per deploy, as everywhere else. */
export const ENRICHMENT_MODEL = Deno.env.get('ANTHROPIC_MODEL') || 'claude-opus-4-8';

/** One chapter is a page or two of Markdown; this is generous for that. */
export const ENRICHMENT_TIMEOUT_MS = 120_000;

/**
 * How many chapters are in flight at once.
 *
 * Four rather than "all of them": a Borrowing Capacity draft has three to nine
 * chapters and firing nine concurrent Opus calls is how a tenant discovers
 * their rate limit during a conversion. Four keeps a six-chapter document to
 * two rounds.
 */
export const ENRICHMENT_CONCURRENCY = 4;

export interface ChapterToEnrich {
  /** `PlannedConvertedChapter.id`. The key the render path looks up. */
  id: string;
  title: string;
  markdown: string;
}

export interface ChapterEnrichment {
  id: string;
  blocks: EnrichedBlock[];
  /** Composed sheets, when the chapter was asked for pages rather than blocks. */
  sheets?: string[];
  /** Empty when the chapter enriched cleanly on the first attempt. */
  notes: string[];
  attempts: number;
}

export interface EnrichmentRun {
  /** Only the chapters that produced blocks. */
  enriched: Record<string, EnrichedBlock[]>;
  /**
   * Composed sheets by chapter id, when `compose` was asked for.
   *
   * A chapter appears in exactly one of `enriched` and `composed`, or in
   * neither — in which case it renders as flat Markdown, as it always has.
   */
  composed: Record<string, string[]>;
  /** Every note from every chapter, prefixed with the chapter's title. */
  notes: string[];
  /** Null when nothing was attempted — no key, or nothing to enrich. */
  model: string | null;
  chaptersAttempted: number;
  chaptersEnriched: number;
}

interface ToolAnswer {
  ok: boolean;
  raw?: unknown;
  error?: string;
}

/**
 * One forced tool call.
 *
 * `tool_choice` rather than "please return JSON": the schema is enforced by the
 * API, so a missing brace is not a class of failure that reaches the reader at
 * all. Same shape as `generate-brand-design-system`, deliberately — there are
 * now two model calls in this feature and they should fail identically.
 */
async function askForBlocks(
  credential: AnthropicCredential,
  prompt: string,
  tool: { name: string; description: string; schema: unknown } = {
    name: 'chapter_blocks',
    description: 'The chapter, laid out as designed blocks.',
    schema: ENRICHMENT_JSON_SCHEMA,
  },
): Promise<ToolAnswer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ENRICHMENT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers: anthropicJsonHeaders(credential),
      body: JSON.stringify({
        model: ENRICHMENT_MODEL,
        max_tokens: 8_000,
        tools: [{
          name: tool.name,
          description: tool.description,
          input_schema: tool.schema,
        }],
        tool_choice: { type: 'tool', name: tool.name },
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });
  } catch (e) {
    return { ok: false, error: `the design service did not answer: ${String(e)}` };
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return { ok: false, error: `the design service refused (${response.status}): ${detail.slice(0, 200)}` };
  }

  const message = await response.json().catch(() => null) as
    | { content?: Array<{ type?: string; name?: string; input?: unknown }> }
    | null;
  const used = (Array.isArray(message?.content) ? message!.content : [])
    .find((b) => b?.type === 'tool_use' && b?.name === tool.name);
  if (used?.input && typeof used.input === 'object') return { ok: true, raw: used.input };
  return { ok: false, error: 'the design service returned no blocks' };
}

/**
 * Enrich one chapter, with at most one retry.
 *
 * The two guards run in the same place and in this order, because they answer
 * different questions and the expensive one should not run on output that
 * already lost. Faithfulness asks *is this true* — a chapter that invents a
 * figure is discarded whatever else it did. The quota asks *is this designed* —
 * a chapter of nothing but prose is honest and useless.
 */
async function enrichChapter(
  credential: AnthropicCredential,
  chapter: ChapterToEnrich,
  fidelity: ConversionFidelity,
): Promise<ChapterEnrichment> {
  const notes: string[] = [];
  let prompt = enrichmentPrompt(chapter.title, chapter.markdown, fidelity);

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const answer = await askForBlocks(credential, prompt);
    if (!answer.ok) {
      notes.push(answer.error ?? 'the design service failed');
      return { id: chapter.id, blocks: [], notes, attempts: attempt };
    }

    const { blocks: read, notes: readNotes } = parseEnrichment(answer.raw);
    notes.push(...readNotes);
    // Done here rather than in the reader because the reader is handed one
    // chapter's blocks and knows nothing about the header printed above them.
    const blocks = dropRedundantLede(read, chapter.title);
    if (!blocks.length) {
      if (attempt === 2) return { id: chapter.id, blocks: [], notes, attempts: attempt };
      prompt = enrichmentRetryPrompt(
        chapter.title, chapter.markdown, fidelity, 'it produced no usable blocks',
      );
      continue;
    }

    const faithful = checkFaithful(chapter.markdown, enrichedText(blocks));
    if (!faithful.ok) {
      notes.push(`rejected: ${faithful.reason}`);
      if (attempt === 2) return { id: chapter.id, blocks: [], notes, attempts: attempt };
      prompt = enrichmentRetryPrompt(chapter.title, chapter.markdown, fidelity, faithful.reason);
      continue;
    }

    const quota = checkQuota(chapter.markdown, blocks);
    if (!quota.ok) {
      notes.push(`rejected: ${quota.reason}`);
      if (attempt === 2) return { id: chapter.id, blocks: [], notes, attempts: attempt };
      prompt = enrichmentRetryPrompt(chapter.title, chapter.markdown, fidelity, quota.reason);
      continue;
    }

    if (quota.reason) notes.push(quota.reason);
    return { id: chapter.id, blocks, notes, attempts: attempt };
  }

  return { id: chapter.id, blocks: [], notes, attempts: 2 };
}

/**
 * Compose one chapter as pages.
 *
 * The same shape as `enrichChapter` and the same guards, over a different
 * output. Two differences worth stating:
 *
 * **The sanitiser runs before anything else looks at the answer.** Faithfulness
 * and the quota both read the *sanitised* markup, so neither can be satisfied
 * by something that will not survive to the page.
 *
 * **The figure check is stronger here than for blocks.** `enrichedText` is a
 * switch somebody has to remember to extend; `htmlText` is by construction
 * every word that reaches the page.
 */
async function composeChapter(
  credential: AnthropicCredential,
  chapter: ChapterToEnrich,
  fidelity: ConversionFidelity,
): Promise<ChapterEnrichment> {
  const notes: string[] = [];
  const base = composePrompt(
    chapter.title, chapter.markdown, FIDELITY_RULE_FOR(fidelity), FIGURE_RULE,
  );
  let prompt = base;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const answer = await askForBlocks(credential, prompt, {
      name: 'chapter_sheets',
      description: 'The chapter, composed as printed pages.',
      schema: COMPOSE_JSON_SCHEMA,
    });
    if (!answer.ok) {
      notes.push(answer.error ?? 'the design service failed');
      return { id: chapter.id, blocks: [], notes, attempts: attempt };
    }

    const raw = (answer.raw ?? {}) as { sheets?: Array<{ html?: unknown }> };
    const dropped = new Set<string>();
    const sheets = (Array.isArray(raw.sheets) ? raw.sheets : [])
      .slice(0, MAX_SHEETS)
      .map((s) => {
        const clean = sanitiseComposedHtml(s?.html);
        for (const d of clean.dropped) dropped.add(d);
        return clean.html;
      })
      .filter((html) => html.trim());

    if (dropped.size) {
      // Reported rather than fatal. A model that reached for a Tailwind class
      // has still composed the page correctly underneath it.
      notes.push(`stripped from the composition: ${[...dropped].slice(0, 12).join(', ')}`);
    }

    const retry = (why: string): string =>
      `${base}\n\nYour previous answer was rejected because ${why}. Correct it and return the whole chapter again.`;

    if (!sheets.length) {
      if (attempt === 2) return { id: chapter.id, blocks: [], notes, attempts: attempt };
      prompt = retry('it produced no usable pages');
      continue;
    }

    const all = sheets.join('\n');
    const faithful = checkFaithful(chapter.markdown, htmlText(all));
    if (!faithful.ok) {
      notes.push(`rejected: ${faithful.reason}`);
      if (attempt === 2) return { id: chapter.id, blocks: [], notes, attempts: attempt };
      prompt = retry(faithful.reason);
      continue;
    }

    if (!sheets.some(composedIsDesigned)) {
      // The composed equivalent of the content quota: a page of nothing but
      // paragraphs is exactly the flat output this replaces.
      const why = 'no page used a design-system component — it came back as plain paragraphs';
      notes.push(`rejected: ${why}`);
      if (attempt === 2) return { id: chapter.id, blocks: [], notes, attempts: attempt };
      prompt = retry(why);
      continue;
    }

    return { id: chapter.id, blocks: [], sheets, notes, attempts: attempt };
  }

  return { id: chapter.id, blocks: [], notes, attempts: 2 };
}

/**
 * Enrich every chapter that has content, `ENRICHMENT_CONCURRENCY` at a time.
 *
 * Never throws. A chapter that ends with no blocks simply has no entry in
 * `enriched`, which the render path reads as "print this one as Markdown".
 */
export async function enrichChapters(
  credential: AnthropicCredential | null | undefined,
  chapters: readonly ChapterToEnrich[],
  fidelity: ConversionFidelity,
  /** Ask for composed pages instead of typed blocks. See `composeHtml.pure.ts`. */
  compose = false,
): Promise<EnrichmentRun> {
  // Chapters worth asking about, and the ones that are too small to be worth
  // eleven seconds. `skipped` is reported rather than silently dropped: a
  // person looking at "4 of 6 designed" deserves to know the other two were not
  // attempted rather than assume they failed.
  const { work, skipped } = partitionForEnrichment(chapters);

  if (!credential || !work.length) {
    return {
      enriched: {},
      composed: {},
      notes: credential
        ? skipped.map(tooShortNote)
        : ['ANTHROPIC_API_KEY is not configured, so no chapter was designed'],
      model: null,
      chaptersAttempted: 0,
      chaptersEnriched: 0,
    };
  }

  const results: ChapterEnrichment[] = [];
  for (let i = 0; i < work.length; i += ENRICHMENT_CONCURRENCY) {
    const batch = work.slice(i, i + ENRICHMENT_CONCURRENCY);
    const done = await Promise.all(batch.map(async (c) => {
      try {
        return compose
          ? await composeChapter(credential, c, fidelity)
          : await enrichChapter(credential, c, fidelity);
      } catch (e) {
        // The catch that makes the promise above unable to reject. Enrichment
        // throwing must not take a render with it.
        return { id: c.id, blocks: [], notes: [`failed: ${String(e).slice(0, 200)}`], attempts: 1 };
      }
    }));
    results.push(...done);
  }

  const enriched: Record<string, EnrichedBlock[]> = {};
  const composedSheets: Record<string, string[]> = {};
  const notes: string[] = [];
  const titleOf = new Map(work.map((c) => [c.id, c.title]));
  for (const r of results) {
    if (r.blocks.length) enriched[r.id] = r.blocks;
    if (r.sheets?.length) composedSheets[r.id] = r.sheets;
    for (const note of r.notes) notes.push(`${titleOf.get(r.id) ?? r.id}: ${note}`);
  }

  for (const c of skipped) notes.push(tooShortNote(c));

  return {
    enriched,
    composed: composedSheets,
    notes,
    model: ENRICHMENT_MODEL,
    chaptersAttempted: work.length,
    chaptersEnriched: Object.keys(enriched).length + Object.keys(composedSheets).length,
  };
}

/**
 * The document: what it lists, what it says, and whose brand is on it.
 *
 * The contents page is the assertion that matters most. This is the only format
 * in the programme whose sections are discovered from its content rather than
 * declared in code, so "the contents lists a section the document does not
 * contain" is a failure only this format can have.
 *
 * Fixtures are fictional and sized from the record.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { writeRenderArtifact } from '../../__tests__/renderArtifact';
import { buildReportQaDocument } from '../normalise.pure';
import { renderReportQaFromBrand, formatReportDate, DOCUMENT_NAME } from '../render.pure';
import { chapterLevelOf, LINES_PER_PAGE, MAX_TRANSCRIPT_CHAPTERS } from '../sections.pure';
import { buildReportBrandSnapshot } from '@/lib/reportDesign/snapshot.pure';
import { contentsEntriesFor, REPORT_ARCHETYPES } from '@/lib/reportDesign/structure.pure';
import { assertSafeRenderResources } from '../../../../../supabase/functions/_shared/renderResourcePolicy.pure';

const NOW = '2026-08-02T00:00:00.000Z';
const CID = '11111111-1111-4111-8111-111111111111';
const SUPABASE = 'https://dduzbchuswwbefdunfct.supabase.co';
const ARCHETYPE = REPORT_ARCHETYPES['report-qa'];
const mid = (n: number) => `2222${String(n).padStart(4, '0')}-2222-4222-8222-222222222222`;
const at = (n: number) => new Date(Date.UTC(2026, 6, 1, 0, n)).toISOString();

// A white-label tenant, so "the cover carries theirs and not ours" is falsifiable.
const { snapshot } = buildReportBrandSnapshot({
  whitelabel: { companyName: 'Tenant Advisory', brandColour: '#B8873A', preset: 'signature' },
  contact: { company_name: 'Tenant Advisory Pty Ltd', abn: '11 222 333 444' },
  capturedAt: NOW,
});

const ANSWER = `## Executive summary

The position holds on a **3.98%** gross yield.

### What the numbers say

| Metric | Value |
| --- | ---: |
| Purchase price | $850,000 |
| Rent (weekly) | $650 |

### Where the risk sits

- Vacancy has risen for two quarters
- Body corporate fees are above the median

> A six-month buffer is prudent.`;

const conv = (over: Record<string, unknown> = {}) => ({
  id: CID,
  title: 'Mariners Quay, Newstead — investment review',
  report_names: ['Mariners Quay Investment Report.pdf'],
  structured_report: null,
  ...over,
});

/**
 * A five-exchange transcript answers five different questions.
 *
 * Every exchange used to carry `ANSWER` verbatim, so a five-exchange render
 * printed the same executive summary, the same two-row table and the same pull
 * quote on four consecutive sheets — and fired the critique rubric's only
 * `high` rule four times on the fixture, which meant it could not have caught a
 * document that really did repeat itself.
 */
const QUESTIONS = [
  'Is 12 Mariners Quay worth pursuing at the guide?',
  'What happens to the position if rates rise another 1%?',
  'How does the body corporate schedule compare to the precinct?',
  'Would a two-year fixed rate be the better structure here?',
  'What would have to be true for this to be a mistake?',
];

const ANSWERS = [
  ANSWER,
  `## The short answer

At **+1%** the position moves from marginally negative to about **-$9,400** a year before tax.

### Where it lands

| Scenario | Annual position |
| --- | ---: |
| Today | -$2,180 |
| Rates +1% | -$9,420 |

The buffer covers it for eleven months, which is the number that matters.`,
  `## Against the precinct

Fees run **$6,840** a year against a precinct median of $5,200 for comparable stock.

### Why the gap

- The building carries a lift and a pool, and the sinking fund reflects both
- Two of the four lots are owner-occupied, which historically resists fee restraint

> The premium is real, and it is priced into the rent only in part.`,
  `## On structure

A two-year fix at the current sheet rate costs about **$1,900** more over the term than staying variable.

### What you are buying

- Certainty across the two years the buffer is thinnest
- The right to walk at the end without a break cost

The alternative is a split, which halves both the cost and the certainty.`,
  `## What would make this wrong

Three things, in the order they would show.

### The list

| Signal | Where to watch it |
| --- | --- |
| Vacancy above 3% | Quarterly rental report |
| A second fee rise | The AGM minutes |

> If two of the three appear inside a year, revisit rather than hold.`,
];

const pair = (i: number, answer = ANSWERS[i % ANSWERS.length], over: Record<string, unknown> = {}) => [
  {
    id: mid(i * 2),
    role: 'user',
    content: QUESTIONS[i % QUESTIONS.length],
    created_at: at(i * 2),
  },
  {
    id: mid(i * 2 + 1), role: 'assistant', content: answer, created_at: at(i * 2 + 1),
    model_provider: 'openai', model_version: 'gpt-5.2', ...over,
  },
];

const render = (over: Partial<Parameters<typeof buildReportQaDocument>[0]> = {}) => {
  const built = buildReportQaDocument({
    conversation: conv(), messages: pair(0), subject: 'transcript', preparedOn: NOW, ...over,
  });
  if (built.ok === false) throw new Error(built.error);
  return renderReportQaFromBrand({ document: built.document, snapshot });
};

const SUBJECTS = [
  ['a single answer', { subject: 'answer' as const, messageId: mid(1) }],
  ['a structured report', { subject: 'structured' as const, conversation: conv({ structured_report: ANSWER }) }],
  ['a transcript', { subject: 'transcript' as const }],
  ['a five-exchange transcript', {
    subject: 'transcript' as const,
    messages: Array.from({ length: 5 }, (_, i) => pair(i)).flat(),
  }],
] as const;

/**
 * The document, on disk, for the eye — the five-exchange transcript, which is
 * the only fixture here long enough to paginate. See `renderArtifact.ts`.
 */
beforeAll(() => {
  writeRenderArtifact('report-qa', render({
    subject: 'transcript',
    messages: Array.from({ length: 5 }, (_, i) => pair(i)).flat(),
  } as never).html);
});

describe('the contents page cannot claim something that was not printed', () => {
  it.each(SUBJECTS)('lists exactly the sections built, in order — %s', (_label, over) => {
    const out = render(over as never);
    const listed = contentsEntriesFor(out.spine).map((e) => e.title);
    expect(listed).toEqual(out.sections);
    for (const title of listed) {
      expect(out.bodyHtml, `"${title}" is listed but not printed`).toContain(title);
    }
  });
});

describe('the spine', () => {
  it.each(SUBJECTS)('is legal for its archetype — %s', (_label, over) => {
    expect(render(over as never).problems).toEqual([]);
  });

  it.each(SUBJECTS)('claims a page count inside the band — %s', (_label, over) => {
    const { pageBudget } = render(over as never);
    expect(pageBudget).toBeGreaterThanOrEqual(ARCHETYPE.pageBudget[0]);
    expect(pageBudget).toBeLessThanOrEqual(ARCHETYPE.pageBudget[1]);
  });

  /**
   * The one case a discovered spine can produce that a declared one cannot: a
   * model that writes a heading per line. The chapter cap is what stops the
   * contents page becoming longer than the document.
   */
  it('stays legal when the model writes forty headings', () => {
    const many = Array.from({ length: 40 }, (_, i) => `## Section ${i}\n\ntext`).join('\n\n');
    const out = render({ subject: 'structured', conversation: conv({ structured_report: many }) });
    expect(out.problems).toEqual([]);
    expect(out.pageBudget).toBeLessThanOrEqual(ARCHETYPE.pageBudget[1]);
  });

  it('keeps a transcript inside the band however long the conversation', () => {
    const out = render({ messages: Array.from({ length: 60 }, (_, i) => pair(i)).flat() });
    expect(out.pageBudget).toBeLessThanOrEqual(ARCHETYPE.pageBudget[1]);
    expect(out.truncated).toBe(true);
  });

  it('opens a chapter per exchange up to the threshold and folds the rest', () => {
    const few = render({ messages: Array.from({ length: 4 }, (_, i) => pair(i)).flat() });
    expect(few.sections.filter((s) => QUESTIONS.includes(s))).toHaveLength(4);
    const many = render({ messages: Array.from({ length: 60 }, (_, i) => pair(i)).flat() });
    expect(many.sections.some((s) => /^Exchanges \d+ to \d+$/.test(s))).toBe(true);
    expect(many.sections.length).toBeLessThanOrEqual(MAX_TRANSCRIPT_CHAPTERS + 2);
  });
});

describe('what the reader is told', () => {
  /**
   * The transcript is cut twice — once on a character estimate in the
   * normaliser, once on the real line counts in the renderer. A lede built from
   * the first sat three lines above a callout built from the second, reading
   * "19 of 20 exchanges" over "This document carries 13 of 20 exchanges". Found
   * by looking at the page.
   */
  it('gives one exchange count, not two', () => {
    const out = render({ messages: Array.from({ length: 60 }, (_, i) => pair(i)).flat() });
    expect(out.truncated).toBe(true);
    const counts = [...out.bodyHtml.matchAll(/(\d+) of (\d+) exchanges/g)].map((m) => m[0]);
    expect(counts.length).toBeGreaterThanOrEqual(2);
    expect(new Set(counts).size).toBe(1);
    expect(counts[0]).toContain(`${out.turnsShown} of `);
  });

  it('says on the page when it is not the whole conversation', () => {
    const out = render({ messages: Array.from({ length: 60 }, (_, i) => pair(i)).flat() });
    expect(out.bodyHtml).toContain('Not the whole conversation');
    expect(out.bodyHtml).toContain('Markdown and plain-text exports');
  });

  it('does not say so when nothing was cut', () => {
    expect(render().bodyHtml).not.toContain('Not the whole conversation');
  });

  it('prints the question above a single answer', () => {
    const out = render({ subject: 'answer', messageId: mid(1) });
    expect(out.bodyHtml).toContain('Asked');
    expect(out.bodyHtml).toContain(QUESTIONS[0]);
  });

  it('prints how each answer was produced', () => {
    expect(render().bodyHtml).toContain('openai · gpt-5.2');
  });

  it('prints the sources when there are any, and no empty section when not', () => {
    const cited = render({
      messages: pair(0, ANSWER, {
        citations: [{ document_name: 'Mariners Quay Investment Report.pdf', page_number: 4, paragraph_index: 12, snippet: 'Vacancy rose to 3.1%.', similarity: 0.87 }],
      }),
    });
    expect(cited.sections).toContain('Sources');
    expect(cited.bodyHtml).toContain('p.4 · ¶12');
    expect(cited.bodyHtml).toContain('87%');
    expect(render().sections).not.toContain('Sources');
  });

  it('shows an unanswered question rather than dropping it', () => {
    const out = render({
      messages: [{ id: mid(0), role: 'user', content: 'Cut off?', created_at: at(0) }],
    });
    expect(out.bodyHtml).toContain('No answer');
  });
});

describe('the brand', () => {
  it.each(SUBJECTS)('puts the tenant on the cover and us nowhere — %s', (_label, over) => {
    const { bodyHtml } = render(over as never);
    expect(bodyHtml).toContain('Tenant Advisory');
    expect(bodyHtml).not.toContain('NPC Services');
    expect(bodyHtml).not.toContain('npc-qa-cover');
  });

  it('names the format, not a vendor, on the cover', () => {
    // Escaped, because the format's own name contains an ampersand.
    expect(render().bodyHtml).toContain(DOCUMENT_NAME.replace('&', '&amp;'));
    // The legacy prints this fixed subtitle on every content page of a Q&A
    // document, whatever the conversation was about.
    expect(render().bodyHtml).not.toContain('Investment Property Analysis');
  });
});

describe('safety', () => {
  it.each(SUBJECTS)('passes the render resource policy — %s', (_label, over) => {
    expect(() => assertSafeRenderResources(render(over as never).html, SUPABASE)).not.toThrow();
  });

  it('passes it with urls all through the conversation', () => {
    const dirty = 'See https://evil.test/a and [x](https://evil.test/b) and ![y](https://evil.test/c)';
    const out = render({
      messages: [
        { id: mid(0), role: 'user', content: dirty, created_at: at(0) },
        { id: mid(1), role: 'assistant', content: `${dirty}\n\n| a | b |\n| --- | --- |\n| ${dirty} | 1 |`, created_at: at(1) },
      ],
    });
    expect(() => assertSafeRenderResources(out.html, SUPABASE)).not.toThrow();
  });

  it('escapes a conversation title that carries markup', () => {
    const out = render({ conversation: conv({ title: '<script>alert(1)</script>' }) });
    expect(out.bodyHtml).not.toContain('<script');
    expect(out.bodyHtml).toContain('&lt;script&gt;');
  });
});

describe('helpers', () => {
  it('formats a date without asking the runtime for a locale', () => {
    expect(formatReportDate('2026-08-02T00:00:00.000Z')).toBe('02 August 2026');
    expect(formatReportDate('nonsense')).toBe('');
  });

  it('treats a lone top-level heading as a title, not a section', () => {
    // `summarize-conversation`'s own brief asks for exactly this shape: one `#`
    // title over eight `##` sections. Taking the `#` as the only chapter gave an
    // eleven-page document a one-entry contents page.
    expect(chapterLevelOf([
      { level: 2, sourceLevel: 1, text: 'Title', id: 'a', blockIndex: 0 },
      { level: 3, sourceLevel: 2, text: 'One', id: 'b', blockIndex: 1 },
      { level: 3, sourceLevel: 2, text: 'Two', id: 'c', blockIndex: 2 },
    ])).toBe(3);
  });

  it('keeps the shallowest level when it was used more than once', () => {
    expect(chapterLevelOf([
      { level: 2, sourceLevel: 1, text: 'One', id: 'a', blockIndex: 0 },
      { level: 2, sourceLevel: 1, text: 'Two', id: 'b', blockIndex: 1 },
      { level: 3, sourceLevel: 2, text: 'Sub', id: 'c', blockIndex: 2 },
    ])).toBe(2);
  });

  it('states the lines-per-page figure a render pinned', () => {
    expect(LINES_PER_PAGE).toBeGreaterThan(20);
    expect(LINES_PER_PAGE).toBeLessThan(50);
  });
});

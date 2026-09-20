/**
 * A report body is not a chat answer, and it was being cut like one.
 *
 * ## What the reader was told
 *
 * Page 34 of the 42 Patya Circuit Investment Compass:
 *
 * > **Not shown** — A further 25,804 characters of this answer are not shown.
 * > The complete text is in the Markdown export.
 *
 * Three things wrong in two sentences, and the first is the one that matters.
 *
 * **A quarter of the report was gone.** `renderMarkdown` cuts its source at
 * `MAX_MARKDOWN_CHARS`, and that constant's own header says what it is for:
 *
 * > The unit of work is one message, not one conversation … the number this
 * > has to survive is the largest single answer: 33,377. This is twice that.
 *
 * That is Report Q&A's bound. The Investment Compass goes through the same
 * function — `markdownBlockContent` hands it the WHOLE body — and
 * `compassSectionRegistry` declares the Compass at **8,410 words across 35
 * pages**, before ~107 chart directives a report and the planning and
 * infrastructure registers appended to it verbatim. The declared size of the
 * document is past the renderer's bound by construction.
 *
 * 65,536 + 25,804 = **91,340** — the body that was written, against the 65,536
 * that was drawn.
 *
 * **It spoke another product's vocabulary.** A Compass is not an "answer" and
 * has no "Markdown export". `truncationLabel` already existed as an option for
 * exactly this and had **zero call sites**, so every format got Q&A's words.
 *
 * ## What changed
 *
 * `maxChars`, `truncationSubject` and `truncationDestination` are the caller's,
 * defaulted to today's values so every existing caller is byte-identical. The
 * template block and the projection — the two sides that must agree on how
 * many pages a body makes — both pass `MAX_REPORT_BODY_CHARS`, derived from the
 * registry's own declared budget rather than guessed, and both say "report".
 *
 * The destination is deliberately empty for a report: with the larger bound
 * this notice should not draw at all, so it is a fault signal rather than
 * routine copy, and a client document must not name a dashboard the reader
 * may not have.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  MAX_BLOCKS,
  MAX_HEADINGS,
  MAX_MARKDOWN_CHARS,
  MAX_REPORT_BODY_CHARS,
  REPORT_BODY_LIMITS,
  renderMarkdown,
} from '../../../../supabase/functions/_shared/reports/markdown.pure';
import {
  COMPASS_40_SECTIONS,
} from '../../../../supabase/functions/_shared/compassSectionRegistry';

/** A body of `n` characters that survives every other scrub unchanged. */
const body = (n: number): string => {
  const para = `${'word '.repeat(19)}end.\n\n`;
  return para.repeat(Math.ceil(n / para.length)).slice(0, n);
};

describe('the bound a report body is read at', () => {
  it('is larger than the one written for a single chat answer', () => {
    expect(MAX_MARKDOWN_CHARS).toBe(65_536);
    expect(MAX_REPORT_BODY_CHARS).toBe(131_072);
    expect(MAX_REPORT_BODY_CHARS).toBeGreaterThan(MAX_MARKDOWN_CHARS);
  });

  it('clears the document the registry says the Compass may be', () => {
    // 8,410 words. The conversion is stated in the constant's own note; what
    // this pins is that the BUDGET the product declares and the BOUND the
    // renderer applies are compared at all, which they never were.
    const declaredWords = COMPASS_40_SECTIONS.reduce(
      (n, s) => n + ((s as { maxWordCount?: number }).maxWordCount ?? 0),
      0,
    );
    expect(declaredWords).toBe(8410);
    // The prose alone, at the note's ~6.5 characters a word, already exceeds
    // more than half the old bound — before a single chart directive or table.
    expect(declaredWords * 6.5).toBeGreaterThan(MAX_MARKDOWN_CHARS * 0.8);
    expect(declaredWords * 6.5).toBeLessThan(MAX_REPORT_BODY_CHARS);
  });

  /*
   * THREE guards, not one — and this is why the first attempt at this fix was
   * incomplete. Raising `maxChars` alone frees the source and then loses the
   * document at `MAX_BLOCKS` instead: measured on the same 90,000-character
   * body, 401 blocks with the character bound raised and the block guard left
   * alone, against 892 when both move. The same loss, a different notice.
   */
  it('conserves a report-sized body only when all three guards move', () => {
    const source = body(90_000);
    const asChatAnswer = renderMarkdown(source);
    const charsOnly = renderMarkdown(source, { maxChars: MAX_REPORT_BODY_CHARS });
    const asReport = renderMarkdown(source, REPORT_BODY_LIMITS);

    // Today's default: a quarter of the source never reaches a block.
    expect(asChatAnswer.notices.truncatedAtChars).toBeGreaterThan(20_000);
    expect(asChatAnswer.notices.truncatedAtBlocks).toBe(true);
    expect(asChatAnswer.blocks.length).toBe(MAX_BLOCKS + 1);

    // The character bound alone: the source survives and the document does not.
    expect(charsOnly.notices.truncatedAtChars).toBeNull();
    expect(charsOnly.notices.truncatedAtBlocks).toBe(true);
    expect(charsOnly.blocks.length).toBe(MAX_BLOCKS + 1);
    expect(charsOnly.degraded).toBe(true);

    // Both: nothing is lost and nothing is flagged.
    expect(asReport.notices.truncatedAtChars).toBeNull();
    expect(asReport.notices.truncatedAtBlocks).toBe(false);
    expect(asReport.blocks.length).toBeGreaterThan(MAX_BLOCKS * 2);
    expect(asReport.degraded).toBe(false);
  });

  it('keeps every guard a guard — each is well past the legitimate maximum', () => {
    expect(REPORT_BODY_LIMITS.maxChars).toBe(MAX_REPORT_BODY_CHARS);
    expect(REPORT_BODY_LIMITS.maxBlocks).toBeGreaterThan(MAX_BLOCKS * 3);
    expect(REPORT_BODY_LIMITS.maxHeadings).toBeGreaterThan(MAX_HEADINGS * 2);
    // A Compass has 15 sections; the guard is not a budget.
    expect(REPORT_BODY_LIMITS.maxHeadings).toBeGreaterThan(COMPASS_40_SECTIONS.length * 10);
  });

  it('still cuts a genuinely absurd body, and says so', () => {
    const r = renderMarkdown(body(200_000), REPORT_BODY_LIMITS);
    expect(r.notices.truncatedAtChars).toBeGreaterThan(0);
    expect(r.degraded).toBe(true);
  });
});

describe('the notice speaks for the document it is drawn in', () => {
  const cut = (opts: Record<string, unknown>) =>
    renderMarkdown(body(90_000), opts).blocks.find((b) => b.kind === 'notice')?.html ?? '';

  it('defaults to the words Report Q&A needs, so nothing existing moves', () => {
    const html = cut({});
    expect(html).toContain('characters of this answer are not shown');
    expect(html).toContain('The complete text is in the Markdown export.');
  });

  it('says "report" where a report is being drawn', () => {
    const html = cut({ truncationSubject: 'report', truncationDestination: '' });
    expect(html).toContain('characters of this report are not shown');
    expect(html).not.toContain('answer');
    expect(html).not.toContain('Markdown export');
  });

  it('names no destination rather than one the reader may not have', () => {
    const html = cut({ truncationSubject: 'report', truncationDestination: '' });
    // The sentence ends at the count. No trailing space, no dangling clause.
    expect(html).toMatch(/characters of this report are not shown\.<\/p>/);
  });
});

describe('the two sides that count pages read the same limits', () => {
  /*
   * Asserted at the CALL SITE, not at a declaration.
   *
   * The first version of this test looked for `...REPORT_BODY_LIMITS`
   * anywhere in the file — and `REPORT_BODY_RENDER` spreads it in its own
   * declaration, so removing the spread from a `renderMarkdown` call left the
   * string present and the test green while the block went back to the chat
   * bound. That is the same mistake this whole document is about: checking
   * something other than the thing that runs.
   */
  const callSites = (source: string): string[] => {
    const out: string[] = [];
    const re = /renderMarkdown\(\s*[A-Za-z0-9_.]+\s*,\s*\{/g;
    for (let m = re.exec(source); m; m = re.exec(source)) {
      // The options object, up to its first nested brace or its close.
      out.push(source.slice(m.index, m.index + 400));
    }
    return out;
  };

  it('every renderMarkdown that draws a report body spreads the limits', () => {
    const block = readFileSync(
      resolve(__dirname, '../../../../src/lib/reportTemplate/blocks/markdownBlockContent.ts'),
      'utf8',
    );
    const sites = callSites(block);
    // Both paths: the geometry one and the flat one.
    expect(sites.length).toBe(2);
    for (const site of sites) {
      expect(site, `a renderMarkdown in the block without the report limits:\n${site.slice(0, 120)}`)
        .toContain('...REPORT_BODY_RENDER');
    }
    expect(block).toContain('...REPORT_BODY_LIMITS');
  });

  it('the projection estimates pages from the same limits', () => {
    // They must agree or the master's page conditionals and the block's own
    // page count drift — the defect that module's header already forbids.
    const projection = readFileSync(
      resolve(__dirname, '../../../../supabase/functions/_shared/reportBindingProjection.pure.ts'),
      'utf8',
    );
    const sites = callSites(projection);
    expect(sites.length).toBe(1);
    expect(sites[0]).toContain('...REPORT_BODY_LIMITS');
  });
});

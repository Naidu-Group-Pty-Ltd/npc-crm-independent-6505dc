/**
 * Two things a stored document must not carry, guaranteed where it is READ.
 *
 * Both are the same shape, and it is the shape this repository keeps paying
 * for: a rule that exists as an INSTRUCTION to the model, or as a scrub on the
 * WRITE path, reaches nothing that has already shipped.
 *
 * ## 1. A bracketed pointer into the prompt's own scaffolding
 *
 * `generate-investment-report` pins the planning and infrastructure evidence
 * under four headings that are instructions — the reader has never seen them.
 * The pinned block already carries a rule saying so, in as many words:
 * "**never write a bracketed pointer** such as `[Zoning & Planning table]` …
 * A bracket like that lands mid-sentence in a client document and refers to
 * nothing they can open." The delivered suite carried them anyway: nine of ten
 * documents with at least one, one Compass with nine.
 *
 * `stripEditorialBlocks` wrote the lesson down one file over — the v2.0 prompt
 * said "at most one per section" twice and production carried ninety a report.
 * **An instruction is a request; this is the guarantee.**
 *
 * It SUBSTITUTES rather than deletes, because the claim behind the pointer is
 * sound: both tables are appended verbatim to the finished document, so there
 * is a real section to send the reader to. Deleting the bracket would leave
 * the sentence unsourced, which is worse than an ugly sentence that is
 * sourced.
 *
 * ## 2. The same chart, drawn five times
 *
 * `dedupeChartDirectives` has existed since Stage 4 and ran on the write path
 * alone. On the 42 Patya Circuit Compass of 19 September 2026 the identical
 * three-bar price chart was drawn on five pages. Moving it to the read path is
 * the argument that already moved the placeholder scrub and the chart-evidence
 * contract there: it repairs every stored report, for every reader, with no
 * migration.
 *
 * ## The rule neither of them may break
 *
 * **Prose is never regex-scrubbed.** Both are punctuation-level: a closed set
 * of four strings the prompt itself wrote, and a directive the parser already
 * recognises. Neither can reach a sentence a model composed.
 */
import { describe, expect, it } from 'vitest';
import {
  PLANNING_REGISTER_SECTION,
  presentStoredMarkdown,
  rewriteScaffoldingPointers,
} from '../../../../supabase/functions/_shared/reports/investment/derivedHygiene.pure';

const CHART = '{{bars: Median price | Subject=700 | Suburb=650 | LGA=600 }}';

describe('a pointer into the prompt becomes a pointer into the report', () => {
  it('rewrites the four scaffolding headings the prompt defines', () => {
    for (const marker of [
      'Zoning & Planning table',
      'Zoning & Planning notes',
      'Infrastructure table',
      'Infrastructure section',
    ]) {
      const { markdown, rewritten } = rewriteScaffoldingPointers(`The zone is R2 [${marker}].`);
      expect(rewritten, marker).toBe(1);
      expect(markdown).toBe(`The zone is R2 (see *${PLANNING_REGISTER_SECTION}*).`);
      expect(markdown).not.toContain('[');
    }
  });

  it('keeps the sentence sourced — the reference is a real section', () => {
    /*
     * The production form, verbatim from the generator's own note: the pointer
     * sits hard against the full stop of the sentence it closes.
     *
     * This assertion previously expected the reference AFTER that full stop —
     * `expectations. (see *…*) The recorded…` — which leaves a parenthetical
     * standing alone between two sentences, belonging to neither. A source
     * belongs inside the sentence it sources, so the punctuation the pointer
     * followed is now re-emitted after the reference. Renegotiated rather than
     * worked around: the old string was pinning a placement, not a guarantee,
     * and the guarantees here are that the bracket goes and the sentence stays
     * sourced.
     */
    const production = 'must factor into rental and resale expectations.[Infrastructure section] '
      + 'The recorded 680 new dwellings…';
    const { markdown } = rewriteScaffoldingPointers(production);
    expect(markdown).toBe(
      'must factor into rental and resale expectations '
      + `(see *${PLANNING_REGISTER_SECTION}*). The recorded 680 new dwellings…`,
    );
    expect(markdown).not.toContain('[');
  });

  it('does not write "see (see …)" where the sentence already says it', () => {
    expect(rewriteScaffoldingPointers('See [Zoning & Planning notes] for the controls.').markdown)
      .toBe(`See *${PLANNING_REGISTER_SECTION}* for the controls.`);
    expect(rewriteScaffoldingPointers('as set out in [Infrastructure table].').markdown)
      .toBe(`as set out in *${PLANNING_REGISTER_SECTION}*.`);
  });

  it('touches no other bracket, and no prose', () => {
    // A citation, a markdown link, a lot number, an ordinary aside. None of
    // these names the prompt's scaffolding, so none of them is this rule's.
    for (const untouched of [
      'The consent [DA 2024/1180] was approved.',
      'See the [NSW Planning Portal](https://www.planningportal.nsw.gov.au/).',
      'Lot 60448 [Cloverton] is the subject.',
      'The infrastructure table below sets out each project.',
      'Zoning & Planning table rows are reproduced at the end.',
    ]) {
      expect(rewriteScaffoldingPointers(untouched)).toEqual({ markdown: untouched, rewritten: 0 });
    }
  });
});

describe('a stored document draws each chart once', () => {
  it('keeps the first drawing and drops the repeats, on read', () => {
    const stored = [
      '# Market', '', CHART, '', 'The subject sits above the suburb median.',
      '', '## Outlook', '', CHART, '', 'It is the same comparison.',
      '', '## Risk', '', CHART, '', 'And again.',
    ].join('\n');
    const presented = presentStoredMarkdown(stored);
    expect(presented.split('{{bars:').length - 1, 'one drawing survives').toBe(1);
    // The prose around every copy is kept: only the directive goes.
    expect(presented).toContain('The subject sits above the suburb median.');
    expect(presented).toContain('It is the same comparison.');
    expect(presented).toContain('And again.');
  });

  it('is byte-identical on a document that was already correct', () => {
    const clean = [
      '# Market', '', CHART, '', 'One chart, one drawing.',
      '', '## Rent', '', '{{bars: Weekly rent | Subject=850 | Suburb=800 }}', '', 'A different quantity.',
    ].join('\n');
    expect(presentStoredMarkdown(clean)).toBe(clean);
  });

  it('carries the pointer rewrite through the same read path', () => {
    const stored = '## Planning\n\nThe zone is R2 [Zoning & Planning table], which permits dual occupancies.\n';
    expect(presentStoredMarkdown(stored)).toContain(`(see *${PLANNING_REGISTER_SECTION}*)`);
    expect(presentStoredMarkdown(stored)).not.toContain('[Zoning & Planning table]');
  });
});

/**
 * The fourth guarantee: a section the model wrote twice reaches the reader
 * once.
 *
 * `foldStraySections` is pinned in detail by `sectionWrittenTwice.spec.ts`.
 * What is asserted here is the thing that decides whether any of it reaches a
 * client — that it runs inside `presentStoredMarkdown`, the one scrub all four
 * renderers apply, so every document already stored is repaired for every
 * reader rather than only the next one generated.
 */
describe('a section written twice is presented once, on the read path', () => {
  const stored = [
    '## Risk Dashboard', '',
    'The register sets out what was retrieved.', '',
    '### Due Diligence Checklist', '',
    '1. Obtain the section 10.7 planning certificate from the council.',
    '2. Commission a building and pest inspection before settlement.', '',
    '## Due Diligence Checklist', '',
    '- Obtain the section 10.7 planning certificate from the council.',
    '- Arrange finance approval in writing before the cooling-off period ends.', '',
  ].join('\n');

  it('folds the nested copy forward through the stored-document scrub', () => {
    const presented = presentStoredMarkdown(stored);
    const headings = presented.split('\n').filter((l) => /Due Diligence Checklist/.test(l));
    expect(headings).toHaveLength(1);
    expect(headings[0]).toBe('## Due Diligence Checklist');
    expect(presented.split('section 10.7 planning certificate')).toHaveLength(2);
    // Both copies' own contributions survive.
    expect(presented).toContain('2. Commission a building and pest inspection before settlement.');
    expect(presented).toContain('Arrange finance approval in writing');
    // And the section it was nested inside keeps its own prose.
    expect(presented).toContain('The register sets out what was retrieved.');
  });

  it('is byte-identical on a document that writes each section once', () => {
    const clean = [
      '## Risk Dashboard', '', 'The register sets out what was retrieved.', '',
      '## Due Diligence Checklist', '', '1. Obtain the planning certificate.', '',
    ].join('\n');
    expect(presentStoredMarkdown(clean)).toBe(clean);
  });
});

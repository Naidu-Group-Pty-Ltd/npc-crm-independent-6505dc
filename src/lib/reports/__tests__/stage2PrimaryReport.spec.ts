/**
 * Stage 2 — two rules about the document rather than the data.
 *
 * Both were found by rendering a real production report and reading it:
 * `28 Bligh Street, Muswellbrook NSW 2333`, 5 Sep 2026, compass-40, the shape
 * the generator writes today.
 *
 *  1. A render that LOST content says so. The machinery to detect it already
 *     existed and every caller discarded the answer.
 *  2. Two services measure the same distance; the one the record keeps is the
 *     one the prose quotes.
 *
 * As in Stage 1, the adoption-safety cases carry more weight than the new
 * behaviour: a clean document must report nothing, and a school the record does
 * not name must keep the distance it arrived with.
 */
import { describe, expect, it } from 'vitest';

import { contentLosses, renderMarkdown } from '../markdown.pure';
import {
  reconcileNearestSchool,
  reconcileSchoolDistances,
  schoolKey,
} from '../schoolDistance.pure';

describe('a render that lost content says what it lost', () => {
  // Verbatim from the Muswellbrook report: two table rows concatenated by a
  // stray `||`, which the renderer copes with by dropping columns.
  const MERGED_ROW = [
    '| Risk | Level | Why It Matters | Required Check | Confidence |',
    '|------|-------|----------------|----------------|-----------|',
    '| Supply | Moderate | Established homes dominate. | Review strategies. | General |',
    '| Timing | Low | Incremental works. | Cross-check programs. | General || Tenant turnover | Moderate | Employment moves in cycles. | Ask managers.',
  ].join('\n');

  it('names the columns a malformed row cost', () => {
    const { notices } = renderMarkdown(MERGED_ROW);
    expect(notices.tableColumnsDropped).toBeGreaterThan(0);

    const losses = contentLosses(notices);
    expect(losses.join(' | ')).toMatch(/table column/);
  });

  it('says nothing at all about a clean document', () => {
    // The bar for adoption: every well-formed report must stay silent, or the
    // signal is noise on the first day.
    const { notices } = renderMarkdown(
      '## Heading\n\nA paragraph.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n',
    );
    expect(contentLosses(notices)).toEqual([]);
  });

  it('reports content that was LOST and stays quiet about content that was TRANSFORMED', () => {
    // A landscaped table, a flattened list, a neutralised URL and a
    // transliterated glyph all keep the words. Reporting them would bury the
    // notices that mean a client did not see something.
    const transformed = {
      truncatedAtChars: null, truncatedAtBlocks: false,
      tablesRejected: 0, tablesRagged: 3, tableColumnsDropped: 0, tableRowsDropped: 0,
      tablesLandscaped: 2, listsFlattened: 4, listItemsDropped: 0, codeLinesDropped: 0,
      headingsDropped: 0, thematicBreaks: 5, linksFlattened: 9, imagesDropped: 0,
      glyphsDropped: 0, glyphsTransliterated: 12, urlsNeutralised: 3,
      unmatchedEmphasis: 1, inlineSkipped: 2, figuresDrawn: 6, figuresDropped: 0,
      headingsDroppedEmpty: 0, footnotesRendered: 2, footnoteRefsDropped: 0,
      listRunsMerged: 1,
      delimiterRowsNormalised: 0,
    };
    expect(contentLosses(transformed)).toEqual([]);

    // `tablesRagged` is deliberately silent: the loss it causes is counted
    // separately as dropped columns, and reporting both would double it.
    expect(contentLosses({ ...transformed, tableColumnsDropped: 5 }))
      .toEqual(['5 table columns dropped from a malformed row']);
  });

  it('counts one and many correctly, because a report a person reads should read', () => {
    const base = contentLosses({
      truncatedAtChars: null, truncatedAtBlocks: false,
      tablesRejected: 1, tablesRagged: 0, tableColumnsDropped: 0, tableRowsDropped: 0,
      tablesLandscaped: 0, listsFlattened: 0, listItemsDropped: 2, codeLinesDropped: 0,
      headingsDropped: 0, thematicBreaks: 0, linksFlattened: 0, imagesDropped: 0,
      glyphsDropped: 0, glyphsTransliterated: 0, urlsNeutralised: 0,
      unmatchedEmphasis: 0, inlineSkipped: 0, figuresDrawn: 0, figuresDropped: 0,
      headingsDroppedEmpty: 0, footnotesRendered: 0, footnoteRefsDropped: 0,
      listRunsMerged: 0,
      delimiterRowsNormalised: 0,
    });
    expect(base).toContain('1 table could not be parsed and was dropped');
    expect(base).toContain('2 list items dropped');
  });
});

describe('one distance per school', () => {
  // The real disagreement, verbatim.
  const FROM_SCHOOL_SERVICE = [
    { name: 'Muswellbrook Public School', distance: 0.29, type: 'Government' },
    { name: 'Pacific Brook Christian School', distance: 0.46, type: 'Independent' },
    { name: 'Muswellbrook High School', distance: 1.30, type: 'Government' },
  ];
  const STORED_ON_THE_RECORD = [
    { name: 'Muswellbrook Public School', rating: 0, distance: 0.21 },
    { name: 'Pacific Brook Christian School', rating: 0, distance: 0.42 },
  ];

  it('replaces the prompt distance with the one the record keeps', () => {
    const out = reconcileSchoolDistances(FROM_SCHOOL_SERVICE, STORED_ON_THE_RECORD);
    expect(out[0].distance).toBe(0.21);
    expect(out[1].distance).toBe(0.42);
  });

  it('keeps a school the record does not name, at its own distance', () => {
    // A reconciliation, not a filter: dropping the high school would lose a
    // real fact to fix a disagreement that does not exist for it.
    const out = reconcileSchoolDistances(FROM_SCHOOL_SERVICE, STORED_ON_THE_RECORD);
    expect(out[2]).toEqual({ name: 'Muswellbrook High School', distance: 1.30, type: 'Government' });
  });

  it('carries every other field through untouched', () => {
    const out = reconcileSchoolDistances(FROM_SCHOOL_SERVICE, STORED_ON_THE_RECORD);
    expect(out[0].type).toBe('Government');
    expect(out.map((s) => s.name)).toEqual(FROM_SCHOOL_SERVICE.map((s) => s.name));
  });

  it('does not mutate either input', () => {
    reconcileSchoolDistances(FROM_SCHOOL_SERVICE, STORED_ON_THE_RECORD);
    expect(FROM_SCHOOL_SERVICE[0].distance).toBe(0.29);
    expect(STORED_ON_THE_RECORD[0].distance).toBe(0.21);
  });

  it('leaves the prompt untouched when the record knows no schools', () => {
    // Adoption safety: a report whose location intelligence never resolved must
    // behave exactly as it did.
    for (const empty of [null, undefined, []]) {
      expect(reconcileSchoolDistances(FROM_SCHOOL_SERVICE, empty))
        .toEqual(FROM_SCHOOL_SERVICE);
    }
  });

  it('matches the same school across two services despite spelling', () => {
    expect(schoolKey("St Joseph's Primary")).toBe(schoolKey('St Josephs Primary'));
    expect(schoolKey('  MUSWELLBROOK   public school ')).toBe('muswellbrook public school');
    expect(schoolKey(undefined)).toBe('');
  });

  it('reconciles the nearest school too, so the line above the table agrees with it', () => {
    const nearest = reconcileNearestSchool(FROM_SCHOOL_SERVICE[0], STORED_ON_THE_RECORD);
    expect(nearest?.distance).toBe(0.21);
    expect(reconcileNearestSchool(null, STORED_ON_THE_RECORD)).toBeNull();
    expect(reconcileNearestSchool(undefined, STORED_ON_THE_RECORD)).toBeUndefined();
  });

  it('ignores a stored entry with no usable distance rather than blanking a good one', () => {
    const out = reconcileSchoolDistances(
      [{ name: 'A', distance: 1.5 }],
      [{ name: 'A', distance: 'not a number' }],
    );
    expect(out[0].distance).toBe(1.5);
  });
});

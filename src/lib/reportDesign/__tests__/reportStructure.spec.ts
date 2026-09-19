/**
 * The structural defects that reach clients, caught before the render.
 *
 * None of these are visible in the PDF bytes and all of them have a plausible
 * cause: a retry that appends a second cover, a trim pass that removes a section
 * the contents page still lists, a failed fetch that turns a 40-page document
 * into a 12-page one. `validateSpine()` is where a render decides not to ship.
 */
import { describe, expect, it } from 'vitest';
import {
  REPORT_ARCHETYPES,
  SLOT_PAGE,
  buildSpine,
  contentsEntriesFor,
  spinePageBudget,
  validateSpine,
  type ChapterInput,
  type ReportArchetypeId,
} from '../structure.pure';
import { NAMED_PAGES } from '../page.pure';

const ARCHETYPE_IDS = Object.keys(REPORT_ARCHETYPES) as ReportArchetypeId[];

/** Chapters that exactly fill an archetype's band, so budget is not the variable. */
function chaptersFilling(id: ReportArchetypeId): ChapterInput[] {
  const a = REPORT_ARCHETYPES[id];
  // Minus the cover and the closing page, which `buildSpine` always adds.
  const spare = a.pageBudget[0] - 2 - (a.contents ? 1 : 0);
  const count = Math.max(1, Math.min(4, spare));
  const per = Math.floor(spare / count);
  const rest = spare - per * count;
  return Array.from({ length: count }, (_, i) => ({
    id: `${id}.c${i}`,
    title: `Chapter ${i + 1}`,
    note: 'A section.',
    pageBudget: per + (i === 0 ? rest : 0),
  }));
}

describe('slot → page mapping', () => {
  it.each(Object.entries(SLOT_PAGE))('%s prints on a page that exists', (_slot, page) => {
    expect(Object.keys(NAMED_PAGES)).toContain(page);
  });
});

describe('archetypes', () => {
  it.each(ARCHETYPE_IDS)('%s declares a coherent page band', (id) => {
    const [min, max] = REPORT_ARCHETYPES[id].pageBudget;
    expect(min).toBeGreaterThan(0);
    expect(max).toBeGreaterThanOrEqual(min);
  });

  it.each(ARCHETYPE_IDS)('%s permits the cover and closing slots it always uses', (id) => {
    expect(REPORT_ARCHETYPES[id].slots).toContain('cover');
    expect(REPORT_ARCHETYPES[id].slots).toContain('closing');
  });

  it('names each archetype distinctly — the name prints on the cover', () => {
    const names = ARCHETYPE_IDS.map((id) => REPORT_ARCHETYPES[id].documentName);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('buildSpine', () => {
  it.each(ARCHETYPE_IDS)('%s builds a spine that validates', (id) => {
    const spine = buildSpine({ archetype: id, chapters: chaptersFilling(id) });
    expect(validateSpine(id, spine)).toEqual([]);
  });

  it('always adds the closing page — the one omission with a legal consequence', () => {
    const spine = buildSpine({
      archetype: 'snapshot',
      chapters: [{ id: 's.1', title: 'Overview', pageBudget: 1 }],
    });
    expect(spine[spine.length - 1].slot).toBe('closing');
  });

  it('adds a contents page only where the archetype carries one', () => {
    const withContents = buildSpine({
      archetype: 'investment-compass',
      chapters: chaptersFilling('investment-compass'),
    });
    expect(withContents.some((e) => e.slot === 'contents')).toBe(true);

    const without = buildSpine({
      archetype: 'snapshot',
      chapters: [{ id: 's.1', title: 'Overview', pageBudget: 1 }],
    });
    expect(without.some((e) => e.slot === 'contents')).toBe(false);
  });

  it('refuses a wide table in an archetype that does not permit one', () => {
    const spine = buildSpine({
      archetype: 'borrowing-capacity',
      chapters: [{ id: 'b.1', title: 'Capacity', pageBudget: 2, wide: true }],
    });
    // Downgraded to a normal chapter rather than emitting an illegal slot.
    expect(spine.find((e) => e.id === 'b.1')?.slot).toBe('chapter');
  });

  it('honours a wide table where it is permitted', () => {
    const spine = buildSpine({
      archetype: 'financial-analysis',
      chapters: [{ id: 'f.1', title: 'Ten-year projection', pageBudget: 14, wide: true }],
    });
    expect(spine.find((e) => e.id === 'f.1')?.slot).toBe('wide-table');
  });
});

describe('contentsEntriesFor', () => {
  it('numbers chapters in printed order and lists nothing else', () => {
    const spine = buildSpine({
      archetype: 'financial-analysis',
      chapters: [
        { id: 'f.1', title: 'Purchase costs', pageBudget: 6, note: 'Stamp duty and fees' },
        { id: 'f.2', title: 'Ten-year projection', pageBudget: 8, wide: true },
      ],
    });
    expect(contentsEntriesFor(spine)).toEqual([
      { number: '01', title: 'Purchase costs', note: 'Stamp duty and fees' },
      { number: '02', title: 'Ten-year projection', note: undefined },
    ]);
  });

  it('cannot list a section the spine does not contain', () => {
    const spine = buildSpine({
      archetype: 'financial-analysis',
      chapters: [{ id: 'f.1', title: 'Kept', pageBudget: 16 }],
    });
    expect(contentsEntriesFor(spine).map((e) => e.title)).toEqual(['Kept']);
  });
});

describe('validateSpine', () => {
  const good = () => buildSpine({
    archetype: 'financial-analysis',
    chapters: chaptersFilling('financial-analysis'),
  });

  it('rejects a second cover', () => {
    const spine = good();
    spine.splice(1, 0, { slot: 'cover', id: 'dupe.cover', title: 'Cover', pageBudget: 1 });
    expect(validateSpine('financial-analysis', spine).join('\n')).toContain('exactly one cover');
  });

  it('rejects a closing page that is not last', () => {
    const spine = good();
    const closing = spine.pop()!;
    spine.splice(2, 0, closing);
    expect(validateSpine('financial-analysis', spine).join('\n'))
      .toContain('closing page must be the last entry');
  });

  it('rejects a contents page that does not follow the cover', () => {
    const spine = good().filter((e) => e.slot !== 'contents');
    spine.splice(3, 0, { slot: 'contents', id: 'late.contents', title: 'Contents', pageBudget: 1 });
    expect(validateSpine('financial-analysis', spine).join('\n'))
      .toContain('contents page must follow the cover');
  });

  it('rejects a duplicate entry id', () => {
    const spine = good();
    spine.push({ ...spine[2], slot: 'chapter' });
    expect(validateSpine('financial-analysis', spine).join('\n')).toContain('duplicate entry id');
  });

  it('rejects a document with no chapters at all', () => {
    const spine = buildSpine({ archetype: 'snapshot', chapters: [] });
    expect(validateSpine('snapshot', spine).join('\n')).toContain('at least one chapter');
  });

  it('rejects a render that came in short of its band', () => {
    // On `financial-analysis`, not `investment-compass`.
    //
    // This used a five-page investment-compass spine against that archetype's
    // declared floor of 34 — a floor that had been written before anything
    // rendered against it. When the format was implemented and measured, the
    // real minimum turned out to be six pages: a location-only report with no
    // score and no financial model is a legitimate and common shape, and a
    // floor of 34 would have refused every one of them. The floor is now the
    // arithmetic minimum, so a five-page spine is inside the band and this
    // assertion needed a vehicle that is genuinely short of its own.
    const spine = buildSpine({
      archetype: 'financial-analysis',
      chapters: [{ id: 'c.1', title: 'Only section', pageBudget: 1 }],
    });
    const problems = validateSpine('financial-analysis', spine).join('\n');
    expect(problems).toContain('outside financial-analysis');
    expect(spinePageBudget(spine)).toBe(4);
  });

  it('rejects a slot the archetype does not permit', () => {
    const spine = buildSpine({
      archetype: 'borrowing-capacity',
      chapters: [{ id: 'b.1', title: 'Capacity', pageBudget: 4 }],
    });
    spine.splice(1, 0, { slot: 'divider', id: 'b.div', title: 'Part two', pageBudget: 1 });
    expect(validateSpine('borrowing-capacity', spine).join('\n'))
      .toContain('is not permitted in borrowing-capacity');
  });

  it('rejects an untitled or zero-page entry', () => {
    const spine = good();
    spine[2] = { ...spine[2], title: '  ', pageBudget: 0 };
    const problems = validateSpine('financial-analysis', spine).join('\n');
    expect(problems).toContain('has no title');
    expect(problems).toContain('page budget must be positive');
  });
});

/**
 * The Due Diligence Checklist appeared on pages 24–25 and again on 25–26.
 *
 * This pins `foldStraySections`, which is the fix for the duplication residual
 * recorded in `PLANNING_CONTROLS_IN_THE_REPORT.md` §7. The shape is taken from
 * the document that produced it: the model wrote two later sections inside the
 * Risk Dashboard's own chunk as sub-headings, and then wrote them again as
 * their own sections, so a client read each twice.
 *
 * The assertions below are about the two halves of the rule — that the reader
 * meets the section once, and that nothing the model wrote is destroyed to
 * achieve it — and about the much larger set of documents this must not touch.
 */
import { describe, expect, it } from 'vitest';
import {
  blockKey,
  foldStraySections,
  isTruncationOf,
  toUnits,
} from '../../../../supabase/functions/_shared/reports/investment/sectionFolding.pure';

/** The measured shape: two sections written nested and then again standalone. */
const WRITTEN_TWICE = [
  '## Risk Dashboard',
  '',
  'The register below sets out what was retrieved and what remains to be checked.',
  '',
  '| Risk | Level |',
  '| --- | --- |',
  '| Flood | Not assessed |',
  '',
  '### Due Diligence Checklist',
  '',
  '1. Obtain the section 10.7 planning certificate from the council.',
  '2. Commission a building and pest inspection before the cooling-off period ends.',
  '3. Ask a local property manager to confirm the achievable weekly rent.',
  '',
  '### Final Recommendation',
  '',
  'Proceed to contract subject to the checks above being satisfied.',
  '',
  '## Due Diligence Checklist',
  '',
  '- Obtain the section 10.7 planning certificate from the council.',
  '- Commission a building and pest inspection before the cooling-off period ends.',
  '- Ask a local property manager',
  '',
  '## Final Recommendation',
  '',
  'Proceed to contract subject to the checks above being satisfied.',
  '',
  'The purchase price sits inside the range the evidence supports.',
  '',
].join('\n');

const headingsOf = (md: string): string[] =>
  md.split('\n').filter((l) => /^#{1,6}\s+\S/.test(l)).map((l) => l.trim());

describe('a section the model wrote twice is presented once', () => {
  const result = foldStraySections(WRITTEN_TWICE);

  it('names each section it folded, and where the early copy was nested', () => {
    // `Final Recommendation` resolves to `recommendation` — the registry's own
    // id for it, read rather than assumed.
    expect(result.folded.map((f) => f.id).sort())
      .toEqual(['dueDiligenceChecklist', 'recommendation']);
    expect(new Set(result.folded.map((f) => f.from))).toEqual(new Set(['riskDashboard']));
  });

  it('leaves exactly one heading for each of them', () => {
    const headings = headingsOf(result.markdown);
    expect(headings.filter((h) => /Due Diligence Checklist/i.test(h))).toHaveLength(1);
    expect(headings.filter((h) => /Final Recommendation/i.test(h))).toHaveLength(1);
    // And the section they were nested inside keeps its own heading and table.
    expect(headings[0]).toBe('## Risk Dashboard');
    expect(result.markdown).toContain('| Flood | Not assessed |');
  });

  /*
   * The half that matters most. On the document this came from, the NESTED
   * copy was the complete one and the standalone copy carried the truncated
   * item — so a rule that kept the structurally-correct copy would have
   * deleted the better text.
   */
  it('carries the fuller nested copy forward rather than discarding it', () => {
    expect(result.markdown).toContain(
      '3. Ask a local property manager to confirm the achievable weekly rent.',
    );
  });

  it('drops what the other copy already said, across list markers', () => {
    const body = result.markdown;
    expect(body.split('section 10.7 planning certificate')).toHaveLength(2);
    expect(body.split('building and pest inspection')).toHaveLength(2);
    expect(result.folded.find((f) => f.id === 'dueDiligenceChecklist')?.repeated).toBe(3);
  });

  /*
   * The cut-off item, which is the third of the three defects the audit
   * recorded on those pages. `- Ask a local property manager` is the numbered
   * item above it with its second half missing; printing both puts a sentence
   * fragment in a client's checklist.
   */
  it('reads a cut-off item as the truncation it is, not as a fourth obligation', () => {
    const items = result.markdown.split('\n').filter((l) => /property manager/.test(l));
    expect(items).toHaveLength(1);
    expect(items[0]).toBe('3. Ask a local property manager to confirm the achievable weekly rent.');
  });

  it('keeps the list a list', () => {
    expect(result.markdown).toContain([
      '1. Obtain the section 10.7 planning certificate from the council.',
      '2. Commission a building and pest inspection before the cooling-off period ends.',
      '3. Ask a local property manager to confirm the achievable weekly rent.',
    ].join('\n'));
  });

  it('keeps the sentence the standalone copy added', () => {
    expect(result.markdown).toContain('The purchase price sits inside the range the evidence supports.');
  });

  /*
   * Conservation, stated over the units the merge actually compares and over
   * CONTENT rather than headings — removing the nested copy's duplicate
   * heading is the point of the exercise. Every other unit either survives
   * verbatim or is a truncation of one that did.
   */
  it('destroys nothing that is not a repeat or a truncation of one', () => {
    const units = (md: string) => md
      .split(/\n\s*\n/)
      .flatMap(toUnits)
      .filter((u) => !/^#{1,6}\s/.test(u.trim()))
      .map(blockKey)
      .filter((u) => u.length >= 16);
    const after = units(result.markdown);
    for (const unit of units(WRITTEN_TWICE)) {
      const kept = after.includes(unit) || after.some((k) => isTruncationOf(unit, k));
      expect(kept, unit).toBe(true);
    }
  });
});

describe('what it must not touch', () => {
  it('is byte-identical on a document that repeats nothing', () => {
    const clean = [
      '## Risk Dashboard', '', 'A register of what was retrieved.', '',
      '## Due Diligence Checklist', '', '1. Obtain the planning certificate.', '',
      '## Final Recommendation', '', 'Proceed to contract.', '',
    ].join('\n');
    const out = foldStraySections(clean);
    expect(out.markdown).toBe(clean);
    expect(out.folded).toEqual([]);
  });

  it('leaves a nested section that has no counterpart exactly where it is', () => {
    const buried = [
      '## Risk Dashboard', '', 'A register.', '',
      '### Due Diligence Checklist', '', '1. Obtain the planning certificate.', '',
    ].join('\n');
    const out = foldStraySections(buried);
    expect(out.markdown).toBe(buried);
    expect(out.folded).toEqual([]);
  });

  it('does not read a numbered sub-heading as a section, whatever it says', () => {
    const numbered = [
      '## Risk Dashboard', '', 'A register.', '',
      '### 9.1 Due Diligence Checklist', '', 'Sub-structure of the register.', '',
      '## Due Diligence Checklist', '', '1. Obtain the planning certificate.', '',
    ].join('\n');
    expect(foldStraySections(numbered).markdown).toBe(numbered);
  });

  it('does not read a heading inside a fenced block as a heading', () => {
    const fenced = [
      '## Risk Dashboard', '', '```', '### Due Diligence Checklist', '```', '',
      '## Due Diligence Checklist', '', '1. Obtain the planning certificate.', '',
    ].join('\n');
    expect(foldStraySections(fenced).markdown).toBe(fenced);
  });

  it('leaves a section that sub-heads itself alone', () => {
    const selfish = [
      '## Due Diligence Checklist', '', '### Due Diligence Checklist', '', 'Restated.', '',
      '## Final Recommendation', '', 'Proceed.', '',
    ].join('\n');
    expect(foldStraySections(selfish).markdown).toBe(selfish);
  });

  it('never collapses a unit too short to be content', () => {
    expect(blockKey('---').length).toBeLessThan(16);
    expect(blockKey('**Note**').length).toBeLessThan(16);
    expect(isTruncationOf('short', 'short and then some more')).toBe(false);
  });

  it('does not read a word boundary where there is none', () => {
    expect(isTruncationOf('ask a local property', 'ask a local property manager')).toBe(true);
    expect(isTruncationOf('ask a local propert', 'ask a local property manager')).toBe(false);
  });

  it('handles an empty or heading-less document without throwing', () => {
    expect(foldStraySections('').markdown).toBe('');
    expect(foldStraySections('Just prose.').markdown).toBe('Just prose.');
    expect(foldStraySections(null as unknown as string).markdown).toBe('');
  });
});

describe('the 58.6% of the corpus that writes its sections at H1', () => {
  const h1 = [
    '# 9. Risk Dashboard', '', 'A register of what was retrieved.', '',
    '## Due Diligence Checklist', '', '1. Obtain the planning certificate.', '',
    '# 10. Due Diligence Checklist', '', '- Commission a building inspection.', '',
  ].join('\n');

  it('folds at the level the document actually uses', () => {
    const out = foldStraySections(h1);
    expect(out.folded.map((f) => f.id)).toEqual(['dueDiligenceChecklist']);
    expect(headingsOf(out.markdown)).toEqual(['# 9. Risk Dashboard', '# 10. Due Diligence Checklist']);
    expect(out.markdown).toContain('1. Obtain the planning certificate.');
    expect(out.markdown).toContain('- Commission a building inspection.');
  });
});

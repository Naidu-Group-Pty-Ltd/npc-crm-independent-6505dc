/**
 * A composed lead-in is never printed over nothing.
 *
 * The 20 Sep 2026 Compass for 97 Poole Road printed "What these findings
 * mean, and what to do about them." directly above the next register's
 * heading, and so did the Due Diligence report forked from it: the stored
 * document carried the line and none of the entries it opens. See
 * `dropOrphanedLeadIns` in `derivedHygiene.pure.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  COMPOSED_LEAD_INS,
  dropOrphanedLeadIns,
  presentStoredMarkdown,
} from '../../../../supabase/functions/_shared/reports/investment/derivedHygiene.pure';
import {
  ABSENCE_GUIDE,
  INFRASTRUCTURE_GUIDE_LEAD_IN,
} from '../../../../supabase/functions/_shared/planning/infrastructureGuide.pure';
import { renderInfrastructureOutlook } from '../../../../supabase/functions/_shared/planning/infrastructureEvidence.pure';

const LEAD = `**${INFRASTRUCTURE_GUIDE_LEAD_IN}**`;
const ENTRY = `*A register that was not searched.* ${ABSENCE_GUIDE.what}`;

/** The shape the 97 Poole Road document stored. */
const ORPHANED = [
  '### Infrastructure and development retrieved for this property',
  '',
  '**What a status means.** Each status above is the register\'s own word.',
  '',
  LEAD,
  '',
  '### Major public projects near this property',
  '',
  'Searched, nothing recorded.',
].join('\n');

describe('a lead-in with nothing under it', () => {
  it('is dropped before the next heading', () => {
    const out = dropOrphanedLeadIns(ORPHANED);
    expect(out.dropped).toBe(1);
    expect(out.markdown).not.toContain(INFRASTRUCTURE_GUIDE_LEAD_IN);
    expect(out.markdown).toContain('**What a status means.**');
    expect(out.markdown).toContain('### Major public projects near this property');
    expect(out.markdown).not.toMatch(/\n{3,}/);
  });

  it('is dropped at the end of the document, and with its bold already gone', () => {
    expect(dropOrphanedLeadIns(`Text.\n\n${LEAD}\n`).dropped).toBe(1);
    expect(dropOrphanedLeadIns(`Text.\n\n${INFRASTRUCTURE_GUIDE_LEAD_IN}\n\n## Next`).dropped).toBe(1);
  });

  it('is dropped on the read path every renderer applies', () => {
    expect(presentStoredMarkdown(ORPHANED)).not.toContain(INFRASTRUCTURE_GUIDE_LEAD_IN);
  });
});

describe('a lead-in over its entries', () => {
  it('is kept, byte for byte', () => {
    const healthy = `${ORPHANED.split(LEAD)[0]}${LEAD}\n\n${ENTRY}\n\n### Next`;
    const out = dropOrphanedLeadIns(healthy);
    expect(out.dropped).toBe(0);
    expect(out.markdown).toBe(healthy);
  });

  it('is kept over a paragraph it does not recognise, rather than judged', () => {
    const other = `${LEAD}\n\nSome prose the platform did not compose.\n\n## Next`;
    expect(dropOrphanedLeadIns(other).markdown).toBe(other);
  });

  it('is kept by the read path in what the composer writes today', () => {
    const composed = renderInfrastructureOutlook({
      items: [], pipelineDwellings: null, pipelineInvestment: null, registerWalk: null,
      absences: [], programmeStatement: null,
      readings: [{ register: 'development instruments', reading: 'not_searched', note: 'n' }],
      coverageLimits: [], retrievedAt: null, anyEvidenced: false, enrichmentMissing: false,
    } as never);
    expect(composed).toContain(LEAD);
    const read = presentStoredMarkdown(`## Planning controls and development registers\n\n${composed}\n\n## Next\n\nx`);
    expect(read).toContain(INFRASTRUCTURE_GUIDE_LEAD_IN);
    expect(read).toContain('*A register that was not searched.*');
  });

  it('leaves a document that never names one untouched', () => {
    const plain = '## A\n\nText.\n\n### B\n\nMore.';
    expect(dropOrphanedLeadIns(plain)).toEqual({ markdown: plain, dropped: 0 });
  });
});

describe('one spelling', () => {
  it('reads the composer\'s own lead-in', () => {
    expect(COMPOSED_LEAD_INS).toContain(INFRASTRUCTURE_GUIDE_LEAD_IN);
  });
});

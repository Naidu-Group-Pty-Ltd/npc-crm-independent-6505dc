/**
 * Phase 2 adoption — the registry is read, not just declared.
 *
 * `sectionRegistry.spec.ts` proves the constitution is coherent and that every
 * section it declares can be produced. These pins are the other half: that the
 * call sites which used to keep their own copy of the structure now ask it, and
 * that doing so changed the snapshot not at all and the briefing exactly as
 * intended.
 *
 * The briefing is the behaviour change in this phase, so it is measured rather
 * than asserted: the fixture below is the literal heading list of production
 * row `89b451f6` (4 September 2026, the newest briefing and the one Phase 1's
 * own comment names), and the expectations state what the trim does to it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  authoredHeadingsForTier,
  markdownHeadingsForTier,
} from '../investment/sectionRegistry.pure';
import { trimToDeclaredSections } from '../investment/derivedHygiene.pure';

const REPO = resolve(__dirname, '../../../..');
const readFile = (p: string) => readFileSync(resolve(REPO, p), 'utf8');
/**
 * Condensation is two files: the handler and the composition it calls.
 *
 * `condenseCompose.pure.ts` holds the composed sections, the registry trim,
 * the declared-order assembly and the hygiene passes, which used to be 156
 * lines of `index.ts`. A rule about what condensation DOES is satisfied by
 * either, so `read(CONDENSE)` returns both — which also means the next move
 * cannot silently pass.
 */
const CONDENSE = 'supabase/functions/condense-investment-report/index.ts';
const CONDENSE_COMPOSE = 'supabase/functions/_shared/reports/investment/condenseCompose.pure.ts';
const read = (p: string) => (p === CONDENSE ? `${readFile(CONDENSE)}\n${readFile(CONDENSE_COMPOSE)}` : readFile(p));

const doc = (headings: readonly string[]) =>
  headings.map((h) => `## ${h}\n\nBody for ${h}.\n`).join('\n');

const headingsOf = (markdown: string) =>
  [...markdown.matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => m[1]);

// ---------------------------------------------------------------------------
// The snapshot is unchanged — the same nine headings, in the same order
// ---------------------------------------------------------------------------

describe('the snapshot list moved to the registry and did not change', () => {
  /**
   * The array that was typed inline at the trim call site, verbatim from before
   * this phase. If the registry ever stops reproducing it exactly, a snapshot
   * loses or gains a section — so the old list is kept here as the witness
   * rather than deleted with the code that held it.
   */
  const AS_TYPED_INLINE = [
    'Property Summary', 'Key Market Stats', 'Investment Score', 'Score Breakdown',
    'Financial Snapshot', 'Top 3 Opportunities', 'Top 3 Risks', 'Quick Recommendation',
    'Market Data Sources',
  ];

  it('the registry produces the identical list, in the identical order', () => {
    expect(markdownHeadingsForTier('snapshot')).toEqual(AS_TYPED_INLINE);
  });

  it('trims a snapshot to exactly what it did before', () => {
    // A snapshot as production writes them, plus two headings echoed from the
    // parent — the defect Phase 1 fixed for this tier.
    const written = doc([
      'Property Summary', 'Key Market Stats', 'Investment Score',
      'Score Breakdown (simplified)', 'Financial Snapshot', 'Top 3 Opportunities',
      'Top 3 Risks', 'Quick Recommendation', 'Market Data Sources',
      'Location Overview', 'Loan Analysis (P&I and Interest-Only)',
    ]);
    const trimmed = trimToDeclaredSections(written, markdownHeadingsForTier('snapshot'));
    expect(headingsOf(trimmed.markdown)).toEqual([
      'Property Summary', 'Key Market Stats', 'Investment Score',
      'Score Breakdown (simplified)', 'Financial Snapshot', 'Top 3 Opportunities',
      'Top 3 Risks', 'Quick Recommendation', 'Market Data Sources',
    ]);
    expect(trimmed.dropped).toEqual(['Location Overview', 'Loan Analysis (P&I and Interest-Only)']);
  });
});

// ---------------------------------------------------------------------------
// The briefing gains the trim it never had
// ---------------------------------------------------------------------------

describe('the briefing is trimmed to its own structure', () => {
  /** Production row 89b451f6, 2026-09-04 — all 29 H2 headings, in order. */
  const PRODUCTION_BRIEFING = [
    'Location Overview', 'Current Market Performance (Q3/Q4 2025)',
    'Historical Price Growth Table', 'Historical Rent Growth Table', 'Market Activity',
    'Population & Household Characteristics', 'Major Industries & Job Growth',
    'Transport & Accessibility', 'Education Facilities', 'Healthcare & Shopping',
    'Environmental Risks', 'Crime Statistics', 'Property-Level Information',
    'Purchase & Ongoing Costs', 'Base Assumptions', 'Gross & Net Yield Calculation',
    'Loan Analysis (P&I and Interest-Only)', 'Sensitivity Analysis',
    'Property Value Projections', 'Rental Income Projections',
    'Cumulative Cashflow Projections', 'LVR Projections', 'Overall Investment Score',
    'Investment Score Breakdown', 'SWOT Analysis', 'Top 3 Opportunities',
    'Top 3 Risks', 'Investment Recommendations', 'Market Data Sources',
  ];

  /*
   * Twelve, not seventeen, from 18 Sep 2026 (S5/S6 §4, `TIER_FRAMEWORK`
   * Decision F).
   *
   * The five that left are the detailed financial chapters. They contradicted
   * three things this platform already said about the same document:
   * `TIER_CONTENT.briefing.financialModelling: false`, a projection that
   * withholds 32 modelling bindings and drops three master pages, and the
   * companion note the Briefing prints on its own cover — *"the financial
   * position in the Financial Analysis Report"*. Measured on this very row
   * (89b451f6) they composed to 3,156 characters over 73 table rows, four of
   * the five byte-identical to that report's own.
   *
   * The two that remain are the ASSESSMENT — the score breakdown and the
   * SWOT — which is what a Briefing is for, and they are still composed from
   * the record rather than asked of the model.
   */
  it('declares twelve headings — ten authored, two composed and placed', () => {
    const all = markdownHeadingsForTier('briefing');
    const authored = authoredHeadingsForTier('briefing');
    expect(authored).toEqual([
      'Executive Summary', 'Location & Demand', 'Amenity & Access', 'Market Position',
      'Property Fit', 'Risk Overview', 'Top 3 Opportunities', 'Top 3 Risks',
      'Recommendation', 'Market Data Sources',
    ]);
    expect(all).toHaveLength(12);
    // The rest are composed from the record after the model call.
    expect(all.filter((h) => !authored.includes(h))).toEqual([
      'Investment Score Breakdown',
      'SWOT Analysis',
    ]);
    // And the modelling is declared by NO briefing heading, asserted by name
    // rather than by the count above — a count can be satisfied by a swap.
    for (const gone of [
      'Purchase Costs & Annual Holding Cost Breakdown',
      'Rental Assessment, Gross Yield & Net Yield',
      'Loan Structure, Repayments & Cashflow Impact',
      'Sensitivity & Scenario Testing',
      '10-Year Cashflow, Equity & Growth Projection',
    ]) expect(all, gone).not.toContain(gone);
  });

  it('keeps every section a correctly-written briefing carries', () => {
    const written = doc(markdownHeadingsForTier('briefing'));
    const trimmed = trimToDeclaredSections(written, markdownHeadingsForTier('briefing'));
    expect(trimmed.dropped).toEqual([]);
    expect(headingsOf(trimmed.markdown)).toEqual(markdownHeadingsForTier('briefing'));
  });

  it('drops the parent\'s structure from the briefing production actually shipped', () => {
    const trimmed = trimToDeclaredSections(
      doc(PRODUCTION_BRIEFING),
      markdownHeadingsForTier('briefing'),
    );
    // Five of twenty-nine survive: everything else is the Compass parent's own
    // headings, echoed into a document that declares nine of its own.
    expect(headingsOf(trimmed.markdown)).toEqual([
      'Investment Score Breakdown', 'SWOT Analysis', 'Top 3 Opportunities',
      'Top 3 Risks', 'Market Data Sources',
    ]);
    expect(trimmed.dropped).toHaveLength(24);
    expect(trimmed.dropped).toContain('Location Overview');
    expect(trimmed.dropped).toContain('Historical Price Growth Table');
    // Including the financial tables — which the new pipeline composes from the
    // record and appends under the declared headings instead.
    expect(trimmed.dropped).toContain('Loan Analysis (P&I and Interest-Only)');
  });
});

// ---------------------------------------------------------------------------
// The safety valve
// ---------------------------------------------------------------------------

describe('a trim that would empty the prose is refused', () => {
  /** The guard as the edge function computes it. */
  const authoredSurvives = (markdown: string, tier: 'briefing' | 'snapshot') => {
    const authored = authoredHeadingsForTier(tier).map((h) => h.toLowerCase());
    return headingsOf(markdown)
      .map((h) => h.toLowerCase().replace(/\s+/g, ' ').trim())
      .some((h) => authored.some((a) => h === a || h.startsWith(`${a} `)));
  };

  it('a composed chapter alone does not count as the model having written anything', () => {
    // This is why the guard asks about authored headings and not about `##`:
    // the composed chapters are appended by us and always match, so a document
    // whose prose was entirely discarded would otherwise look healthy.
    const composedOnly = doc([
      'Purchase Costs & Annual Holding Cost Breakdown',
      'Rental Assessment, Gross Yield & Net Yield',
      '10-Year Cashflow, Equity & Growth Projection',
    ]);
    expect(headingsOf(composedOnly)).toHaveLength(3);
    expect(authoredSurvives(composedOnly, 'briefing')).toBe(false);
  });

  it('one surviving authored section is enough', () => {
    expect(authoredSurvives(doc(['Risk Overview']), 'briefing')).toBe(true);
    // The guide's own qualified spelling still matches, as the trim does.
    expect(authoredSurvives(doc(['Top 3 Opportunities']), 'snapshot')).toBe(true);
  });

  it('a snapshot of nothing but its composed sections has not survived either', () => {
    // `Score Breakdown` used to be this tier's example of a qualified authored
    // heading. It is composed from the record now, along with `Investment
    // Score` and `Financial Snapshot` — so, exactly like the briefing's
    // chapters above, a document containing only those three is our own output
    // and says nothing about whether the model followed the guide.
    const composedOnly = doc(['Investment Score', 'Score Breakdown', 'Financial Snapshot']);
    expect(headingsOf(composedOnly)).toHaveLength(3);
    expect(authoredSurvives(composedOnly, 'snapshot')).toBe(false);
  });

  it('the edge function keeps the untrimmed text in that state', () => {
    const src = read(CONDENSE);
    expect(src).toContain('authoredHeadingsForTier');
    expect(src).toMatch(/if \(keptAny\) \{/);
    expect(src).toContain('hygiene.sections_trim_skipped');
  });
});

// ---------------------------------------------------------------------------
// The dead declarations are gone, and the guide asks for what the tier promises
// ---------------------------------------------------------------------------

describe('the condense function keeps no structure of its own', () => {
  const src = () => read(CONDENSE);

  it('TIER_CONFIG no longer declares sections or a content ratio', () => {
    const config = src().slice(src().indexOf('const TIER_CONFIG'), src().indexOf('structureGuide'));
    // Both were read by nothing, and the snapshot's copy disagreed with the
    // guide beside it: `Top Opportunities & Risks` and `Recommendation` against
    // the guide's `Top 3 Opportunities`, `Top 3 Risks` and `Quick
    // Recommendation`. A structure a reader trusts and no code consults.
    expect(config).not.toContain('contentRatio');
    expect(config).not.toMatch(/^\s*sections: \[/m);
    // As a string literal — the comment above TIER_CONFIG names it in
    // backticks, because the record of what was wrong is worth keeping.
    expect(src()).not.toContain("'Top Opportunities & Risks'");
  });

  it('both trims read the registry rather than a literal', () => {
    const s = src();
    /**
     * Read as a SHAPE, not as a name. This pinned the literal
     * `markdownHeadingsForTier(targetTier)`, and moving the trim into
     * `condenseCompose.pure.ts` — where the tier is a parameter called
     * `tier` — failed a rule about WHICH registry the trim consults over what
     * somebody had called a variable. What has to hold is both halves of the
     * title: the list comes from the registry, and it is asked for the tier
     * the run is PRODUCING. So the argument must be a bare identifier — never
     * a quoted tier name, which would trim every briefing to a snapshot's
     * sections however the run was started.
     */
    expect(s).toMatch(/markdownHeadingsForTier\(\s*[A-Za-z_$][\w$]*\s*\)/);
    expect(s).not.toMatch(/markdownHeadingsForTier\(\s*['"]/);
    // The inline nine are gone.
    expect(s).not.toContain("'Property Summary', 'Key Market Stats'");
  });

  it('the briefing guide asks for the sources section its tier promises', () => {
    // `provenance` is spine — mandatory in every tier — and the Phase 1 re-cut
    // left the briefing without it. The registry's producibility check is what
    // said so.
    const s = src();
    const briefing = s.slice(s.indexOf('briefing: {'), s.indexOf('snapshot: {'));
    expect(briefing).toContain('## Market Data Sources');
    expect(briefing).toContain('WRITE ONLY THE SECTIONS ABOVE');
  });
});

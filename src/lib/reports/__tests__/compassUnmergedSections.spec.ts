/**
 * W2.2 — Infrastructure and Supply are sections, and the generator writes them.
 *
 * ## The failure this file exists to make impossible
 *
 * The programme's acceptance for W2.2 reads: *`sectionsForTier('compass')`
 * returns both; the contents page lists them; `documentPlacement` seats them
 * at their declared order.* Every one of those is a statement about
 * `sectionRegistry.pure.ts`.
 *
 * The generator does not read that file. `generate-investment-report` builds
 * its section list, its per-section prompt and its `total_sections` from
 * `compassSectionRegistry.ts`, and the only thing holding the two together was
 * `sectionRegistry.spec.ts`'s
 *
 *     it('every Compass section is a registry placement on the compass tier')
 *
 * which asserts `compassSections() ⊆ sectionsForTier('compass')` and says
 * nothing about the other direction. So a W2.2 that changed the pure registry
 * alone would have satisfied all three stated criteria, turned every suite
 * green, listed two sections on the contents page — and **the generator would
 * never have authored a word of either**. That is the unmounted-mechanism
 * defect this repository has now found in a component, a CSS class, a cron
 * job, a gate and a validator; here it would have been a section.
 *
 * The converse pin below is the half that was missing. Everything else in this
 * file is the rest of the move: that the two carriers stopped asking for what
 * they gave up, that each new section has a register behind it, and that no
 * heading is claimed twice.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  COMPASS_40_SECTIONS,
  PROTECTED_SECTION_IDS,
  compassSections,
} from '@/lib/reports/compassSectionRegistry';
import { sectionsForTier } from '../investment/sectionRegistry.pure';

const REPO = resolve(__dirname, '../../../..');
const read = (p: string) => readFileSync(resolve(REPO, p), 'utf8');

const GENERATOR = 'supabase/functions/generate-investment-report/index.ts';

const INFRASTRUCTURE = 'Infrastructure and Growth Context';
const SUPPLY = 'Competitive Landscape and Supply Pipeline';

const purposeOf = (id: string): string => {
  const s = COMPASS_40_SECTIONS.find((x) => x.id === id);
  expect(s, `no Compass section called ${id}`).toBeTruthy();
  return s!.purpose;
};

/** The Compass placements the GENERATOR is responsible for writing. */
const authoredCompassPlacements = (): Array<{ label: string; order: number }> =>
  sectionsForTier('compass')
    .filter((s) =>
      s.placement.producer?.kind === 'authored' &&
      s.placement.producer.ref === 'generator.compass')
    .map((s) => ({ label: s.label, order: s.order }))
    .sort((a, b) => a.order - b.order);

// ---------------------------------------------------------------------------
// The pin that was one-directional
// ---------------------------------------------------------------------------

describe('a section the constitution says the generator authors is one the generator writes', () => {
  it('names the same sections in both registries, in both directions', () => {
    const declared = authoredCompassPlacements().map((p) => p.label);
    const produced = compassSections().map((s) => s.name);

    // The direction `sectionRegistry.spec.ts` already held.
    for (const name of produced) {
      expect(declared, `the generator writes "${name}" and the compass tier does not declare it`)
        .toContain(name);
    }
    // The direction nothing held, and the one W2.2 could have been faked in.
    for (const label of declared) {
      expect(produced, `the compass tier declares "${label}" and the generator never writes it`)
        .toContain(label);
    }
  });

  it('agrees on the ORDER, not merely the set', () => {
    // The contents page is built from the pages that rendered and the seating
    // is built from the declared order. Two registries that agree on WHICH
    // sections exist and disagree on where they go produce a document whose
    // contents page is a different document.
    expect(authoredCompassPlacements().map((p) => p.label))
      .toEqual(compassSections().map((s) => s.name));
  });

  it('gives each of the two un-merged sections a declared, authored placement', () => {
    const declared = authoredCompassPlacements();
    for (const label of [INFRASTRUCTURE, SUPPLY]) {
      const placement = declared.find((p) => p.label === label);
      expect(placement, `${label} has no authored placement on the compass tier`).toBeTruthy();
    }
    // Where they sit is the reading order a purchaser needs: the location
    // case, then what is committed to it; the market, then what will compete
    // in it.
    const labels = declared.map((p) => p.label);
    expect(labels.indexOf(INFRASTRUCTURE)).toBe(labels.indexOf('Why This Location Matters') + 1);
    expect(labels.indexOf(SUPPLY)).toBe(labels.indexOf('Market Positioning') + 1);
  });
});

// ---------------------------------------------------------------------------
// The carriers stopped asking for what they gave up
// ---------------------------------------------------------------------------

describe('what left a section is not still requested by it', () => {
  /*
   * A_PREMIUM_DOCUMENT.md §16: the 97 Poole Road Compass carried `Exit
   * Outlook` and `Monitoring Plan` twice, and the two copies CONTRADICTED each
   * other, because `strategySectionRules` named sections the model was never
   * shown. A prompt that still asks for a subject now owned by the section
   * after it produces exactly that.
   *
   * The literals below are the instructions that were removed, quoted from the
   * pre-W2.2 file. They are asserted as ABSENT forms rather than by scanning
   * for a bare word, because both carriers now NAME the section that took the
   * subject — and a guard that cannot tell a hand-off from the thing it hands
   * off is the guard `NATIONAL_PIPELINE_COVERAGE_PHRASE` had to be rewritten
   * for.
   */
  it('Why This Location Matters no longer asks for the infrastructure pipeline', () => {
    const purpose = purposeOf('compass.whyLocationMatters');
    expect(purpose).not.toContain('the staged infrastructure pipeline');
    expect(purpose).not.toContain('Each infrastructure item carries a confidence chip');
    expect(purpose).toContain(INFRASTRUCTURE);
    expect(purpose).toContain('is not written here');
  });

  it('Demand Drivers no longer asks for the supply pipeline', () => {
    const purpose = purposeOf('compass.demandDrivers');
    expect(purpose).not.toContain('household formation, the supply pipeline,');
    expect(purpose).toContain(SUPPLY);
    expect(purpose).toContain('is not written here');
  });

  it('Market Positioning no longer asks for the competing supply', () => {
    const purpose = purposeOf('compass.marketPositioning');
    expect(purpose).not.toContain('owner-occupier appeal, comparable supply, demand signals');
    expect(purpose).toContain(SUPPLY);
    expect(purpose).toContain('is not written here');
  });

  it('draws the infrastructure timeline in exactly one section', () => {
    const owners = COMPASS_40_SECTIONS
      .filter((s) => s.visualComponents.includes('infrastructureTimeline'))
      .map((s) => s.id);
    expect(owners).toEqual(['compass.infrastructure']);
  });
});

// ---------------------------------------------------------------------------
// A heading belongs to exactly one section
// ---------------------------------------------------------------------------

describe('one heading, one section', () => {
  /*
   * `buildRoutingTable` upserts into a Map keyed on the lower-cased heading,
   * so a heading claimed twice resolves to whichever section is declared LAST
   * and the earlier claim disappears with nothing said. `Supply & Development
   * Pipeline` was claimed by Demand Drivers here and by `infrastructure` in
   * the pure registry at the same time — two registries disagreeing about one
   * heading — which is what W2.2 settled.
   *
   * A RATCHET, not a ban: two collisions predate this and both resolve to the
   * section a reader would expect, so freezing them is cheaper than changing
   * how a legacy document routes. Anything new fails.
   */
  const KNOWN_COLLISIONS: ReadonlyArray<string> = [
    'investment recommendation',   // executiveVerdict → finalRecommendation
    'property-level information',  // propertyLocalitySnapshot → propertyFit
  ];

  it('claims no source heading in two Compass sections', () => {
    const claims = new Map<string, string[]>();
    for (const section of COMPASS_40_SECTIONS) {
      for (const heading of section.sourceHeadings) {
        const key = heading.toLowerCase().trim();
        claims.set(key, [...(claims.get(key) ?? []), section.id]);
      }
    }
    const collisions = [...claims].filter(([, ids]) => ids.length > 1).map(([k]) => k).sort();
    expect(collisions).toEqual([...KNOWN_COLLISIONS].sort());
  });

  it('gives the two pipeline headings to the section that is about them', () => {
    const owner = (heading: string) =>
      COMPASS_40_SECTIONS.find((s) =>
        s.sourceHeadings.some((h) => h.toLowerCase() === heading.toLowerCase()),
      )?.id;
    expect(owner('Supply & Development Pipeline')).toBe('compass.supplyPipeline');
    expect(owner('Future Infrastructure')).toBe('compass.infrastructure');
    expect(owner('Infrastructure & Development')).toBe('compass.infrastructure');
  });
});

// ---------------------------------------------------------------------------
// Each new section has a register behind it
// ---------------------------------------------------------------------------

describe('neither section is one with nothing behind it', () => {
  /*
   * `sectionRegistry.pure.ts`'s own rule, and the reason the ordering note in
   * REPORT_PRESENTATION_PROGRAMME.md held W2.2 back: *a section with nothing
   * behind it should be merged; a section with a register behind it should
   * not.* Both registers answer now and both are PINNED, so the evidence
   * cannot be trimmed out from under the section that explains it.
   */
  it('pins the infrastructure and approvals evidence into every section call', () => {
    const generator = read(GENERATOR);
    const pinned = generator.slice(
      generator.indexOf('const pinnedPlanningContext = ['),
      generator.indexOf('const pinnedPlanningContext = [') + 6000,
    );
    expect(pinned).toContain('infrastructureTable');
    expect(pinned).toContain('approvalsFactBlocks(');
  });
});

// ---------------------------------------------------------------------------
// The protected list is the field, not a copy of it
// ---------------------------------------------------------------------------

describe('a section declared Protected is protected', () => {
  /*
   * Measured 22 Sep 2026, before this change: FOUR sections declared
   * `sectionPriority: 'Protected'` and were missing from the hand-written
   * `PROTECTED_SECTION_IDS` the post-processor actually reads — among them
   * `compass.planningConstraints`, the largest section in the document, whose
   * eleven-row overlay register `capListsToTop5` was free to cut to five.
   */
  it('has no section the field protects and the set does not', () => {
    const declared = COMPASS_40_SECTIONS
      .filter((s) => s.sectionPriority === 'Protected')
      .map((s) => s.id);
    for (const id of declared) {
      expect([...PROTECTED_SECTION_IDS], `${id} declares Protected and is not in the set`)
        .toContain(id);
    }
    expect([...PROTECTED_SECTION_IDS].sort()).toEqual([...declared].sort());
  });
});

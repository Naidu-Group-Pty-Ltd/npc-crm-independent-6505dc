/**
 * The two Compass registries must not drift.
 *
 * `supabase/functions/_shared/compassSectionRegistry.ts` and
 * `src/lib/reports/compassSectionRegistry.ts` are duplicated by design — edge
 * functions cannot import from `src/` — and the header of each has said "KEEP
 * THE TWO FILES IN SYNC" since they were written. Nothing checked, and they
 * drifted to 672 lines against 174. `docs/reports/DESIGN_SYSTEM.md:111` records
 * that as the cautionary case two other domains cite for using `export *`
 * bridges instead.
 *
 * A bridge is not available here, so this is the check. It compares the shared
 * exports field by field rather than comparing file text: the two files are
 * legitimately different below `COMPASS_FINANCIAL_HANDOFF_COPY` — the edge copy
 * keeps `HEADING_ROUTING`/`routeHeading`, the frontend copy keeps
 * `normaliseReportTier`/`sectionCountForTier` — so a byte comparison would fail
 * on a difference that is meant to be there.
 *
 * The edge file is read through a relative path rather than the `@/` alias
 * because it must stay parseable by Deno, which is why it carries `.ts` import
 * extensions and cannot be aliased.
 */
import { describe, expect, it } from 'vitest';

import {
  COMPASS_40_SECTIONS as EDGE_COMPASS,
  COMPASS_PAGE_BAND as EDGE_BAND,
  COMPASS_WORD_CAPS as EDGE_CAPS,
  EDITORIAL_LABELS as EDGE_LABELS,
  FINANCIAL_ANALYSIS_SECTIONS as EDGE_FINANCIAL,
  PAGE_PRESSURE_TRIM_ORDER as EDGE_TRIMS,
  PROTECTED_SECTION_IDS as EDGE_PROTECTED,
} from '../../../../supabase/functions/_shared/compassSectionRegistry.ts';
import {
  COMPASS_40_SECTIONS,
  COMPASS_PAGE_BAND,
  COMPASS_WORD_CAPS,
  EDITORIAL_LABELS,
  FINANCIAL_ANALYSIS_SECTIONS,
  PAGE_PRESSURE_TRIM_ORDER,
  PROTECTED_SECTION_IDS,
} from '../compassSectionRegistry';

describe('compass registry parity', () => {
  it('has the same Compass sections, field for field', () => {
    expect(COMPASS_40_SECTIONS).toEqual(EDGE_COMPASS);
  });

  it('has the same Financial Analysis sections', () => {
    expect(FINANCIAL_ANALYSIS_SECTIONS).toEqual(EDGE_FINANCIAL);
  });

  it('agrees on the page band, the word caps and the trim order', () => {
    expect(COMPASS_PAGE_BAND).toEqual(EDGE_BAND);
    expect(COMPASS_WORD_CAPS).toEqual(EDGE_CAPS);
    expect(PAGE_PRESSURE_TRIM_ORDER).toEqual(EDGE_TRIMS);
  });

  it('agrees on the protected ids and the forbidden editorial labels', () => {
    expect([...PROTECTED_SECTION_IDS].sort()).toEqual([...EDGE_PROTECTED].sort());
    expect(EDITORIAL_LABELS).toEqual(EDGE_LABELS);
  });
});

describe('the Compass structure the v4.0 brief asked for', () => {
  it('is sixteen client-facing sections plus back matter', () => {
    // 15 until W2.2 (22 Sep 2026), which gave `Infrastructure and Growth
    // Context` and `Competitive Landscape and Supply Pipeline` sections of
    // their own. Both had been merged for the right reason — a section with
    // nothing behind it should be merged — and both now have a register
    // behind them, which is the other half of the same rule.
    expect(COMPASS_40_SECTIONS).toHaveLength(17);
    expect(COMPASS_40_SECTIONS.at(-1)?.id).toBe('compass.disclaimer');
  });

  it('gives zoning and planning a section of their own', () => {
    /*
     * The owner's review of the 17 Sep 2026 Compass: "the Zoning, Planning and
     * Infrastructure sections are simply not good enough".
     *
     * They had no section. 'Zoning' and 'Planning' were sourceHeadings of the
     * RISK DASHBOARD, whose own purpose says "the table IS the section — no
     * prose restating rows", so a retrieved planning control had nowhere to be
     * explained and the reader got a row in a risk table.
     */
    const planning = COMPASS_40_SECTIONS.find((s) => s.id === 'compass.planningConstraints');
    expect(planning).toBeDefined();
    expect(planning!.includeInCompass).toBe(true);
    expect(planning!.sectionPriority).toBe('Protected');
    expect(planning!.maxWordCount).toBeGreaterThanOrEqual(800);
    const risk = COMPASS_40_SECTIONS.find((s) => s.id === 'compass.riskDashboard');
    expect(risk!.sourceHeadings).not.toContain('Zoning');
    expect(risk!.sourceHeadings).not.toContain('Planning');
  });

  it('routes every heading to exactly one section', () => {
    // A heading in TWO sections resolves to whichever comes first and the
    // other silently loses it. Two legacy aliases are grandfathered: they
    // predate the split and the partition has always resolved them first-wins.
    const GRANDFATHERED = new Set(['property-level information', 'investment recommendation']);
    const owner = new Map<string, string>();
    const clashes: string[] = [];
    for (const section of COMPASS_40_SECTIONS) {
      for (const heading of section.sourceHeadings) {
        const key = heading.toLowerCase();
        if (owner.has(key) && !GRANDFATHERED.has(key)) clashes.push(`${heading}: ${owner.get(key)} vs ${section.id}`);
        owner.set(key, section.id);
      }
    }
    expect(clashes).toEqual([]);
  });

  it('drops the Client Reading Guide, which duplicated the contents page', () => {
    expect(COMPASS_40_SECTIONS.map((s) => s.id)).not.toContain('compass.readingGuide');
  });

  it('carries the two merged sections and not the six they replace', () => {
    const ids = COMPASS_40_SECTIONS.map((s) => s.id);
    expect(ids).toContain('compass.demandDrivers');
    expect(ids).toContain('compass.amenityAccess');
    for (const gone of [
      'compass.populationHousingDemand',
      'compass.tenantBuyerProfile',
      'compass.employmentEconomic',
      'compass.educationFamilyAmenity',
      'compass.retailHealthLifestyle',
      'compass.transportConnectivity',
    ]) {
      expect(ids).not.toContain(gone);
    }
  });

  it('keeps every legacy source heading SOMEWHERE, so no fork loses content', () => {
    // reportSplitRegistry routes the derived FIN/PLDD variants by heading, and
    // fork-investment-report drops an unmatched heading from both silently.
    // The rule is that the heading is still ROUTABLE — not which section holds
    // it, which is what v4.0 changed when Transport, Environment and Planning
    // were split back out of the merges.
    const everyHeading = new Set(
      COMPASS_40_SECTIONS.flatMap((s) => s.sourceHeadings.map((h) => h.toLowerCase())),
    );
    for (const heading of [
      'Population & Housing Demand',
      'Tenant & Buyer Profile',
      'Employment & Economic Linkages',
      'Education & Family Amenity',
      'Retail, Healthcare & Lifestyle Amenity',
      'Transport & Connectivity',
      'Transport & Accessibility',
      'Environmental Risks & Climate',
      'Crime & Safety',
      'Zoning & Planning Analysis',
    ]) {
      expect(everyHeading, heading).toContain(heading.toLowerCase());
    }
  });

  it('has page budgets that land inside the band they declare', () => {
    const budget = COMPASS_40_SECTIONS.reduce((sum, s) => sum + s.pageBudget, 0);
    // The v2.0 failure was a 45-page budget under a 38-42 band: the band could
    // not be met even if every section hit its own target exactly.
    expect(budget).toBeGreaterThanOrEqual(COMPASS_PAGE_BAND.min);
    expect(budget).toBeLessThanOrEqual(COMPASS_PAGE_BAND.max);
  });

  it('has a word budget consistent with the page budget', () => {
    const words = COMPASS_40_SECTIONS.reduce((sum, s) => sum + s.maxWordCount, 0);
    /*
     * v2.0 declared 9,170 words and produced about 21,000 — the failure this
     * budget exists to stop. v3.0 cut to ~5,010 and the document came out at
     * 38,648 characters, which the owner's 17 Sep review called "simply not
     * good enough" against a legacy report of ~110,000 characters across 27
     * sections in one pass.
     *
     * v4.0 is 8,150 across 15 sections against a 34-page budget — about 240
     * words a page, which is what a page carrying a table or a figure holds.
     * The ceiling is what the retrieved evidence can carry honestly, not a
     * target: a section still writes what it has and stops.
     */
    expect(words).toBeGreaterThan(7_000);
    expect(words).toBeLessThan(9_170);
    const pages = COMPASS_40_SECTIONS.reduce((sum, s) => sum + s.pageBudget, 0);
    expect(Math.round(words / pages)).toBeLessThan(300);
  });

  it('names every protected section', () => {
    const ids = new Set(COMPASS_40_SECTIONS.map((s) => s.id));
    for (const id of PROTECTED_SECTION_IDS) expect(ids).toContain(id);
  });

  it('has no duplicate ids, ordinals or names', () => {
    const ids = COMPASS_40_SECTIONS.map((s) => s.id);
    const ordinals = COMPASS_40_SECTIONS.map((s) => s.ordinal);
    const names = COMPASS_40_SECTIONS.map((s) => s.name.toLowerCase());
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ordinals).size).toBe(ordinals.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it('no longer offers a decision box to the prompt builder', () => {
    for (const section of [...COMPASS_40_SECTIONS, ...FINANCIAL_ANALYSIS_SECTIONS]) {
      expect(section).not.toHaveProperty('allowDecisionBox');
      expect(section.visualComponents).not.toContain('decisionBox');
    }
  });

  it('does not describe the writing style it is removing', () => {
    // A `purpose` string is fed verbatim into the model prompt, so a stray
    // "What this means" in one would reintroduce exactly what this change removes.
    for (const section of COMPASS_40_SECTIONS) {
      for (const label of EDITORIAL_LABELS) {
        expect(section.purpose.toLowerCase()).not.toContain(`**${label}**`);
      }
    }
  });
});

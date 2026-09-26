/**
 * W3.6 — coverage travels, with a jurisdiction dimension.
 *
 * The rule, in the programme's own words: *a Western Australian property must
 * read "no state planning register is loaded for Western Australia", never
 * "no overlays".* The five absences already existed (`not_served`,
 * `not_integrated`, `licence_restricted`, `none_at_point`, `unavailable`) and
 * so did the per-jurisdiction sentences. What did not exist was anything that
 * could tell you a jurisdiction had been FORGOTTEN — and one had.
 *
 * `NO_STATE_LAYER_NOTE` is a `Partial<Record<PlanningJurisdiction, string>>`,
 * correctly: a jurisdiction whose overlays this platform reads in full needs
 * no such note. A `Partial` record is also exactly the shape that lets one go
 * missing, and the Australian Capital Territory did. Its ZONE is read, so it
 * never looked unserved; its overlay registers have no branch at all, so the
 * page fell through to the generic sentence — the same words a transport
 * failure produces, naming neither the territory nor the remedy.
 *
 * These tests run the REAL composer over all eight jurisdictions rather than
 * asserting the map's contents, because the defect was never in the map: it
 * was in what a page says when the map has no entry.
 */
import { describe, expect, it } from 'vitest';

import {
  NO_STATE_LAYER_NOTE,
  OVERLAY_COVERAGE,
  VERIFICATION_DOCUMENT,
} from '@/lib/reports/../../../supabase/functions/_shared/planning/planningControlGuide.pure';
import {
  buildPlanningFacts,
  renderConstraintRegister,
} from '@/lib/reports/../../../supabase/functions/_shared/planning/planningFacts.pure';
import { programmeCoverageNote, PROGRAMME_PUBLISHERS }
  from '@/lib/reports/../../../supabase/functions/_shared/planning/investmentProgramme.pure';

/** Every jurisdiction a property in this country can be in. */
const JURISDICTIONS = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT'] as const;

/**
 * A reading where no overlay register answered.
 *
 * This is the state every `not_read` jurisdiction is always in, and the state
 * every other one falls into when its registers are unreachable.
 */
function nothingAsked(jurisdiction: string): string {
  return renderConstraintRegister(buildPlanningFacts({
    planningData: {
      fetchedAt: '2026-09-22T00:00:00.000Z',
      jurisdiction,
      coordinate: { latitude: -35.28, longitude: 149.13 },
      constraints: [],
      constraintsAsked: [],
      constraintRegisters: { answered: [], unavailable: [] },
    },
  }));
}

/*
 * An absence may not be rated, and never as a strength either — §9 of
 * `PLANNING_CONTROLS_IN_THE_REPORT.md`. The words are the ones that document
 * actually printed over an unsearched register.
 *
 * Scoped to the ABSENCE STATEMENT rather than to the whole page, and that
 * bound was found by execution rather than chosen: Queensland's remedy
 * sentence says *"a **limited** certificate states the zone and the
 * overlays"*, which is the certificate's own statutory name. The rule
 * forbids rating an absence; it does not forbid a jurisdiction's legal
 * vocabulary, and rewording a statute to satisfy a regex would make the
 * remedy wrong to satisfy a guard.
 */
const RATING_WORDS = /\b(low|minimal|limited|negligible|favourable|favorable|strong|weak|poor|good|clean|clear of)\b/i;

/**
 * A rating anywhere on the page, in the shapes a rating actually takes.
 *
 * A level in a table cell or a bold run, or a level applied to a risk noun.
 * Prose containing one of those words is not a rating — that distinction is
 * what `RATING_WORDS`' scope exists for — but a cell reading `| Low |` is
 * one however it got there.
 */
const RATING_SHAPES = new RegExp(
  '(\\|\\s*(?:low|minimal|limited|negligible|favourable|strong|weak|poor)\\s*\\|)'
  + '|(\\*\\*\\s*(?:low|minimal|limited|negligible|favourable|strong|weak|poor)\\s*\\*\\*)'
  + '|((?:risk|exposure|hazard|constraint)s?\\b[^.]{0,24}?\\b(?:low|minimal|negligible|favourable)\\b)',
  'i',
);

/** Sentences that would state a fact about the land from a fact about us. */
const CLAIMS_NO_CONTROL =
  /\b(no (?:overlay|overlays|hazard|constraint|control)s? (?:appl|affect|cover)|not affected by|free of|unconstrained)/i;

describe('every jurisdiction has a coverage statement of its own', () => {
  it('declares what is read of all eight, with no jurisdiction unnamed', () => {
    for (const j of JURISDICTIONS) {
      expect(OVERLAY_COVERAGE[j], j).toBeDefined();
      expect(VERIFICATION_DOCUMENT[j], j).toBeTruthy();
    }
    expect(Object.keys(OVERLAY_COVERAGE).sort()).toEqual([...JURISDICTIONS].sort());
  });

  it('anything not read in full owes a note — the invariant that caught the ACT', () => {
    for (const j of JURISDICTIONS) {
      if (OVERLAY_COVERAGE[j] === 'state_layers_read') continue;
      expect(NO_STATE_LAYER_NOTE[j], `${j} is ${OVERLAY_COVERAGE[j]} and has no note`).toBeTruthy();
    }
  });

  it('and a jurisdiction read in full carries no such note', () => {
    // A note saying "not integrated" beside a register that answered is a
    // false limitation, and a false limitation teaches a reader to discount
    // the true ones — `coverageLimitsFor`'s own rule.
    for (const j of JURISDICTIONS) {
      if (OVERLAY_COVERAGE[j] !== 'state_layers_read') continue;
      expect(NO_STATE_LAYER_NOTE[j], j).toBeUndefined();
    }
  });
});

describe('a page with no overlay reading names its own jurisdiction', () => {
  for (const j of JURISDICTIONS) {
    it(`${j} — says which register was not read, and never that none applies`, () => {
      const page = nothingAsked(j);
      expect(page.length, j).toBeGreaterThan(40);

      // It must say something happened to the RETRIEVAL, not to the land.
      expect(page, j).toMatch(/not (?:retrieved|integrated|read|reached)|has not been read|nothing here says/i);
      expect(page, j).not.toMatch(CLAIMS_NO_CONTROL);
      expect(page, j).not.toMatch(RATING_SHAPES);
      // The absence statement itself carries no level, whatever the remedy
      // beneath it has to call a certificate.
      expect(NO_STATE_LAYER_NOTE[j] ?? '', j).not.toMatch(RATING_WORDS);

      // And it must name what settles it, so the absence has a remedy.
      expect(page, j).toContain(VERIFICATION_DOCUMENT[j].slice(0, 24));
    });
  }

  it('a jurisdiction with its own note names its own planning instrument', () => {
    /*
     * The generic fallback is honest and anonymous: it says a register was not
     * reached without saying which, so a Western Australian reader and a
     * Tasmanian reader whose registers timed out get identical words. Where a
     * jurisdiction is KNOWN not to be read, its own sentence must reach the
     * page instead.
     */
    for (const j of JURISDICTIONS) {
      const note = NO_STATE_LAYER_NOTE[j];
      if (!note) continue;
      expect(nothingAsked(j), j).toContain(note);
    }
  });

  it('the Australian Capital Territory is no longer anonymous', () => {
    // The defect this file was written for, named rather than described.
    const act = nothingAsked('ACT');
    expect(act).toContain('Australian Capital Territory');
    expect(act).toContain('Territory Plan');
    // Its zone IS read, so the sentence may not claim otherwise.
    expect(act).not.toMatch(/no zon(?:e|ing) (?:layer )?(?:was|is)/i);
  });

  it('distinguishes a register never integrated from one that answered nothing', () => {
    /*
     * The two causes of an empty reading. `OVERLAY_COVERAGE` is what draws
     * this line, and reading the note map alone could not: a missing entry
     * meant "read in full" and "forgotten" indistinguishably.
     *
     * Telling a reader "not yet integrated" about a register that normally
     * answers is a false limitation, and a false limitation teaches them to
     * discount the true ones.
     */
    const integrated = nothingAsked('NSW');
    const never = nothingAsked('SA');
    expect(integrated).not.toBe(never);
    // The reader's words since 25 Sep 2026: a map that is normally read and
    // answered nothing "could not be confirmed"; one this report never reads
    // is "not covered by this report". Still two sentences.
    expect(integrated).toMatch(/could not be confirmed for the property/i);
    expect(integrated).toMatch(/unchecked rather than clear/i);
    expect(integrated).not.toMatch(/not covered by this report/i);
    expect(never).toMatch(/not covered by this report/i);
  });

  it('an unknown jurisdiction still refuses to state a finding about the land', () => {
    const page = nothingAsked('ZZ');
    expect(page).toMatch(/nothing here says/i);
    expect(page).not.toMatch(CLAIMS_NO_CONTROL);
    expect(page).not.toMatch(RATING_WORDS);
    expect(page).not.toMatch(RATING_SHAPES);
  });
});

describe('the forward programme carries the same dimension', () => {
  it('names a publisher and a programme for all eight, and rates no absence', () => {
    for (const j of JURISDICTIONS) {
      expect(PROGRAMME_PUBLISHERS[j], j).toBeDefined();
      const note = programmeCoverageNote(j);
      expect(note, j).toContain(PROGRAMME_PUBLISHERS[j].publisher.slice(0, 18));
      expect(note, j).not.toMatch(RATING_WORDS);
      expect(note, j).not.toMatch(/publishes no|has no (?:forward |relevant )?programme/i);
    }
  });

  it('the eight are the same eight — one list, two registers', () => {
    // Two lists of jurisdictions is how one comes to be missing from the
    // other, which is the defect above in its general form.
    expect(Object.keys(PROGRAMME_PUBLISHERS).sort()).toEqual(Object.keys(OVERLAY_COVERAGE).sort());
  });
});

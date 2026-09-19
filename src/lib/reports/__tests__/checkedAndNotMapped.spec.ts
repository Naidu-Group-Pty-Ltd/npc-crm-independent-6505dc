/**
 * The one absence the prose may repeat, and only with its provenance.
 *
 * ## What rule 4 cost
 *
 * `planningFactBlocks` rule 4 said: *never write that no overlay applies, that
 * the property is not heritage listed, or that it is not flood or bushfire
 * affected.* Full stop. That was right when it was written — §8 of
 * `PLANNING_CONTROLS_IN_THE_REPORT.md` records the measurement behind it:
 * `layers=all` on the NSW Hazard service answers `{"results":[]}` because
 * ArcGIS reads `all` as all VISIBLE and that group is hidden, so an empty
 * answer to a question nobody asked read as a property with no bushfire and
 * no flood.
 *
 * §8 also fixed that, and the module's own header had already written down
 * what follows: *"we asked about bushfire and flood and neither applies" is a
 * finding, and "nobody asked" is not.* `constraintsAsked` names what the
 * answering registers could answer and `constraintRegisters.unavailable` names
 * what could not be reached, so the two are now distinguishable — and a
 * blanket prohibition forbids the one statement the register supports.
 *
 * The Kellyville Compass shows the cost. Twenty-one layers asked of three NSW
 * registers, all three answered, none unavailable, bushfire/flood/landslip
 * matching nothing. The page said so exactly:
 *
 * > **Checked and not mapped at this coordinate:** … bushfire, flood,
 * > landslip … Each of these was asked of a register that answered, and no
 * > feature covers this point. A mapped layer is indicative at the scale it is
 * > published; it is not a survey of the lot.
 *
 * The prose, forbidden to say it, said it anyway and said it worse:
 *
 * > `✓ No bushfire or flood overlays mapped at this coordinate (verification
 * > still required)`
 *
 * A tick, no register, no currency date, no scale caveat. A prohibition with
 * no permitted form is one a model routes around.
 */
import { describe, expect, it } from 'vitest';
import {
  buildPlanningFacts,
  checkedAndNotMapped,
  planningFactBlocks,
  renderConstraintRegister,
} from '../../../../supabase/functions/_shared/planning/planningFacts.pure';

/** Kellyville as the service answered it: three registers, two matches. */
const KELLYVILLE = {
  jurisdiction: 'NSW',
  council: 'THE HILLS SHIRE',
  fetchedAt: '2026-09-17T08:58:23.845Z',
  zoning: { status: 'stated', value: 'R2 — Low Density Residential', source: 'NSW Planning Portal' },
  constraintsAsked: ['height', 'minimumLotSize', 'heritage', 'bushfire', 'flood', 'landslide'],
  constraintRegisters: {
    answered: [
      'NSW Planning Portal — Principal Planning Layers',
      'NSW Planning Portal — Hazard',
      'NSW Planning Portal — Protection',
    ],
    unavailable: [],
  },
  constraints: [
    { family: 'height', kind: 'control', label: 'Height of Buildings Map', value: '10 m',
      source: 'NSW Planning Portal — Principal Planning Layers', currencyDate: '2026-02-27' },
    { family: 'minimumLotSize', kind: 'control', label: 'Minimum Lot Size', value: '700 m²',
      source: 'NSW Planning Portal — Principal Planning Layers', currencyDate: '2026-08-07' },
  ],
};

/** The same point with the hazard register unreachable — nothing is clear. */
const HAZARD_DOWN = {
  ...KELLYVILLE,
  constraintsAsked: [],
  constraintRegisters: { answered: [], unavailable: ['NSW Planning Portal — Hazard'] },
  constraints: [],
};

const factsFor = (planningData: unknown) => buildPlanningFacts({ planningData, overrides: {} });

describe('the list is one implementation', () => {
  const facts = factsFor(KELLYVILLE);

  it('names the layers asked of an answering register that matched nothing', () => {
    expect(checkedAndNotMapped(facts)).toEqual(['heritage', 'bushfire', 'flood', 'landslip']);
  });

  it('excludes a layer that DID match', () => {
    // Height and minimum lot size are mapped here, so neither is an absence.
    expect(checkedAndNotMapped(facts)).not.toContain('maximum building height');
    expect(checkedAndNotMapped(facts).join(' ')).not.toMatch(/lot size/i);
  });

  it('is the same list the page prints', () => {
    // Two copies of "which layers came back clear" is how a rule comes to
    // permit a sentence the evidence does not support.
    const drawn = renderConstraintRegister(facts);
    const line = drawn.split('\n').find((l) => l.startsWith('**Checked and not mapped'));
    expect(line).toBeTruthy();
    for (const layer of checkedAndNotMapped(facts)) expect(line, layer).toContain(layer);
  });

  it('is empty when no register answered, however many layers exist', () => {
    expect(checkedAndNotMapped(factsFor(HAZARD_DOWN))).toEqual([]);
  });
});

describe('rule 4 keeps the prohibition it was written for', () => {
  it('still refuses a portal, a data site or a register that was not asked', () => {
    const rules = planningFactBlocks(factsFor(KELLYVILLE));
    expect(rules).toMatch(/A layer this report did not reach supports nothing/);
    expect(rules).toMatch(/listing portal, a property data site, a live web search or a register that was not asked/);
    expect(rules).toMatch(/not in a risk register\s+row, and not in a checklist/);
  });

  it('governs everything where nothing came back clear', () => {
    const rules = planningFactBlocks(factsFor(HAZARD_DOWN));
    expect(rules).toMatch(/there is no absence\s+you may report at all/);
    expect(rules).toMatch(/Rule 4 governs every one of them/);
    // And it must not hand over an empty permitted list, which reads as
    // permission with nothing after the colon.
    expect(rules).not.toMatch(/matched nothing at this coordinate: \./);
  });
});

describe('rule 4a permits exactly one form, with its provenance', () => {
  const rules = planningFactBlocks(factsFor(KELLYVILLE));

  it('closes the list to what the register answered', () => {
    expect(rules).toMatch(/Exactly these layers were asked of a register that answered and matched nothing/);
    for (const layer of ['heritage', 'bushfire', 'flood', 'landslip']) {
      expect(rules, layer).toContain(layer);
    }
    expect(rules).toMatch(/do not name a layer outside that list/);
  });

  it('requires the register, the scale caveat and the certificate', () => {
    expect(rules).toContain('NSW Planning Portal — Hazard');
    expect(rules).toMatch(/indicative at the scale it is published rather than a survey of the lot/);
    expect(rules).toMatch(/keeps the certificate as\s+what settles it/);
  });

  it('refuses the tick the report actually drew', () => {
    // `✓ No bushfire or flood overlays mapped at this coordinate` — the
    // statement was true and the presentation was a clearance.
    expect(rules).toMatch(/Do NOT draw it as a tick, a clearance, a reassurance or a strength/);
  });

  it('refuses a risk rating drawn from it, pointing at the rule that says so', () => {
    expect(rules).toMatch(/do not rate a risk\s+from it/);
    expect(rules).toMatch(/An absence may NOT be rated/);
  });
});

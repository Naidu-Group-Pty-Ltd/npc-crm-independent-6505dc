/**
 * The planning controls a report may state.
 *
 * The fixture below is the deployed `planning-data-service`'s own answer for
 * 262 Pallas Street, Maryborough QLD 4650, taken at that report's verified
 * coordinate (−25.5161079, 152.7074047) on 16 Sep 2026. It is what the
 * generator already had in hand and threw away: `jurisdiction: QLD`,
 * `parcel.status: ok`, `lga: "Fraser Coast Regional"`, `locality:
 * "Maryborough"`, zoning `not_served` because Queensland sets zoning in each
 * council scheme, and an evidenced `none_at_point` for the state development
 * instruments.
 *
 * What the client received instead was the prompt's furniture — a minimum lot
 * size of 450 m², a height of 8.5 m and a floor space ratio of 0.5:1, none of
 * which any source states — under New South Wales headings (LEP, DCP, s10.7)
 * on a Queensland property.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildPlanningFacts,
  planningFactBlocks,
  renderPlanningControls,
} from '../../../../supabase/functions/_shared/planning/planningFacts.pure';

/** The service's answer, verbatim. */
const PALLAS = {
  jurisdiction: 'QLD',
  coordinate: { latitude: -25.5161079, longitude: 152.7074047 },
  zoning: {
    status: 'not_served',
    note: 'Queensland sets zoning in each council planning scheme; no state-wide zoning layer exists. '
      + 'The zone must be read from the council scheme — the planning and development certificate is the instrument.',
  },
  parcel: {
    status: 'ok',
    jurisdiction: 'QLD',
    lotPlan: null,
    area: null,
    areaBasis: null,
    lga: 'Fraser Coast Regional',
    tenure: 'Freehold',
    locality: 'Maryborough',
    source: 'Queensland Land Parcel Property Framework (spatial-gis.information.qld.gov.au)',
    licence: 'CC BY 4.0',
  },
  developmentInstruments: {
    status: 'none_at_point',
    note: 'The property lies inside no declared priority development area, state development area, '
      + 'coordinated project or infrastructure designation (Queensland StatePlanning layers, checked at the coordinate).',
  },
  developmentActivity: {
    status: 'not_served',
    note: 'No state-wide development-application feed exists for this jurisdiction (NSW’s Online DA API is the only one '
      + 'published); council DA registers are per-council.',
  },
  verification: 'A spatial layer is indicative; what settles the question is a planning and development certificate from the council.',
  fetchedAt: '2026-09-16T04:12:33.000Z',
};

/** A New South Wales answer, where the state DOES serve a zone. */
const NSW = {
  jurisdiction: 'NSW',
  zoning: {
    status: 'ok',
    jurisdiction: 'NSW',
    zoneCode: 'R2',
    zoneLabel: 'Low Density Residential',
    zoneFamily: 'Residential',
    instrument: 'Muswellbrook Local Environmental Plan 2009',
    lga: 'Muswellbrook Shire',
    currencyDate: '2026-05-01',
    source: 'NSW Planning Portal — Principal Planning Layers (Land Zoning)',
    licence: 'CC BY 4.0',
  },
  parcel: { status: 'not_integrated', note: 'No parcel attributes are integrated for this jurisdiction yet.' },
  developmentInstruments: { status: 'not_integrated', note: 'State development-instrument layers are integrated for Queensland only so far.' },
  developmentActivity: { status: 'not_served', note: 'No feed.' },
  verification: 'A spatial layer is indicative; what settles the question is a s10.7 planning certificate from the council (EP&A Act 1979).',
  fetchedAt: '2026-09-16T04:12:33.000Z',
};

describe('what the report may state about planning', () => {
  const facts = buildPlanningFacts({ planningData: PALLAS });

  it('carries the council the cadastre named, which the report stored as null', () => {
    expect(facts.jurisdiction).toBe('QLD');
    expect(facts.council).toBe('Fraser Coast Regional');
    expect(facts.locality).toBe('Maryborough');
  });

  it('states no control no source published', () => {
    // The three the old template printed as "Refer to LEP" beside a model
    // free to invent them. Every one must be an absence with a reason, and
    // none may carry a figure.
    const byLabel = Object.fromEntries(facts.controls.map((c) => [c.label, c]));
    for (const label of ['Minimum lot size', 'Maximum building height', 'Floor space ratio']) {
      expect(byLabel[label].value, `${label} must carry no figure`).toBeNull();
      expect(byLabel[label].status).toBe('not_published');
      expect(byLabel[label].note).toMatch(/not confirmed in this report/);
    }
    const rendered = renderPlanningControls(facts);
    expect(rendered).not.toMatch(/450\s*m²/);
    expect(rendered).not.toMatch(/8\.5\s*m\b/);
    expect(rendered).not.toMatch(/0\.5:1/);
    // And no bracketed placeholder survives for a model to fill in.
    expect(rendered).not.toMatch(/\[X+\]|\[XX\]%/i);
  });

  it('never reports an unchecked overlay as no overlay', () => {
    expect(facts.overlays.value).toBeNull();
    expect(facts.overlays.status).toBe('not_integrated');
    const rendered = renderPlanningControls(facts);
    // The rule, not the wording. With no register reached, the page must say
    // the council scheme was NOT READ — and must never phrase that as a
    // finding. Queensland gets its own sentence because the reason is
    // jurisdictional (zoning and overlays are per-council there), and a
    // reader sent to "no integrated layer" would not know to ask the council.
    expect(rendered).toMatch(/has not been read|none was looked up|was not (read|retrieved|checked)|not covered by this report/i);
    expect(rendered).toMatch(/nothing here says whether a (council )?overlay applies/i);
    expect(rendered).not.toMatch(/no significant overlays/i);
    expect(rendered).not.toMatch(/no overlays? (apply|applies|identified|were found)/i);
  });

  it('states an absent overlay register as unchecked, and a present one as checked', () => {
    // The distinction the whole register turns on. Nothing asked is not the
    // same reading as asked-and-clear, and only the second may be said out
    // loud — the confident-clear-against-nothing failure the sanctions
    // register shipped once.
    const asked = buildPlanningFacts({
      planningData: {
        ...(PALLAS as Record<string, unknown>),
        constraints: [],
        constraintsAsked: ['bushfire', 'flood'],
        constraintRegisters: { answered: ['Queensland FloodCheck'], unavailable: [] },
      },
    });
    expect(asked.overlays.status).toBe('none_at_point');
    const rendered = renderPlanningControls(asked);
    expect(rendered).toMatch(/Checked and not mapped at the property/);
    expect(rendered).toMatch(/bushfire/);
    expect(rendered).toMatch(/flood/);
    // Still never a clearance: a layer is indicative at its own scale.
    expect(rendered).toMatch(/not a survey of the lot/);
  });

  it('names the strategic designations the count excludes', () => {
    /*
     * The count is of CONTROLS, and a regional plan is not one — counting it
     * would say a plan limits what may be built on one lot. But the table
     * directly under this row lists the designations too, so on 262 Pallas
     * Street the first render read "1 mapped control applies at this point"
     * above a three-row table, and a reader resolves that by distrusting one
     * of them.
     */
    const reading = (constraints: unknown[]) => buildPlanningFacts({
      planningData: {
        ...(PALLAS as Record<string, unknown>),
        constraints,
        constraintsAsked: ['flood', 'regionalPlan', 'growthArea'],
        constraintRegisters: { answered: ['Queensland StatePlanning'], unavailable: [] },
      },
    }).overlays.value;

    const ctx = (family: string, label: string) => ({
      family, kind: 'context', label, code: null, value: null, instrument: null,
      clause: null, currencyDate: null, detail: null, standingLabel: null, region: null,
      source: 'Queensland StatePlanning', licence: 'CC BY 4.0',
    });
    const hazard = {
      family: 'flood', kind: 'hazard', label: 'Rapid Hazard Assessment — Lower Mary River',
      code: null, value: null, instrument: null, clause: null, currencyDate: null,
      detail: null, standingLabel: null, region: null,
      source: 'Queensland FloodCheck', licence: 'CC BY 4.0',
    };

    expect(reading([hazard, ctx('growthArea', 'Maryborough Priority Living Area'),
      ctx('regionalPlan', 'Wide Bay Burnett Regional Plan')]))
      .toBe('1 mapped control applies at this point, plus 2 strategic designations');
    // One designation is singular, and a control with none reads as it always
    // did — no tail at all.
    expect(reading([hazard, ctx('regionalPlan', 'Wide Bay Burnett Regional Plan')]))
      .toBe('1 mapped control applies at this point, plus 1 strategic designation');
    expect(reading([hazard])).toBe('1 mapped control applies at this point');
  });

  it('says designations are listed below even where no control was mapped', () => {
    // The same contradiction in its other form: nothing controls the lot, and
    // the table under the row still has two rows in it.
    const facts = buildPlanningFacts({
      planningData: {
        ...(PALLAS as Record<string, unknown>),
        constraints: [{
          family: 'regionalPlan', kind: 'context', label: 'Wide Bay Burnett Regional Plan',
          code: null, value: null, instrument: null, clause: null, currencyDate: null,
          detail: null, standingLabel: null, region: null,
          source: 'Queensland StatePlanning', licence: 'CC BY 4.0',
        }],
        constraintsAsked: ['flood'],
        constraintRegisters: { answered: ['Queensland StatePlanning'], unavailable: [] },
      },
    });
    expect(facts.overlays.status).toBe('none_at_point');
    expect(facts.overlays.note).toContain('plus 1 strategic designation, listed below');
    expect(facts.overlays.note).toContain('No mapped control applies to the property');
  });

  it('keeps the five absences apart', () => {
    // Zoning is not_served (Queensland has no state layer) while the state
    // instruments are none_at_point (the layers answered and nothing covers
    // this point). Those are different facts and the old single "Not
    // specified" collapsed them.
    expect(facts.zoning.status).toBe('not_served');
    expect(facts.instruments.status).toBe('none_at_point');
    expect(facts.developmentActivity.status).toBe('not_served');
  });

  it('says what settles the question, in this jurisdiction’s own words', () => {
    const rendered = renderPlanningControls(facts);
    expect(rendered).toMatch(/planning and development certificate from the council/);
    expect(rendered).toMatch(/not a planning certificate and do not/);
    // A zone that admits a use is not consent for it.
    expect(rendered).toMatch(/conditional on assessment/);
    expect(rendered).toMatch(/nothing in this report is an\s*\n?approval/);
  });

  it('forbids the New South Wales instruments on a Queensland property', () => {
    const rules = planningFactBlocks(facts);
    expect(rules).toMatch(/Do NOT mention a Local Environmental Plan/);
    expect(rules).toMatch(/those are New South\s*\n?Wales instruments/);
  });

  it('names them where they do apply', () => {
    const nsw = buildPlanningFacts({ planningData: NSW });
    expect(nsw.zoning.value).toBe('R2 — Low Density Residential');
    expect(nsw.zoning.status).toBe('stated');
    expect(nsw.zoning.standing).toBe('adopted');
    expect(nsw.zoning.effectiveDate).toBe('2026-05-01');
    expect(nsw.zoning.licence).toBe('CC BY 4.0');
    expect(nsw.zoning.sourceUrl).toBe('https://www.planningportal.nsw.gov.au/spatialviewer');
    expect(planningFactBlocks(nsw)).toMatch(/the right instruments to name/);
  });

  it('every row carries where it came from and when', () => {
    const nsw = buildPlanningFacts({ planningData: NSW });
    const rendered = renderPlanningControls(nsw);
    expect(rendered).toMatch(/NSW Planning Portal/);
    expect(rendered).toMatch(/current at 1 May 2026/);
    expect(rendered).toMatch(/accessed 16 Sep 2026/);
    expect(rendered).toMatch(/CC BY 4\.0/);
  });
});

describe('an operator who has read the certificate outranks a layer', () => {
  it('takes the override and labels it as one', () => {
    const facts = buildPlanningFacts({
      planningData: NSW,
      overrides: { zoningCode: 'R3', zoningDescription: 'medium_density_residential', minimumLotSize: 600 },
    });
    expect(facts.zoning.value).toBe('R3 — medium density residential');
    expect(facts.zoning.status).toBe('operator_stated');
    // The layer said R2. The override is not overwritten by it, and it is not
    // dressed up as a published control either.
    expect(facts.zoning.source).toMatch(/Supplied by the adviser/);
    const lot = facts.controls.find((c) => c.label === 'Minimum lot size')!;
    expect(lot.value).toBe('600 m²');
    expect(lot.status).toBe('operator_stated');
    expect(renderPlanningControls(facts)).toMatch(/\| Supplied by the adviser \|/);
  });
});

describe('an enrichment that never ran', () => {
  const facts = buildPlanningFacts({});

  it('says so rather than printing a table of blanks', () => {
    expect(facts.enrichmentMissing).toBe(true);
    expect(facts.anyStated).toBe(false);
    expect(facts.zoning.status).toBe('unavailable');
  });

  it('forbids the whole table rather than inviting a guess', () => {
    const rules = planningFactBlocks(facts);
    expect(rules).toMatch(/do NOT print a zoning table/i);
    expect(rules).toMatch(/do NOT name a planning instrument/i);
  });
});

describe('the rules reach the model, and they are not a section’s rules', () => {
  /*
   * Measured on the 17 Sep 2026 regeneration of 262 Pallas Street (report
   * 4640d10a). The enrichment ran on every section — the function logged
   * `Planning facts: { jurisdiction: "QLD", council: "Fraser Coast Regional",
   * zone: null, zoneStatus: "not_served" }` eleven times — and the document
   * still asserted "low-density residential zoning" and "no identified
   * bushfire, flood or heritage overlays", sourced to a listing portal, plus a
   * four-item `{{timeline:}}` pipeline with 0-2y horizons no register carries.
   *
   * Two causes, one fix each.
   *
   * The base prompt measured 92,129 bytes and every section logged
   * `92129 → ~52,830`: `limitPromptContext` keeps 62% head and 38% tail, so the
   * planning table sat in the dropped middle while the rule pointing AT it sat
   * in the section instructions, which are never trimmed. And the rules called
   * themselves "RULES FOR THIS SECTION" on a report whose section list has no
   * planning section at all.
   */
  const facts = buildPlanningFacts({ planningData: PALLAS });

  it('claims the whole report, not a section', () => {
    const rules = planningFactBlocks(facts);
    expect(rules).toMatch(/prohibitions below apply in every section/);
    expect(rules, 'there is no planning section in the Compass list to scope these to')
      .not.toMatch(/RULES FOR THIS SECTION/);
    expect(planningFactBlocks(buildPlanningFacts({}))).toMatch(/In every\s+section/);
  });

  it('says a web search is not a retrieval', () => {
    // The model has live search. Silence about that is what let a portal's
    // "flood risk — not detected" become this report's finding about the land.
    const rules = planningFactBlocks(facts);
    expect(rules).toMatch(/live web search/);
    expect(rules).toMatch(/listing portal|listing site/);
    expect(planningFactBlocks(buildPlanningFacts({}))).toMatch(/live web search/);
  });
});

describe('what the generator does with them', () => {
  const generator = readFileSync(
    'supabase/functions/generate-investment-report/index.ts',
    'utf8',
  );

  it('pins them instead of burying them in a prompt it trims', () => {
    // The blocks must NOT be interpolated into `propertyPrompt`: that string is
    // the one `limitPromptContext` cuts in the middle.
    const prompt = generator.slice(
      generator.indexOf('const propertyPrompt = `'),
      generator.indexOf('// Select the appropriate prompt'),
    );
    for (const name of ['planningControlsTable', 'planningSectionRules', 'infrastructureTable', 'infrastructureSectionRules']) {
      expect(prompt, `${name} must not sit inside the trimmed base prompt`).not.toContain(`\${${name}}`);
    }
    expect(generator).toMatch(/const pinnedPlanningContext = \[/);
    expect(generator).toMatch(/generateReportSection\(\s*\n\s*sectionDef,\s*\n\s*prompt,\s*\n\s*pinnedPlanningContext,/);
  });

  it('takes the pinned bytes off the budget before the base prompt is measured', () => {
    // Budgeting for it AFTER the trim would put it back over the ceiling; not
    // budgeting for it at all would push the same bytes out of the tail.
    expect(generator).toMatch(
      /const basePromptBudget = Math\.max\(0, PERPLEXITY_SAFE_USER_MESSAGE_BYTES - sectionInstructionBytes - pinnedBytes - 2_000\)/,
    );
    expect(generator).toMatch(/let sectionPrompt = `\$\{safeBasePrompt\}\$\{pinnedBlock\}\$\{sectionInstructions\}`/);
    // And the compact retry — the prompt that runs when the full one was
    // refused — carries it too.
    const emergency = generator.slice(
      generator.indexOf('const emergencySectionPromptUnbounded'),
      generator.indexOf('const emergencySectionPrompt ='),
    );
    expect(emergency).toContain('${pinnedBlock}');
  });

  it('puts the two tables in the document rather than asking for them back', () => {
    const append = generator.slice(generator.indexOf('END COMPASS POST-PROCESSOR'));
    // Inside the chapter each is the evidence for, and under the section of
    // their own only where that chapter is absent (the fallback).
    expect(append).toContain('`### ${PLANNING_REGISTER_HEADING}');
    expect(append).toContain('`## ${PLANNING_REGISTER_SECTION}');
    expect(append).toContain('${planningControlsTable}');
    expect(append).toContain('${infrastructureTable}');
    // Property reports only: a suburb report has no parcel to state them about.
    expect(append).toMatch(/if \(!isAreaReport\) \{/);
  });
});

/**
 * Rule 9 — the provenance is stated once.
 *
 * Measured on the Investment Compass delivered for 9 Hollow Street, Golden
 * Square on 21 Sep 2026, over its 29 body pages: "General Residential Zone" or
 * "GRZ" 45 times, "Vicmap Planning" 26, "a planning certificate" or
 * "Section 32" 24, "no mapped control" 15, and the layer's own currency date
 * five. A reader's dominant impression of that document is being told the same
 * four things fifteen times in different words.
 */
describe('the rule about where a fact goes, not what it may say', () => {
  const rules = () => planningFactBlocks(buildPlanningFacts({ planningData: PALLAS }));

  it('asks for the provenance once, and names where it belongs', () => {
    const r = rules();
    expect(r).toContain('State the provenance ONCE');
    expect(r).toMatch(/belong to the planning section alone/i);
  });

  it('does not soften a caveat, and says so', () => {
    // Rules 2, 4 and 6 are what stop an unretrieved control being reported as
    // absent. A rule about repetition must not read as permission to drop them.
    const r = rules();
    expect(r).toContain('This does not soften a caveat');
    expect(r).toMatch(/rules 2, 4 and 6 require/);
    // …and every prohibition it sits beside is still there.
    expect(r).toContain('Never write that no overlay applies');
    expect(r).toContain('An absence may NOT be rated');
    expect(r).toContain('desktop checks');
  });

  it('never tells the model to omit a control or its absence', () => {
    // The scope is the citation apparatus, never the finding.
    const rule9 = rules().split('\n').find((l) => l.startsWith('9.'))!;
    expect(rule9).toBeDefined();
    for (const forbidden of [/do not (?:state|mention|report) (?:the|a) (?:zone|control|overlay)/i]) {
      expect(rule9).not.toMatch(forbidden);
    }
    expect(rule9).toMatch(/Name the zone or the control wherever a section needs it/);
  });
});

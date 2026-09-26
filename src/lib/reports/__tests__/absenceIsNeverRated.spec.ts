/**
 * An absence may not be rated, and a retrieval's verification may not be lent
 * to a conclusion.
 *
 * ## The row this exists for
 *
 * From the Compass generated for 262 Pallas Street, Maryborough on
 * 17 Sep 2026, in the risk register:
 *
 * > | Infrastructure timing and pipeline | **Low** | The absence of a named
 * > infrastructure pipeline in the registers searched means this property's
 * > performance is tied to broader Maryborough fundamentals rather than
 * > specific projects. | … | **Verified** — Queensland StatePlanning layers
 * > checked at the coordinate show no declared priority development area,
 * > state development area, coordinated project or infrastructure
 * > designation. |
 *
 * Every fact in that row is true and the conclusion is unsupported three
 * times over.
 *
 * 1. **The rating.** `Low` is a statement about this property's exposure,
 *    drawn from a register having returned nothing. Three paragraphs above it
 *    the same document says these registers do not reach council capital
 *    works, state and federal budget programmes, or transport, water, energy
 *    and health agency announcements — which is where a regional centre's
 *    infrastructure is actually recorded. The search measured the search.
 * 2. **The chip.** `Verified` is true of the layer reading and was written
 *    against the rating, which the reading does not verify.
 * 3. **"the registers searched".** Queensland's development-application
 *    register was never searched and cannot be: no state-wide feed is
 *    published for the jurisdiction. The evidence carried both absences as
 *    plain strings, so nothing downstream could tell them apart.
 *
 * This file pins the RULES and the READING, never the sentences — the same
 * correction made to `infrastructureEvidence.spec.ts` when pinning wording
 * made a rule look like a fixture to refresh. Every assertion below is of the
 * form "a rating word may not appear in a reassuring position" or "these two
 * readings are distinguishable", both of which stay true however the prose is
 * rewritten.
 */
import { describe, expect, it } from 'vitest';
import {
  buildInfrastructureEvidence,
  infrastructureRules,
  renderInfrastructureOutlook,
  REGISTER_CHECKED_EMPTY,
  REGISTER_NOT_COVERED,
} from '../../../../supabase/functions/_shared/planning/infrastructureEvidence.pure';
import {
  buildPlanningFacts,
  planningFactBlocks,
} from '../../../../supabase/functions/_shared/planning/planningFacts.pure';

/** 262 Pallas Street as the planning service actually answered it. */
const PALLAS = {
  jurisdiction: 'QLD',
  fetchedAt: '2026-09-17T08:58:23.845Z',
  developmentInstruments: {
    status: 'none_at_point',
    note: 'The property lies inside no declared priority development area, state development area, coordinated '
      + 'project or infrastructure designation (Queensland StatePlanning layers, checked at the coordinate).',
  },
  developmentActivity: {
    status: 'not_served',
    note: 'No state-wide development-application feed exists for this jurisdiction (NSW’s Online DA API is '
      + 'the only one published); council DA registers are per-council.',
  },
};

/** The same point, with one register unreachable rather than unpublished. */
const UNAVAILABLE = {
  jurisdiction: 'QLD',
  developmentInstruments: { status: 'unavailable', note: 'The layer did not answer.' },
};

/**
 * The words a rating cell may not carry when its evidence is an absence.
 *
 * Deliberately the reassuring end only. `Moderate`, `High` and `Not assessed`
 * are all legitimate answers to "we did not retrieve this"; what is never
 * legitimate is the end that tells a reader there is less to worry about
 * because nobody found anything.
 */
const REASSURING = ['low', 'minimal', 'limited', 'favourable', 'negligible'];

describe('the two absences are different readings', () => {
  const evidence = buildInfrastructureEvidence({ planningData: PALLAS });

  it('files a register that was asked apart from one that was not', () => {
    expect(evidence.readings.map((r) => [r.register, r.reading])).toEqual([
      ['development instruments', 'searched_empty'],
      ['development applications', 'not_searched'],
    ]);
  });

  it('treats every absence but none_at_point as a register nobody asked', () => {
    // The service publishes five: none_at_point, not_served, not_integrated,
    // licence_restricted, unavailable. Only the first is a question that was
    // put. A failed request is not a quiet area.
    const [only] = buildInfrastructureEvidence({ planningData: UNAVAILABLE }).readings;
    expect(only.reading).toBe('not_searched');
  });

  it('keeps `absences` the same strings in the same order', () => {
    // The persisted record and three existing readers take this field; the
    // typed reading is added beside it, never in place of it.
    expect(evidence.absences).toEqual(evidence.readings.map((r) => r.note));
    // The reader's words since 25 Sep 2026 (`serviceNote.pure.ts`); the order
    // and the one-to-one pairing with the readings are what this pins.
    expect(evidence.absences[0]).toMatch(/not within a declared priority development area/);
    expect(evidence.absences[1]).toMatch(/published council by council/);
  });

  it('does not call an unsearchable register one that was searched', () => {
    const drawn = renderInfrastructureOutlook(evidence);
    // The two headings are the distinction; their words are the adviser's
    // (`REGISTER_NOT_COVERED` / `REGISTER_CHECKED_EMPTY`) and must differ.
    expect(REGISTER_NOT_COVERED).not.toBe(REGISTER_CHECKED_EMPTY);
    const notSearched = drawn.split('\n').filter((l) => l.startsWith(`**${REGISTER_NOT_COVERED}**`));
    const empty = drawn.split('\n').filter((l) => l.startsWith(`**${REGISTER_CHECKED_EMPTY}**`));
    expect(notSearched).toHaveLength(1);
    expect(empty).toHaveLength(1);
    expect(notSearched[0]).toMatch(/published council by council/);
    expect(empty[0]).toMatch(/not within a declared priority development area/);
  });

  it('tells the model which sentence is true of which register', () => {
    const rules = infrastructureRules(evidence);
    // The instruments register may be described as checked and empty.
    expect(rules).toMatch(/development instruments source WAS checked/);
    // The application register may not be described as checked at all.
    expect(rules).toMatch(/development applications source is NOT covered by this report/);
    expect(rules).toMatch(/Do NOT\s+write that it was checked/);
  });
});

describe('an absence may not be rated', () => {
  const empty = infrastructureRules(buildInfrastructureEvidence({ planningData: PALLAS }));
  const evidenced = infrastructureRules(buildInfrastructureEvidence({
    planningData: {
      jurisdiction: 'QLD',
      developmentInstruments: {
        status: 'ok',
        source: 'Queensland StatePlanning',
        instruments: [{ name: 'Maryborough PDA', kind: 'priority_development_area', status: 'Declared' }],
      },
    },
  }));

  it.each([['nothing retrieved', empty], ['a short list', evidenced]])(
    'forbids the reassuring end of a rating scale — %s',
    (_label, rules) => {
      expect(rules).toMatch(/absence may NOT be rated|rate what the table\s+states/i);
      for (const word of REASSURING) {
        expect(rules.toLowerCase(), word).toContain(word);
      }
      expect(rules).toMatch(/Not assessed/);
    },
  );

  it.each([['nothing retrieved', empty], ['a short list', evidenced]])(
    'names every rating surface, not just prose — %s',
    (_label, rules) => {
      for (const surface of ['risk register', 'scorecard', 'SWOT']) {
        expect(rules, surface).toContain(surface);
      }
    },
  );

  it('says the coverage limitation is why, rather than asserting the rule bare', () => {
    // A prohibition with no reason is one a model routes around — the lesson
    // already recorded on the Compass document contract.
    expect(empty).toMatch(/council capital works/);
    expect(empty).toMatch(/measured the SEARCH, not the area/);
  });

  it('forbids filing it as a strength or an opportunity, not only as a rating', () => {
    // The SWOT is the other half of the same page and takes the same
    // unsupported comfort in a different table.
    expect(empty).toMatch(/never file it as a strength/i);
    expect(evidenced).toMatch(/never file it as a strength/i);
  });
});

describe('an evidence note describes the retrieval, never the conclusion', () => {
  const empty = infrastructureRules(buildInfrastructureEvidence({ planningData: PALLAS }));

  it('permits "Verified" of a reading and refuses it of a rating', () => {
    expect(empty).toMatch(/describes the SEARCH and never the conclusion beside it/);
    expect(empty).toMatch(/may NOT be written of a rating/);
  });
});

describe('the drawn page carries the rule a reader needs', () => {
  it('says a short list is not a basis for a low rating', () => {
    const drawn = renderInfrastructureOutlook(buildInfrastructureEvidence({ planningData: PALLAS }));
    expect(drawn).toMatch(/not a basis for rating infrastructure risk as low/);
  });
});

describe('the planning half closes the same gap', () => {
  const rules = planningFactBlocks(buildPlanningFacts({
    planningData: {
      jurisdiction: 'QLD',
      council: 'Fraser Coast Regional',
      zoning: { status: 'stated', value: 'Residential', source: 'QLD StatePlanning' },
    },
  }));

  it('closes the rating as well as the statement', () => {
    // Rule 4 already forbade writing that no overlay applies, and the model
    // obeyed it — then rated a row Low from the same absence one line down.
    //
    // Asserted as the RULE, not the sentence: rule 4's wording was later
    // rewritten (see `checkedAndNotMapped.spec.ts`) and a spec that pinned the
    // old string would have read as a fixture to refresh rather than as a
    // rule that still holds.
    expect(rules).toMatch(/not flood or bushfire affected/);
    expect(rules).toMatch(/not in a risk register/);
    expect(rules).toMatch(/absence may NOT be rated/);
    expect(rules).toMatch(/Not assessed/);
  });

  it('refuses an inference from area character as a substitute for a retrieval', () => {
    expect(rules).toMatch(/inference from the area’s general character is not a check either/);
  });

  it('separates the evidence note from the conclusion here too', () => {
    expect(rules).toMatch(/describes the CHECK and never the conclusion beside it/);
  });
});

/**
 * The row that says "we did not assess this" is the one that must survive.
 *
 * `stripPlaceholderRows` removes a table row whose first value cell is a
 * placeholder — and the whole point of the rule above is to put a new word in
 * exactly that cell. Its pattern is `n/a|tbd|to be determined|not available|
 * not provided|unknown|—|-|–`, so "Not assessed" is not one; that is read from
 * the module's behaviour here rather than from its source, because the scrub
 * runs on four read paths and a silent deletion would look exactly like a
 * model that never wrote the row.
 */
describe('a "Not assessed" level survives the read-path scrub', () => {
  const table = [
    '| Risk Category | Level | Why It Matters | Required Check | Evidence Chip |',
    '|---|---|---|---|---|',
    '| Infrastructure timing and pipeline | Not assessed | The registers this report reads do not cover council '
    + 'capital works or agency announcements. | Ask Fraser Coast Regional Council for its capital works programme. '
    + '| The state instrument layers were checked at the coordinate and matched none. |',
    '| Flood exposure | Moderate | Insurability and vacancy after an event. | Order a council flood search. '
    + '| Unverified — no parcel-level flood mapping was retrieved. |',
  ].join('\n');

  it('keeps the row and its four value cells', async () => {
    const { stripPlaceholderRows } = await import(
      '../../../../supabase/functions/_shared/reports/investment/derivedHygiene.pure');
    const out = stripPlaceholderRows(table);
    expect(out.removedRows).toBe(0);
    expect(out.removedTables).toBe(0);
    expect(out.blankedCells).toBe(0);
    expect(out.markdown).toContain('| Infrastructure timing and pipeline | Not assessed |');
  });

  it('still removes the placeholder the scrub exists for', async () => {
    const { stripPlaceholderRows } = await import(
      '../../../../supabase/functions/_shared/reports/investment/derivedHygiene.pure');
    const out = stripPlaceholderRows(table.replace('| Not assessed |', '| N/A |'));
    expect(out.removedRows).toBe(1);
    expect(out.markdown).not.toContain('Infrastructure timing and pipeline');
  });
});

/**
 * And the fork still calls it a dashboard rather than a checklist.
 *
 * `riskDashboardContract` keeps the dashboard heading for a body carrying
 * rated entries and renames one that is a list of work to do. `ASSESSED_ENTRY`
 * matches `| Low |`, `| Moderate |`, `| Medium |` and `| High |` — deliberately
 * NOT `| Not assessed |`, which is the absence of a rating and not a rating.
 * The classification is unaffected because it is reached only for a body of
 * bullets, and this pins that reasoning rather than leaving it to be rederived.
 */
describe('the fork reads a Not-assessed table as a dashboard', () => {
  const rows = (level: string) => [
    '| Risk Category | Level | Why It Matters | Required Check |',
    '|---|---|---|---|',
    `| Infrastructure timing | ${level} | Registers do not reach capital works. | Ask the council. |`,
  ].join('\n');

  it.each([['Not assessed'], ['Moderate']])('keeps the dashboard heading — %s', async (level) => {
    const { riskDashboardContract } = await import(
      '../../../../supabase/functions/_shared/reports/investment/forkSectionContracts.pure');
    const c = riskDashboardContract(rows(level), 'Risk Dashboard', 'Due Diligence Checklist');
    expect(c.heading).toBe('Risk Dashboard');
    expect(c.isChecklist).toBe(false);
  });
});

/**
 * The prompt that asks for the row and the rule that governs it must offer the
 * same vocabulary.
 *
 * This is the defect that produced the contradiction in the first place: two
 * prompt blocks, each correct on its own. The section registry declared the
 * levels a model may write, and a rule telling it to write "Not assessed"
 * while the registry offered only Low/Moderate/High would be one more of them.
 */
describe('the rule and the section registry agree on the vocabulary', () => {
  it('offers "Not assessed" as a level the registry names', async () => {
    const { COMPASS_40_SECTIONS } = await import('../compassSectionRegistry');
    const risk = COMPASS_40_SECTIONS.find((d) => d.id === 'compass.riskDashboard');
    expect(risk, 'the risk dashboard section').toBeTruthy();
    expect(risk!.purpose).toMatch(/Not assessed/);
    // And it says WHY, rather than adding a word to a list.
    expect(risk!.purpose).toMatch(/describes the CHECK,\s+not the area/);
  });

  it('separates the chip from the level there too', async () => {
    const { COMPASS_40_SECTIONS } = await import('../compassSectionRegistry');
    const risk = COMPASS_40_SECTIONS.find((d) => d.id === 'compass.riskDashboard');
    expect(risk!.purpose).toMatch(/never write a chip against the LEVEL/);
  });
});

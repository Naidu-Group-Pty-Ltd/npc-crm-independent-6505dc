/**
 * A client document speaks as the adviser, about the property.
 *
 * The 60 Lawley Street, Spalding Compass (25 Sep 2026) said "register" 110
 * times, "retrieved" 38, "coordinate" 17 and "this platform" 11, and printed
 * "No infrastructure project or development instrument was retrieved …" five
 * times. Every sentence was true; none was about the property. Two causes,
 * and each is pinned here as a rule rather than as a string:
 *
 *   1. The words came from US. The composed blocks the page prints verbatim,
 *      the sentences the writer is told to write, and the section instructions
 *      all spoke the machine room's vocabulary, and a writer copies what it is
 *      handed. So every one of them is held to `PLATFORM_VOCABULARY`.
 *   2. The repetition was an INSTRUCTION: a "say this" rule inside a block
 *      pinned to every section call. `DISCLOSURE_HOMES` gives each limitation
 *      one section, and its ids and names are held to the registry here,
 *      because the module is pure and the registry is not.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  adviserVoiceRules,
  condensedVoiceRules,
  DISCLOSURE_HOMES,
  elsewhereOnly,
  inHomeSection,
  PLATFORM_VOCABULARY,
  platformVocabularyCount,
  platformVocabularyIn,
  REGISTER_CHECKED_EMPTY,
  REGISTER_NOT_COVERED,
  type DisclosureTopic,
} from '../../../../supabase/functions/_shared/reports/adviserVoice.pure';
import { COMPASS_40_SECTIONS as EDGE_SECTIONS } from '../../../../supabase/functions/_shared/compassSectionRegistry';
import { COMPASS_40_SECTIONS as FRONTEND_SECTIONS } from '../compassSectionRegistry';
import { documentRules } from '../../../../supabase/functions/_shared/compassSectionContract';
import { runQAValidation } from '../../../../supabase/functions/_shared/compassQAValidator';
import {
  buildPlanningFacts,
  planningFactBlocks,
  renderLandUseTable,
  renderPlanningControls,
} from '../../../../supabase/functions/_shared/planning/planningFacts.pure';
import {
  buildInfrastructureEvidence,
  infrastructureRules,
  renderInfrastructureOutlook,
} from '../../../../supabase/functions/_shared/planning/infrastructureEvidence.pure';
import {
  PUBLISHED_PROJECT_BASIS,
  PUBLISHED_PROJECT_COVERAGE,
  publishedProjectRules,
  renderPublishedProjects,
} from '../../../../supabase/functions/_shared/planning/publishedProjectRegister.pure';
import { ABSENCE_SENTENCE } from '../../../../supabase/functions/_shared/reports/market/approvalsFactBlocks.pure';
import { forwardDemandStatement } from '../../../../supabase/functions/_shared/reports/market/openData/projectionRegister.pure';
import { transportFactBlocks } from '../../../../supabase/functions/_shared/reports/location/amenityFactBlocks.pure';
import {
  INFRASTRUCTURE_REGISTER_HEADING,
  INFRASTRUCTURE_REGISTER_SECTION,
  PLANNING_REGISTER_HEADING,
  PLANNING_REGISTER_SECTION,
  REGISTER_HEADINGS,
  STORED_REGISTER_HEADINGS,
} from '../../../../supabase/functions/_shared/reports/investment/registerTables.pure';

const JURISDICTIONS = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT'] as const;

/** Planning answers in the shapes the service writes, including every note it can. */
function planningAnswers(): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = [['no enrichment at all', null]];
  for (const j of JURISDICTIONS) {
    out.push([`${j}: nothing answered`, {
      jurisdiction: j,
      fetchedAt: '2026-09-25T00:00:00.000Z',
      constraints: [],
      constraintsAsked: [],
      constraintRegisters: { answered: [], unavailable: [] },
      developmentInstruments: {
        status: 'not_integrated',
        note: 'No state development-instrument register was searched for this jurisdiction: the only such '
          + 'register this report reads is Queensland\'s.',
      },
      developmentActivity: { status: 'not_served', note: 'No state-wide development-application feed exists for this jurisdiction.' },
      parcel: { status: 'not_integrated', note: 'No parcel attributes are integrated for this jurisdiction yet.' },
      zoning: { status: 'not_integrated', note: 'No integrated planning layer covers this point.' },
    }]);
  }
  out.push(['WA: licence-restricted zone, bushfire checked clear (60 Lawley Street)', {
    jurisdiction: 'WA',
    council: 'City of Armadale',
    fetchedAt: '2026-09-25T01:32:00.000Z',
    zoning: { status: 'licence_restricted', note: 'WA planning scheme data (SLIP) is licensed for personal use only.' },
    developmentInstruments: {
      status: 'not_integrated',
      note: 'State development-instrument layers are integrated for Queensland only so far.',
    },
    developmentActivity: { status: 'not_served', note: 'No state-wide development-application feed exists for this jurisdiction.' },
    constraintsAsked: ['bushfire'],
    constraintRegisters: { answered: ['DFES Map of Bush Fire Prone Areas'], unavailable: [] },
    constraints: [],
  }]);
  out.push(['NSW: zone and two controls mapped, three layers checked clear (97 Poole Road)', {
    jurisdiction: 'NSW',
    council: 'THE HILLS SHIRE',
    fetchedAt: '2026-09-17T08:58:23.845Z',
    zoning: { status: 'stated', value: 'R2 — Low Density Residential', source: 'NSW Planning Portal' },
    constraintsAsked: ['height', 'minimumLotSize', 'heritage', 'bushfire', 'flood', 'landslide'],
    constraintRegisters: {
      answered: ['NSW Planning Portal — Principal Planning Layers', 'NSW Planning Portal — Hazard'],
      unavailable: ['NSW Planning Portal — Protection'],
    },
    constraints: [
      { family: 'height', kind: 'control', label: 'Height of Buildings Map', value: '10 m',
        source: 'NSW Planning Portal — Principal Planning Layers', currencyDate: '2026-02-27' },
    ],
  }]);
  /*
   * Every note the land use table can carry. The block prints the note as its
   * first line wherever no table was read, and until 25 Sep 2026 no fixture
   * here carried a `landUse` at all — so "No zone was retrieved for this
   * coordinate…" reached the 60 Lawley Street Compass under a test that said it
   * covered the land-use block.
   */
  const landUseNote = (status: string, note: string) => ({
    status, note, instrument: null, zoneCode: null, objectives: null,
    permittedWithoutConsent: [], permittedWithConsent: [], prohibited: [],
    source: null, sourceUrl: null, licence: null, retrievedAt: null,
  });
  const LAND_USE_NOTES: Array<[string, string, string]> = [
    ['WA', 'not_served', 'No zone was retrieved for this coordinate, so the instrument\'s land use table could not be asked for.'],
    ['VIC', 'not_served', 'VIC publishes no structured land use table; what a zone permits is read from the planning scheme itself.'],
    ['ACT', 'not_served', 'ACT publishes no structured land use table; what a zone permits is read from the planning scheme itself.'],
    ['NSW', 'not_served', 'The zone was retrieved without the instrument that names it, so the land use table could not be asked for.'],
    ['NSW', 'none_at_point', 'The instrument\'s land use table carries no zone R2'],
    ['NSW', 'none_at_point', 'The service answered for zone R2 and returned no land uses'],
    ['NSW', 'unavailable', 'HTTP 503'],
    ['NSW', 'unavailable', 'unparseable JSON body'],
    ['NSW', 'unavailable', 'The permissibility service answered a body this could not read'],
    ['NSW', 'unavailable', 'error sending request for url (https://api.apps1.nsw.gov.au/eplanning/data/v0/FetchEPILandUsePermissibility)'],
  ];
  for (const [j, status, note] of LAND_USE_NOTES) {
    out.push([`${j}: land use table ${status} — "${note.slice(0, 40)}…"`, {
      jurisdiction: j,
      fetchedAt: '2026-09-25T01:32:00.000Z',
      zoning: j === 'NSW' ? { status: 'stated', value: 'R2 — Low Density Residential', source: 'NSW Planning Portal' }
        : { status: 'not_integrated', note: 'No integrated planning layer covers this point.' },
      landUse: landUseNote(status, note),
    }]);
  }
  out.push(['QLD: council-set zone, instruments checked clear (262 Pallas Street)', {
    jurisdiction: 'QLD',
    fetchedAt: '2026-09-16T04:12:33.000Z',
    zoning: {
      status: 'not_served',
      note: 'Queensland sets zoning in each council planning scheme; no state-wide zoning layer exists.',
    },
    developmentInstruments: {
      status: 'none_at_point',
      note: 'The property lies inside no declared priority development area, state development area, '
        + 'coordinated project or infrastructure designation (Queensland StatePlanning layers, checked at the coordinate).',
    },
    developmentActivity: { status: 'not_served', note: 'No state-wide development-application feed exists for this jurisdiction.' },
  }]);
  return out;
}

const SEARCHED = { searched: true, radiusKm: 15, coordinateSource: 'enrichment' } as const;
const NOT_SEARCHED = {
  searched: false,
  reason: 'the register is swept by coordinate and none was usable — the geocoder answered at locality precision.',
} as const;

describe('the vocabulary is recognised narrowly', () => {
  it('finds the machine room in the sentences that printed it', () => {
    for (const printed of [
      'No infrastructure project or development instrument was retrieved for this coordinate.',
      'This platform holds a register of major public projects.',
      'No population projection has been loaded for this assessment.',
      'Bus services cannot be assessed because no operator stop file was available for this assessment.',
      'The recommendation also weighs matters the model does not measure.',
      '| Recorded attribute | Detail |',
    ]) {
      expect(platformVocabularyCount(printed), printed).toBeGreaterThan(0);
    }
  });

  it('leaves ordinary English — and a statute\'s own words — alone', () => {
    // A warning that fires on these teaches an operator to ignore it.
    for (const ordinary of [
      'The property is not within a declared coordinated project (Queensland State Planning mapping).',
      'The display home model is the Hamilton 28.',
      'The house was loaded onto a truck and relocated in 1987.',
      'Checked — nothing recorded. The heritage register lists no item on the lot.',
    ]) {
      expect(platformVocabularyIn(ordinary), ordinary).toEqual([]);
    }
  });

  it('gives the writer an alternative for every term it forbids', () => {
    for (const term of PLATFORM_VOCABULARY) expect(term.instead.length, term.phrase).toBeGreaterThan(10);
    const rules = adviserVoiceRules();
    for (const term of PLATFORM_VOCABULARY) expect(rules, term.phrase).toContain(`"${term.phrase}"`);
  });
});

describe('each limitation has one home, and the homes are the registry\'s', () => {
  const topics = Object.keys(DISCLOSURE_HOMES) as DisclosureTopic[];

  it('names a section the Compass actually writes, by its own id and name, in both mirrors', () => {
    for (const list of [EDGE_SECTIONS, FRONTEND_SECTIONS]) {
      for (const topic of topics) {
        const home = DISCLOSURE_HOMES[topic];
        const section = list.find((s) => s.id === home.sectionId);
        expect(section, `${topic} → ${home.sectionId}`).toBeTruthy();
        expect(section!.includeInCompass, home.sectionId).toBe(true);
        expect(section!.name, home.sectionId).toBe(home.sectionName);
      }
    }
  });

  it('gives no two limitations the same wording, and confines the saying to the home', () => {
    for (const topic of topics) {
      expect(inHomeSection(topic)).toContain(DISCLOSURE_HOMES[topic].sectionName);
      expect(inHomeSection(topic)).toContain('in no other section');
      expect(elsewhereOnly(topic)).toContain(`see ${DISCLOSURE_HOMES[topic].sectionName}`);
    }
  });

  it('reaches every Compass section call, in the untrimmed system block', () => {
    // `documentRules` carries nothing for the Financial Analysis tier, which
    // never carried any; the four other formats are written by the fork and
    // the condenser, which reach the voice separately.
    expect(documentRules('compass-40')).toContain(adviserVoiceRules());
  });

  it('no composed "say this" rule tells every section to say it', () => {
    // The pinned context is the same for every section call, so an
    // instruction to SAY something that sits in it is obeyed in every section
    // unless it names its home. Prohibitions are free to bind everywhere.
    const blocks: string[] = [];
    for (const [, answer] of planningAnswers()) {
      const facts = buildPlanningFacts({ planningData: answer });
      blocks.push(planningFactBlocks(facts));
      blocks.push(infrastructureRules(buildInfrastructureEvidence({ planningData: answer })));
    }
    blocks.push(publishedProjectRules([], SEARCHED), publishedProjectRules([], NOT_SEARCHED));
    for (const block of blocks) {
      for (const sentence of block.split(/(?<=[.:])\s+/)) {
        if (!/^(?:\d+[a-z]?\.\s*)?Say (?:in one sentence |once |plainly )?that\b/.test(sentence)) continue;
        expect(sentence, 'an unconfined "say that" rule').toMatch(/In the .+ section — and in no other section —/);
      }
    }
  });
});

describe('what the page prints verbatim carries none of it', () => {
  it('the planning table, the constraint register and the land-use block, in every jurisdiction', () => {
    for (const [name, answer] of planningAnswers()) {
      const page = renderPlanningControls(buildPlanningFacts({ planningData: answer }));
      expect(platformVocabularyIn(page), name).toEqual([]);
    }
  });

  it('the land-use block never lends the page a failed request\'s own words', () => {
    for (const [name, answer] of planningAnswers()) {
      const block = renderLandUseTable(buildPlanningFacts({ planningData: answer }));
      expect(block, name).not.toMatch(/HTTP \d{3}|unparseable|answered a body|error sending request|the service answered/i);
      expect(block, name).not.toMatch(/could not be asked for/i);
    }
  });

  it('the infrastructure outlook, in every jurisdiction', () => {
    for (const [name, answer] of planningAnswers()) {
      const page = renderInfrastructureOutlook(buildInfrastructureEvidence({ planningData: answer }));
      expect(platformVocabularyIn(page), name).toEqual([]);
    }
  });

  it('the major public projects block, checked and not checked, and its coverage and basis', () => {
    for (const page of [
      renderPublishedProjects([], SEARCHED),
      renderPublishedProjects([], NOT_SEARCHED),
      PUBLISHED_PROJECT_COVERAGE.join(' '),
      PUBLISHED_PROJECT_BASIS,
    ]) {
      expect(platformVocabularyIn(page), page.slice(0, 60)).toEqual([]);
    }
  });

  it('the headings the generator appends the registers under — today\'s spelling', () => {
    for (const heading of [PLANNING_REGISTER_HEADING, INFRASTRUCTURE_REGISTER_HEADING]) {
      expect(platformVocabularyIn(heading), heading).toEqual([]);
    }
    // …and the generator writes them through the constants, not a literal.
    const generator = readFileSync('supabase/functions/generate-investment-report/index.ts', 'utf8');
    expect(generator).toContain('`### ${PLANNING_REGISTER_HEADING}');
    expect(generator).toContain('`### ${INFRASTRUCTURE_REGISTER_HEADING}');
    expect(generator).not.toContain('retrieved for this property\\n');
    // A stored report keeps the heading it was written with, and is still read.
    for (const stored of Object.values(STORED_REGISTER_HEADINGS)) expect(REGISTER_HEADINGS).toContain(stored);
    for (const current of [PLANNING_REGISTER_SECTION, PLANNING_REGISTER_HEADING, INFRASTRUCTURE_REGISTER_HEADING,
      INFRASTRUCTURE_REGISTER_SECTION]) {
      expect(REGISTER_HEADINGS).toContain(current);
    }
  });
});

describe('what the writer is told to write carries none of it', () => {
  it('every supply absence, in the planning table\'s own two readings', () => {
    for (const [kind, sentence] of Object.entries(ABSENCE_SENTENCE)) {
      expect(platformVocabularyIn(sentence), kind).toEqual([]);
      expect(sentence.startsWith(`**${REGISTER_CHECKED_EMPTY}**`) || sentence.startsWith(`**${REGISTER_NOT_COVERED}**`),
        kind).toBe(true);
    }
  });

  it('every forward-demand sentence', () => {
    const statements = [
      forwardDemandStatement(null, 'QLD'),
      forwardDemandStatement(undefined, null),
      ...JURISDICTIONS.map((j) => forwardDemandStatement(null, j)),
    ];
    for (const s of statements) expect(platformVocabularyIn(s), s.slice(0, 60)).toEqual([]);
  });

  it('the transport reading', () => {
    const block = transportFactBlocks({
      transport: { nearestStation: null, distanceToStation: null, stationsWithin2km: 0, source: 'osm_amenity_register' },
    });
    expect(platformVocabularyIn(block)).toEqual([]);
  });

  it('every section\'s own instructions, in both registry mirrors', () => {
    for (const list of [EDGE_SECTIONS, FRONTEND_SECTIONS]) {
      for (const section of list) {
        expect(platformVocabularyIn(section.purpose), section.id).toEqual([]);
      }
    }
  });
});

/**
 * Every string a client- or writer-facing composer can emit, read out of its
 * own source.
 *
 * The rendered checks above drive fixtures, and a fixture can only reach the
 * branches it was written for — the market block's absence, the SWOT's
 * transport basis and the monitoring plan's cadence each carried the machine
 * room's words on a branch no fixture here takes. The literals are the
 * complete set, so they are read directly. A status enum is data, never
 * printed, and is named in `ENUM_VALUES` rather than exempted by pattern.
 */
const VOICED_MODULES = [
  'supabase/functions/_shared/planning/planningFacts.pure.ts',
  'supabase/functions/_shared/planning/infrastructureEvidence.pure.ts',
  'supabase/functions/_shared/planning/infrastructureGuide.pure.ts',
  'supabase/functions/_shared/planning/planningControlGuide.pure.ts',
  'supabase/functions/_shared/planning/landUsePermissibility.pure.ts',
  'supabase/functions/_shared/planning/publishedProjectRegister.pure.ts',
  'supabase/functions/_shared/planning/serviceNote.pure.ts',
  'supabase/functions/_shared/reports/market/approvalsFactBlocks.pure.ts',
  'supabase/functions/_shared/reports/market/openData/forwardDemand.pure.ts',
  'supabase/functions/_shared/reports/market/openData/projectionRegister.pure.ts',
  'supabase/functions/_shared/reports/market/marketFactBlocks.pure.ts',
  'supabase/functions/_shared/reports/location/amenityFactBlocks.pure.ts',
  'supabase/functions/_shared/reports/crimePromptBlocks.pure.ts',
  'supabase/functions/_shared/reports/climatePromptBlocks.pure.ts',
  'supabase/functions/_shared/reports/planningPromptBlocks.pure.ts',
  'supabase/functions/_shared/reports/regionalPromptBlocks.pure.ts',
  'supabase/functions/_shared/reports/registerAuthority.pure.ts',
  'supabase/functions/_shared/reports/investment/strategyPositions.pure.ts',
  'supabase/functions/_shared/reports/investment/chartEvidence.pure.ts',
  'supabase/functions/_shared/reports/investment/compassDocumentContract.pure.ts',
  'supabase/functions/_shared/reports/investment/riskRegister.pure.ts',
  'supabase/functions/_shared/reports/investment/subjectPrice.pure.ts',
  'supabase/functions/_shared/compassSectionContract.ts',
  // The four derived documents. The Financial Analysis and the Due Diligence
  // Report are the fork's (no model: the parent's prose plus these composed
  // chapters); the Briefing and the Snapshot are the condenser's (one model
  // call, then these composed sections). Added 25 Sep 2026 — every one of them
  // printed on a client's page and none had ever been read for the vocabulary.
  'supabase/functions/_shared/reports/investment/forkSplit.pure.ts',
  'supabase/functions/_shared/reports/investment/forkSectionContracts.pure.ts',
  'supabase/functions/_shared/reports/investment/financialChapters.pure.ts',
  'supabase/functions/_shared/reports/investment/condenseCompose.pure.ts',
  'supabase/functions/_shared/reports/investment/condenseFacts.pure.ts',
  'supabase/functions/_shared/reports/investment/scoreSections.pure.ts',
  'supabase/functions/_shared/reports/investment/tierContent.pure.ts',
  'supabase/functions/_shared/reports/investment/tierIdentity.pure.ts',
  'supabase/functions/_shared/reportSplitRegistry.ts',
  'supabase/functions/_shared/reportBindingProjection.pure.ts',
  'supabase/functions/_shared/reports/market/scoreAssessmentReading.pure.ts',
  'supabase/functions/condense-investment-report/index.ts',
] as const;

/** Status values: compared in code, never printed. */
const ENUM_VALUES = new Set(['retrieved']);

/** A module's string literals, comments removed and interpolations blanked. */
function stringLiterals(src: string): string[] {
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  const out: string[] = [];
  for (const m of code.matchAll(/'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`|"((?:[^"\\\n]|\\.)*)"/g)) {
    out.push((m[1] ?? m[2] ?? m[3]).replace(/\$\{[^}]*\}/g, ' '));
  }
  return out;
}

describe('no composer can emit the vocabulary, on any branch', () => {
  it.each(VOICED_MODULES)('%s', (file) => {
    const offending = stringLiterals(readFileSync(file, 'utf8'))
      .filter((lit) => !ENUM_VALUES.has(lit) && platformVocabularyIn(lit).length > 0)
      .map((lit) => `${platformVocabularyIn(lit).join(', ')} :: ${lit.slice(0, 100)}`);
    expect(offending).toEqual([]);
  });

  it('the scan can see the vocabulary it guards against', () => {
    // A scan that reads nothing passes everything. Its own fixture proves it reads.
    const sample = "const a = 'No register was retrieved for this coordinate.'; // the platform\n"
      + 'const b = `Loaded ${x} on this deployment`;';
    const lits = stringLiterals(sample);
    expect(lits).toHaveLength(2);
    expect(platformVocabularyIn(lits[0])).toEqual(['retrieved', 'coordinate']);
    expect(platformVocabularyIn(lits[1])).toEqual(['this deployment']);
  });
});

describe('what reached a finished document is measured, never scrubbed', () => {
  it('reports it as a warning that never fails the document', () => {
    const md = '## Infrastructure and Growth Context\n\nNo infrastructure project was retrieved for this coordinate.\n';
    const qa = runQAValidation(md, 'compass-40');
    const finding = qa.findings.find((f) => f.rule === 'platform-vocabulary');
    expect(finding?.severity).toBe('warning');
    expect(finding?.message).toContain('"retrieved"');
    expect(finding?.message).toContain('"coordinate"');
  });

  it('is silent on a document written in the adviser\'s voice', () => {
    const md = '## Infrastructure and Growth Context\n\nNo major public project is recorded within 15 km of the property.\n';
    expect(runQAValidation(md, 'compass-40').findings.map((f) => f.rule)).not.toContain('platform-vocabulary');
  });
});

/*
 * The Briefing and the Snapshot are a model's rewrite of a Compass, and
 * `documentRules` returns nothing for any tier but the Compass — so until
 * 25 Sep 2026 the condenser handed its model the parent whole and asked for
 * "the same professional tone as the original", which carried every
 * "register", "retrieved" and "Not searched" of a stored parent straight into
 * the child. A condensation is a rewrite: exactly where the words can change
 * and the findings cannot.
 */
describe('a condensed document is told the same voice', () => {
  const rules = condensedVoiceRules();

  it('names every platform phrase, as the Compass rules do', () => {
    for (const term of PLATFORM_VOCABULARY) expect(rules, term.phrase).toContain(`"${term.phrase}"`);
  });

  it('keeps the two absences apart, in the one spelling the page prints', () => {
    expect(rules).toContain(REGISTER_CHECKED_EMPTY);
    expect(rules).toContain(REGISTER_NOT_COVERED);
  });

  it('names no Compass section, because a Briefing has none of them', () => {
    for (const home of Object.values(DISCLOSURE_HOMES)) {
      expect(rules, home.sectionName).not.toContain(home.sectionName);
    }
  });

  it('shares its worked example with the Compass rules rather than restating it', () => {
    const compass = adviserVoiceRules();
    for (const line of rules.split('\n').filter((l) => /^\s+(Not|But): /.test(l))) {
      expect(compass, line).toContain(line);
    }
  });

  it('is handed to the condenser\'s model in the system message', () => {
    const condense = readFileSync('supabase/functions/condense-investment-report/index.ts', 'utf8');
    expect(condense).toContain("import { condensedVoiceRules } from '../_shared/reports/adviserVoice.pure.ts';");
    expect(condense).toMatch(/const systemPrompt = \[[\s\S]*condensedVoiceRules\(\),[\s\S]*\]\.join\('\\n\\n'\);/);
  });
});

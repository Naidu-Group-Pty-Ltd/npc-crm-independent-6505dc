import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
/**
 * The chart-evidence contract, pinned against the record it was measured on.
 *
 * Every fixture here is verbatim from the Investment Compass for 48 Redfern
 * Street, Cowra (report 09f8569e), whose record holds `demographics_data:
 * NULL`, `location_intelligence: NULL`, `data_sources.marketData: null`, no
 * planning source at all, an `investment_score` that issued no grade, and a
 * `market_fact_snapshot` recording population as absent with the ruling "not
 * client safe" — while page 11 charts it.
 */
import { describe, expect, it } from 'vitest';
import {
  assessChartEvidence,
  claimOf,
  enforceChartEvidence,
  claimSupportRules,
  readEvidenceInventory,
  readStatFences,
  type EvidenceInventory,
} from '../investment/chartEvidence.pure';
import { parseVizDirectives } from '../vizDirectives.pure';
import { presentStoredMarkdown } from '../investment/derivedHygiene.pure';

const COWRA_RECORD = {
  investment_score: { grade: 'N/A', totalScore: null, policy: { gradeIssued: false }, breakdown: {} },
  data_sources: {
    demographics: null,
    marketData: null,
    seifa: null,
    economics: { source: 'rba', confidence: 0.9 },
    crimeStatistics: { source: 'state_crime_data', confidence: 0.8 },
  },
  market_fact_snapshot: {
    facts: [
      { name: 'market.demographics', status: 'absent' },
      { name: 'market.cashRateTargetCurrent', status: 'present', value: 4.35 },
    ],
  },
};

const HELD: EvidenceInventory = {
  recordedScores: [72, 82],
  demographics: true,
  marketData: true,
  location: true,
  withheldFacts: [],
};

describe('what the record says it holds', () => {
  it('reads the inventory off the row, and a null producer is "did not answer"', () => {
    const inv = readEvidenceInventory(COWRA_RECORD);
    expect(inv.demographics).toBe(false);
    expect(inv.marketData).toBe(false);
    expect(inv.recordedScores).toEqual([]);
    expect(inv.withheldFacts).toContain('market.demographics');
  });

  it('a present producer is a producer that answered', () => {
    const inv = readEvidenceInventory({ data_sources: { demographics: { source: 'abs', confidence: 1 } } });
    expect(inv.demographics).toBe(true);
  });

  it('an absent row is an empty inventory, never an assumed one', () => {
    const inv = readEvidenceInventory(null);
    expect(inv.demographics).toBe(false);
    expect(inv.recordedScores).toEqual([]);
    expect(inv.withheldFacts).toEqual([]);
  });
});

describe('what a visual is claiming', () => {
  const claim = (src: string) => claimOf(parseVizDirectives(src)[0]);

  it('a gauge and a wheel are ratings by construction', () => {
    expect(claim('{{gauge: 72 | Location fit}}')).toBe('rating');
    expect(claim('{{wheel: 70,65,55 | labels=A,B,C | max=100}}')).toBe('rating');
  });

  it('bars out of a hundred with no unit are a minted scorecard', () => {
    expect(claim('{{bars: Planning 90, Building 80 | max=100}}')).toBe('rating');
  });

  it('bars in per cent are a composition', () => {
    expect(claim('{{bars: Detached 80, Units 10 | max=100 | unit=%}}')).toBe('share');
  });

  it('bars in kilometres are a measurement, and stay one', () => {
    expect(claim('{{bars: CBD 1.6 km, School 0.7 km | max=3 | unit=km}}')).toBe('measurement');
  });

  it('a glance, a tile strip and a timeline claim nothing quantitative', () => {
    expect(claim('{{glance: ✓ One | ◆ Two}}')).toBe('qualitative');
    expect(claim('{{tiles: A "x" int=0.8, B "y" int=0.5}}')).toBe('qualitative');
    expect(claim('{{timeline: Existing "Now", 0-2y "Soon"}}')).toBe('qualitative');
  });
});

describe('a share of a population the record does not hold', () => {
  const OCCUPIER_MIX =
    '{{donut: Family renters 45, Local owner-occupiers 35, Professionals & small households 20 '
    + '| title=Likely occupier mix | center=45% | centerSub=Family renters}}';

  it('is withheld — three axes, no denominator, no period, no census table', () => {
    const [f] = assessChartEvidence(OCCUPIER_MIX, readEvidenceInventory(COWRA_RECORD));
    expect(f.verdict).toBe('population_not_held');
    expect(f.reason).toContain('no demographics producer answered');
  });

  it('is drawn where a demographics producer DID answer', () => {
    expect(assessChartEvidence(OCCUPIER_MIX, HELD)).toEqual([]);
  });

  it('a share of the report\'s OWN evidence is not a population, and is refused for its own reason', () => {
    // "Evidence mix: Official statistics 40, Major property portals 35, Local
    // intelligence 25" describes where this report's material came from. It is
    // not a census claim, and a POPULATION rule that fired on it would fire on
    // every cost breakdown too — so the population rule still leaves it alone.
    // It is refused because nothing in this system measures the composition of
    // a finished report, which is a different statement and its own verdict.
    const evidenceMix =
      '{{donut: Official statistics 40, Major property portals 35, Local intelligence 25 | title=Evidence mix}}';
    const findings = assessChartEvidence(evidenceMix, readEvidenceInventory(COWRA_RECORD));
    expect(findings.map((f) => f.verdict)).toEqual(['self_assessment_not_measured']);
    expect(findings[0].reason).not.toContain('demographics producer');

    // The same donut without the self-assessing title is untouched: the two
    // rules are separate, and neither stands in for the other.
    const costs = '{{donut: Council rates 40, Insurance 35, Maintenance 25 | title=Annual holding costs}}';
    expect(assessChartEvidence(costs, readEvidenceInventory(COWRA_RECORD))).toEqual([]);
  });

  it('a pictograph of a transaction share is the same claim in icons', () => {
    const [f] = assessChartEvidence(
      '{{pictograph: 7/10 | label=Approximate share of core family houses in Cowra transactions '
      + '| sub=Around seven in ten sales are traditional family houses | icon=house | cols=10}}',
      readEvidenceInventory(COWRA_RECORD),
    );
    expect(f.verdict).toBe('population_not_held');
  });
});

describe('a series the client-safe gate already refused', () => {
  it('is withheld, and the finding names the gate\'s own ruling', () => {
    const [f] = assessChartEvidence(
      '{{margin: Cowra Shire ERP trend, 2015–2024 | spark=12759,12720,12690,12659,12680,12721 '
      + '| note=Broadly stable. | label=Population stability}}',
      readEvidenceInventory(COWRA_RECORD),
    );
    expect(f.verdict).toBe('series_withheld');
    expect(f.reason).toContain('market.demographics');
  });

  it('a series of something the gate did not refuse is left alone', () => {
    expect(assessChartEvidence(
      '{{margin: Cash rate | spark=4.1,4.35,4.35 | label=Rate path}}',
      readEvidenceInventory(COWRA_RECORD),
    )).toEqual([]);
  });
});

describe('a rating the engine did not record', () => {
  it('is judged by the rule that already exists, so the two cannot drift', () => {
    const found = assessChartEvidence(
      '{{gauge: 72 | Location–property alignment}}\n{{wheel: 70,65,55 | labels=A,B,C | max=100}}',
      readEvidenceInventory(COWRA_RECORD),
    );
    expect(found.every((f) => f.verdict === 'unrecorded_rating')).toBe(true);
    expect(found).toHaveLength(2);
  });

  it('says what the engine DID record, or that it issued no grade at all', () => {
    const [none] = assessChartEvidence('{{gauge: 72 | Fit}}', readEvidenceInventory(COWRA_RECORD));
    expect(none.reason).toContain('issued no grade at all');
    const [some] = assessChartEvidence('{{gauge: 61 | Fit}}', HELD);
    expect(some.reason).toContain('72, 82');
  });

  it('a rating the engine DID record is drawn', () => {
    expect(assessChartEvidence('{{gauge: 72 | Fit}}', HELD)).toEqual([]);
  });
});

describe('enforcement removes the unsupported visual and records it', () => {
  const OCCUPIER =
    '{{donut: Family renters 45, Local owner-occupiers 35, Professionals & small households 20 | title=Mix}}';

  it('does not tabulate an unsupported share — a table of it is the same claim', () => {
    // A supported dataset a chart cannot render falls back to a table, and
    // `vizFigures` still does that on the parser's `refused` list. An
    // UNSUPPORTED dataset may not: the reader would receive three percentages
    // of a population nobody measured, wearing the authority of a table.
    const { markdown, findings } = enforceChartEvidence(OCCUPIER, readEvidenceInventory(COWRA_RECORD));
    expect(markdown.trim()).toBe('');
    expect(parseVizDirectives(markdown)).toEqual([]);
    expect(markdown).not.toContain('Family renters 45');
    // Nothing is lost to the operator: the directive and its reason are the
    // audit record §2 requires the material to be retained in.
    expect(findings).toHaveLength(1);
    expect(findings[0].directive).toContain('Family renters 45');
    expect(findings[0].verdict).toBe('population_not_held');
  });

  it('removes a rating too, because a gauge\'s data IS its verdict', () => {
    const { markdown } = enforceChartEvidence('{{gauge: 72 | Fit}}\n\nProse stays.',
      readEvidenceInventory(COWRA_RECORD));
    expect(markdown).not.toContain('{{gauge');
    expect(markdown).toContain('Prose stays.');
  });

  it('never touches the prose, the headings or a qualitative visual', () => {
    const doc = [
      '## Target Occupier & Tenant Profile',
      '',
      'The locality-fit insight is that 48 Redfern Street sits within Cowra’s core residential belt.',
      '',
      OCCUPIER,
      '',
      '{{glance: ✓ Established street | ◆ Regional hub}}',
      '',
      '- **Proximity to Cowra town centre:** Approximately 1.6 km from the CBD',
    ].join('\n');
    const { markdown } = enforceChartEvidence(doc, readEvidenceInventory(COWRA_RECORD));
    for (const line of doc.split('\n')) {
      if (!line.trim() || line.startsWith('{{donut')) continue;
      expect(markdown).toContain(line);
    }
  });

  it('is a no-op on a record that holds its evidence', () => {
    const doc = `${OCCUPIER}\n\n{{gauge: 72 | Fit}}`;
    expect(enforceChartEvidence(doc, HELD)).toEqual({ markdown: doc, findings: [] });
  });
});

/*
 * The Cowra Compass draws
 *
 *     INDICATIVE LOCAL GROWTH / 3.52% / Annual house price growth, Cowra (latest published)
 *
 * at display size on page 4. `3.52` appears exactly once in the whole record —
 * inside the model's own prose, as the fence itself — while
 * `data_sources.marketData` is null, so "(latest published)" attributes a
 * provenance nothing holds. It is in 83 of the 89 stored reports, because it
 * rides the parent's content into every fork.
 */
/*
 * Page 10 of the Cowra Compass drew "Proximity of 48 Redfern Street to key
 * Cowra amenities" — 1.6 km, ~0.7 km, ~2.0 km — and page 12 set "Indicative
 * reach" as a five-row TABLE of the same figures. `location_intelligence` on
 * that row is NULL: nothing measured any of them, and the prose beside the
 * chart says where they came from — "as indicated by recent sale listings".
 *
 * `readEvidenceInventory` has computed `location` since it was written and
 * nothing read it. This is what reads it.
 */
describe('a distance nobody measured', () => {
  const NOTHING = readEvidenceInventory(COWRA_RECORD);
  const PROXIMITY = '{{bars: Core CBD & shops 1.6 km, Primary school ~0.7 km, '
    + 'Hospital & medical hub ~2.0 km | title=Proximity to key amenities | max=3 | unit=km}}';

  it('refuses a chart of kilometres where no location producer answered', () => {
    const [finding] = assessChartEvidence(PROXIMITY, NOTHING);
    expect(finding?.verdict).toBe('distance_not_measured');
    expect(finding?.reason).toMatch(/no location producer answered/);
  });

  it('keeps it where the producer DID answer', () => {
    expect(assessChartEvidence(PROXIMITY, { ...NOTHING, location: true })).toEqual([]);
  });

  it('reads the declared unit, so a travel time is judged and a dollar series is not', () => {
    const minutes = '{{bars: Shops 6 min, School 4 min | title=Everyday errands | unit=min}}';
    expect(assessChartEvidence(minutes, NOTHING)[0]?.verdict).toBe('distance_not_measured');
    const dollars = '{{bars: Subject 565000, Suburb median 498000 | title=Price | unit=$}}';
    expect(assessChartEvidence(dollars, NOTHING)).toEqual([]);
  });

  it('removes the chart and leaves the paragraph that introduces it', () => {
    const doc = ['The property sits close to the town centre.', '', PROXIMITY, '', 'Schools are within reach.'].join('\n');
    const { markdown } = enforceChartEvidence(doc, NOTHING);
    expect(markdown).not.toContain('Core CBD & shops');
    expect(markdown).toContain('The property sits close to the town centre.');
    expect(markdown).toContain('Schools are within reach.');
  });
});

describe('a figure in a summary strip', () => {
  const NOTHING_HELD = readEvidenceInventory(COWRA_RECORD);
  const GROWTH = [
    '## Location verdict',
    '',
    'The suburb is characterised by free-standing houses on generous blocks.',
    '',
    '::: stat label="Indicative local growth" unit="%" sub="Annual house price growth, Cowra (latest published)"',
    '3.52',
    ':::',
    '',
    'Tenant demand is driven by everyday needs.',
  ].join('\n');

  it('reads a fence as a structure: its label, its subtitle and its one value', () => {
    const [fence] = readStatFences(GROWTH);
    expect(fence.attrs).toContain('Indicative local growth');
    expect(fence.value).toBe('3.52');
  });

  it('refuses a market figure where no market producer answered', () => {
    const findings = assessChartEvidence(GROWTH, NOTHING_HELD);
    const stat = findings.find((f) => f.kind === 'stat');
    expect(stat?.verdict).toBe('market_not_held');
    expect(stat?.reason).toMatch(/no market producer answered/);
  });

  it('keeps it where the producer DID answer — the rule is the record, not the words', () => {
    const findings = assessChartEvidence(GROWTH, { ...NOTHING_HELD, marketData: true });
    expect(findings.filter((f) => f.kind === 'stat')).toEqual([]);
  });

  it('refuses a population or workforce figure on the same test', () => {
    const src = [
      '::: stat label="10-year population change" unit="%" sub="SA2 Moranbah"',
      '9.7',
      ':::',
    ].join('\n');
    // Nothing held and nothing withheld: the producer simply did not answer.
    const nothingWithheld = { ...NOTHING_HELD, withheldFacts: [] };
    expect(assessChartEvidence(src, nothingWithheld)[0]?.verdict).toBe('population_not_held');
    // The Cowra record's gate refused population by name, so the same figure
    // is the stronger reading: not absent, REFUSED.
    expect(assessChartEvidence(src, NOTHING_HELD)[0]?.verdict).toBe('series_withheld');
    expect(assessChartEvidence(src, { ...NOTHING_HELD, demographics: true })).toEqual([]);
  });

  it('a fence with no figure in it is a label, not a claim', () => {
    const src = ['::: stat label="Median price" sub="not published for this suburb"', 'Not published', ':::'].join('\n');
    expect(assessChartEvidence(src, NOTHING_HELD)).toEqual([]);
  });

  it('removal takes the whole block, never half a fence', () => {
    const { markdown, findings } = enforceChartEvidence(GROWTH, NOTHING_HELD);
    expect(findings.some((f) => f.kind === 'stat')).toBe(true);
    expect(readStatFences(markdown)).toEqual([]);
    expect(markdown).not.toContain('3.52');
    expect(markdown).not.toContain(':::');
    // The prose either side is untouched, which is the whole point.
    expect(markdown).toContain('free-standing houses on generous blocks');
    expect(markdown).toContain('Tenant demand is driven by everyday needs');
    expect(markdown).toContain('## Location verdict');
  });
});

describe('the read path adopts it without changing anything else', () => {
  const DOC = [
    '## Section',
    '',
    'Prose that must survive.',
    '',
    '{{gauge: 72 | Fit}}',
    '',
    '{{bars: CBD 1.6 km, School 0.7 km | max=3 | unit=km}}',
  ].join('\n');

  it('omitting the inventory is byte-identical to the behaviour before the contract', () => {
    expect(presentStoredMarkdown(DOC)).toBe(presentStoredMarkdown(DOC, null));
  });

  /*
   * This test used to assert the opposite — "a measurement in kilometres is
   * never withheld, the record is not what is wrong with it" — and reading the
   * delivered document is what changed the evidence. `location_intelligence`
   * on the Cowra row is NULL, which is the platform's own statement that no
   * producer measured anything, and the prose beside the chart says where the
   * figures came from instead: "as indicated by recent sale listings". The
   * record IS what is wrong with it, in exactly the sense the population rule
   * already recognised.
   */
  it('withholds a distance where no location producer answered, and keeps the prose', () => {
    const out = presentStoredMarkdown(DOC, readEvidenceInventory(COWRA_RECORD));
    expect(out).not.toContain('{{bars: CBD 1.6 km');
    expect(out).not.toContain('{{gauge');
    expect(out).toContain('Prose that must survive.');
  });

  it('keeps the same chart where the location producer DID answer', () => {
    const held = { ...readEvidenceInventory(COWRA_RECORD), location: true };
    expect(presentStoredMarkdown(DOC, held)).toContain('{{bars: CBD 1.6 km');
  });
});

describe('the prose half of the same contract', () => {
  const HELD_NOTHING = readEvidenceInventory(COWRA_RECORD);

  it('forbids a share of a population where none was retrieved', () => {
    // The removed occupier donut had a prose twin — "roughly 45% of tenants
    // are families". Removing the drawing and leaving the sentence moves an
    // unsupported figure rather than withdrawing it.
    const rules = claimSupportRules(HELD_NOTHING);
    expect(rules).toMatch(/NO population or household composition is held/);
    expect(rules).toMatch(/not as "roughly", not as "around half", not as "predominantly"/);
    // §3's rule, restated where the sentence is written.
    expect(rules).toMatch(/not the predicted tenant mix\s+of this particular property/);
  });

  it('forbids a proportion of transactions, which is the "7 in 10" claim', () => {
    const rules = claimSupportRules(HELD_NOTHING);
    expect(rules).toMatch(/not as "7 in 10", not as "the majority", not as "most"/);
    expect(rules).toMatch(/no denominator in this record/i);
  });

  it('forbids every other market quantity too — the strip said 3.52% "latest published"', () => {
    const rules = claimSupportRules(HELD_NOTHING).replace(/\s+/g, ' ');
    expect(rules).toContain('a capital growth rate, a median price or rent, a yield');
    expect(rules).toContain('latest published');
    expect(rules).toContain('a stat card');
  });

  it('forbids a rating in WORDS, not only in figures', () => {
    const rules = claimSupportRules(HELD_NOTHING);
    expect(rules).toMatch(/in figures OR in words/);
    for (const phrase of ['Rates strongly', 'scores\nwell', 'upper tier', 'above-average']) {
      expect(rules.replace(/\s+/g, ' ')).toContain(phrase.replace(/\s+/g, ' '));
    }
  });

  it('names the three qualitative claims the standard names', () => {
    const rules = claimSupportRules(HELD_NOTHING).replace(/\s+/g, ' ');
    for (const word of ['Renovated', 'strong demand', 'low risk', 'verified']) {
      expect(rules).toContain(word);
    }
    // And says why they need support: no digit is not no claim.
    expect(rules).toContain('happen to carry no digit');
  });

  /*
   * The Cowra document asserts "Well-presented renovated home", "a detached,
   * renovated 3-bedroom residential home" and "given the renovated interiors"
   * — three unattributed claims about the condition of somebody's house, from
   * a record that holds no condition field at all. The claim can only have
   * come from the agent's listing, and an advertisement is evidence of what
   * was advertised.
   */
  it('lets a listing claim be carried, attributed, and never as the report’s own', () => {
    const rules = claimSupportRules(HELD_NOTHING).replace(/\s+/g, ' ');
    expect(rules).toContain('evidence of what was ADVERTISED and not of the asset');
    expect(rules).toContain('written as the listing’s claim, in the sentence that uses it');
    expect(rules).toContain('never as this report’s own');
    expect(rules).toContain('No property in this report has been inspected');
  });

  it('a provider answering is not that provider supplying the figure', () => {
    const rules = claimSupportRules(HELD_NOTHING).replace(/\s+/g, ' ');
    expect(rules).toContain('it does not mean its answer contains the number beside your citation');
    expect(rules).toContain('do not cite a document nobody read');
  });

  it('where evidence IS held the rule permits the claim, with its basis', () => {
    // A prohibition with no permitted form is one a model routes around —
    // the lesson the Compass document contract already paid for.
    const held = { ...HELD_NOTHING, demographics: true, marketData: true, recordedScores: [72, 61] };
    const rules = claimSupportRules(held);
    expect(rules).toMatch(/may be stated only with the dataset, the period and the geography/);
    expect(rules).toMatch(/The scores recorded with this report's grade are 72, 61/);
  });

  it('a withheld fact may not be re-stated in prose in any form', () => {
    const withheld = { ...HELD_NOTHING, withheldFacts: ['Suburb median price'] };
    const rules = claimSupportRules(withheld);
    expect(rules).toContain('Suburb median price');
    expect(rules).toMatch(/including a\s+characterisation or a range/);
  });

  it('never asks for a placeholder or an apology in the replacement sentence', () => {
    const rules = claimSupportRules(HELD_NOTHING);
    expect(rules).toMatch(/never says "data was unavailable", never apologises/);
    expect(rules).toMatch(/an\s+absence is omitted or explained, not worded/);
  });
});

describe('the generator writes under it', () => {
  it('pins the prose rules from the same inventory shape the charts are judged on', () => {
    const src = readFileSync(
      resolve(__dirname, '../../../../supabase/functions/generate-investment-report/index.ts'),
      'utf8',
    );
    const pin = src.indexOf('const pinnedPlanningContext = [');
    const end = src.indexOf("].join('\\n\\n');", pin);
    const block = src.slice(pin, end);
    expect(block).toContain('claimSupportRules({');
    // The five fields `readEvidenceInventory` produces — so the page and the
    // sentence beside it cannot disagree about what the record holds.
    for (const key of ['recordedScores', 'demographics', 'marketData', 'location', 'withheldFacts']) {
      expect(block).toContain(`${key}:`);
    }
  });

  /*
   * Two statements of one rule is how the two come to disagree, and this pair
   * disagreed inside a single numbered list: item 2 declares CONDITION
   * governed by a record that holds no condition field, while items 4 and 6
   * asked for the listing's "features, upgrades, and selling points" and "any
   * specific renovations, improvements" with nothing saying where they came
   * from. The listing keeps what only it can supply; the attribution is what
   * makes carrying it a true sentence.
   */
  it('asks the listing’s own claims to arrive attributed, in the list that asks for them', () => {
    const src = readFileSync(
      resolve(__dirname, '../../../../supabase/functions/generate-investment-report/index.ts'),
      'utf8',
    );
    const start = src.indexOf('const sourceSpecificInstructions = `');
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, src.indexOf('`;', start));
    expect(block).toContain('is an ADVERTISEMENT');
    expect(block).toContain('carry them ATTRIBUTED');
    expect(block).toContain('never as an assertion of your own');
    // The words that were being asserted, named so the rule reaches them.
    for (const word of ['renovated', 'updated', 'well presented']) {
      expect(block).toContain(`"${word}"`);
    }
    // And the instruction that used to ask for them bare is gone.
    expect(block).not.toContain('Include all relevant property features, upgrades, and selling points');
    expect(block).not.toContain('Note any specific renovations, improvements, or unique characteristics');
  });
});

/**
 * A chart about the report's own evidence.
 *
 * Page 17 of the delivered Cowra Financial Analysis drew
 * `{{donut: Official statistics 40, Major property portals 35, Local
 * intelligence 25 | title=Evidence mix}}` on a record holding
 * `marketData: null`, `location_intelligence: NULL` and
 * `demographics_data: NULL`. It is the one chart a reader uses to decide how
 * much to trust every other number in the document, and it was the least
 * supported thing in it — and it survived every other rule here, because
 * "Official statistics" is neither a population subject nor a market one.
 *
 * Measured across the stored corpus (11 distinct documents, 216 directives,
 * 102 titled, 64 distinct titles) exactly five titles match, and all five are
 * this. Nothing else in the corpus is judged by it.
 */
describe('a chart about the report\'s own evidence', () => {
  const inv = readEvidenceInventory(COWRA_RECORD);

  it('refuses the evidence mix, with its own verdict', () => {
    const md = [
      'Some prose.',
      '{{donut: Official statistics 40, Major property portals 35, Local intelligence 25 | title=Evidence mix | center=40% | centerSub=Official statistics}}',
      'More prose.',
    ].join('\n');
    const out = enforceChartEvidence(md, inv);
    expect(out.markdown).not.toContain('{{donut');
    expect(out.markdown).toContain('Some prose.');
    expect(out.markdown).toContain('More prose.');
    const finding = out.findings.find((f) => f.verdict === 'self_assessment_not_measured');
    expect(finding).toBeDefined();
    expect(finding!.reason).toContain('acquisition ledger');
  });

  it('is decided by the title, not by a label that happens to say "confidence"', () => {
    // A risk wheel with one "Data confidence" spoke is a chart about risk.
    const risk = '{{wheel: 65,60,55,70,50,60 | labels=Crime,Environmental,Planning,Supply,Transport,Data confidence | max=100 | title=Composite risk profile}}';
    const out = enforceChartEvidence(risk, inv);
    expect(out.findings.some((f) => f.verdict === 'self_assessment_not_measured')).toBe(false);
  });

  it('holds however much evidence the record has, because nothing counts this', () => {
    // Not a producer question: a full inventory does not make it supported,
    // because no producer publishes the composition of the finished report.
    const md = '{{donut: ABS Census 2021 40, ABS SEIFA 2021 25, Regional Population 25, Other official sources 10 | title=Primary data foundations}}';
    for (const inventory of [inv, HELD]) {
      const out = enforceChartEvidence(md, inventory);
      expect(out.markdown.trim()).toBe('');
      expect(out.findings[0].verdict).toBe('self_assessment_not_measured');
    }
  });

  it('judges every primitive, because the assertion is the same in each', () => {
    const grid = '{{heatmap: 1,1,0 / 1,0,1 / 0,1,1 | rows=Planning certainty,Parcel clarity,Development activity | cols=High,Moderate,Limited | title=Evidence quality at the property level}}';
    const mix = '{{bars: Address-specific data 60, Suburb/postcode data 30, General market context 10 | title=Data resolution mix | max=100 | unit=%}}';
    for (const md of [grid, mix]) {
      expect(enforceChartEvidence(md, HELD).findings.some((f) => f.verdict === 'self_assessment_not_measured')).toBe(true);
    }
  });

  it('leaves a chart about the property alone', () => {
    const md = '{{bars: Kitchen 3, Bathroom 2, Living 4 | title=Dwelling type alignment}}';
    expect(enforceChartEvidence(md, HELD).findings.some((f) => f.verdict === 'self_assessment_not_measured')).toBe(false);
  });
});

/**
 * The prose counterpart of `distance_not_measured`, and the larger half of the
 * same gap: `inv.location` gated a chart rule and no sentence rule at all.
 *
 * Measured on the delivered Cowra Due Diligence Report, whose record holds
 * `location_intelligence: NULL`. Pages 14–16 — the most detailed pages in the
 * whole set — state "Mulyan Public School is approximately 0.5 km … as
 * confirmed by Domain's school catchment summary for this address", "roughly
 * 2–3 km based on town layout", "around 5–10 minutes by car" and a bus stop
 * read off a timetable nobody fetched.
 */
describe('a distance in a sentence', () => {
  it('forbids the measurement, the range and the softened form where no producer answered', () => {
    const rules = claimSupportRules(readEvidenceInventory(COWRA_RECORD));
    const rule = rules.split('\n').find((l) => l.startsWith('6.'))!;
    expect(rule).toContain('NO location, amenity, transport or school measurement');
    expect(rule).toContain('kilometres');
    expect(rule).toContain('minutes');
    expect(rule).toContain('a short drive');
    expect(rule).toContain('within walking distance');
    // The attribution half: a provider that supplied nothing may not be cited
    // for a figure, which is what "confirmed by Domain's school catchment
    // summary" was.
    expect(rule).toContain('may not attribute one to a provider');
  });

  it('prohibits the measurement, not the place — a report may still describe the town', () => {
    const rule = claimSupportRules(readEvidenceInventory(COWRA_RECORD))
      .split('\n').find((l) => l.startsWith('6.'))!;
    expect(rule).toContain('you may name a facility as a place that exists');
    expect(rule).toContain('what a buyer would check');
  });

  it('asks for the record\'s own units where a producer DID answer', () => {
    const rule = claimSupportRules(HELD).split('\n').find((l) => l.startsWith('6.'))!;
    expect(rule).toContain('only as the record measured it');
    expect(rule).not.toContain('NO location');
  });

  it('keeps every rule numbered once, in order, whatever the inventory holds', () => {
    for (const inventory of [readEvidenceInventory(COWRA_RECORD), HELD]) {
      const numbered = claimSupportRules(inventory).split('\n')
        .map((l) => /^(\d+)\./.exec(l)?.[1])
        .filter((n): n is string => Boolean(n))
        .map(Number);
      expect(numbered).toEqual(numbered.map((_, i) => i + 1));
    }
  });
});

/**
 * The prose counterpart of `self_assessment_not_measured`, and the same
 * relationship rule 6 has to `distance_not_measured`: the chart verdict judges
 * directives, and page 10 of the delivered Snapshot writes the claim as a
 * bullet instead —
 *
 *   "Evidence mix underpinning this report: Official statistics **40%**,
 *    Commercial property data **35%**, Local intelligence **15%**, Advisory
 *    interpretation **10%**."
 *
 * Measured: 1 prose line across the 11 stored documents, against 5 directives.
 * It belongs in rule 5 rather than a rule of its own, because rule 5 is
 * already the provenance rule and this is a claim about provenance.
 */
describe('the report\'s own evidence base, in a sentence', () => {
  it('is named in the source-note rule, on every inventory', () => {
    for (const inventory of [readEvidenceInventory(COWRA_RECORD), HELD]) {
      const rule = claimSupportRules(inventory).split('\n').find((l) => l.startsWith('5.'))!;
      expect(rule).toContain('is not a measured quantity');
      expect(rule).toContain('evidence mix');
      expect(rule).toContain('Name the sources you actually used instead');
    }
  });
});

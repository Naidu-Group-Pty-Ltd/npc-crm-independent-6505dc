import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  auditGovernedNarrativeAuthority,
  governedCategoryDirective,
  subjectPostcodeForAudit,
} from '../contract/governedNarrativeAuthority.pure';

/*
 * RF-7.2B.1A.1 — precision of the governed-authority enforcement.
 *
 * RF-7.2B.1A made `blocking: true` a real refusal on both renderers and the
 * portal. The first production run through the real pipeline (backend report
 * a6f0693c, 48 Redfern Street Cowra NSW 2794, geography unresolved) then
 * showed the enforcement blocking FOUR units of legitimate prose and one real
 * fabrication. Left alone, that refuses correct reports at the delivery gate —
 * and the worst of the four was the model's own correct disclosure that the
 * data could not be established, which the directive explicitly asks for.
 *
 * Every string marked "PRODUCTION" below is verbatim from that report.
 */

const absent = (name: string) => ({
  name, status: 'absent' as const, value: null, source: null, dataset: null,
  grain: null, geographyId: null, referencePeriod: null, asOf: null, ruling: 'withheld',
});
const present = (name: string, value: number) => ({
  ...absent(name), status: 'present' as const, value, source: 'abs_census_poa', ruling: 'trusted',
});
const snapshotOf = (facts: unknown[]) =>
  ({ capturedAt: '', assuranceVersion: '1', geography: { postcode: null }, facts }) as never;

const ALL_WITHHELD = snapshotOf([
  'market.demographics', 'market.population', 'market.medianAge',
  'market.medianHouseholdIncomeWeekly', 'market.medianRentWeekly',
  'market.medianMortgageMonthly', 'market.ownerOccupierRate',
  'abs.seifa.irsd', 'abs.seifa.irsad', 'abs.seifa.ier', 'abs.seifa.ieo',
  'abs.unemploymentRate', 'abs.labourForceParticipation', 'abs.labourForce',
  'abs.industryShare.mining',
].map(absent));

const COWRA = { subjectPostcode: '2794' };
const blocks = (text: string, snap = ALL_WITHHELD, ctx = COWRA) =>
  auditGovernedNarrativeAuthority(text, snap, ctx).length > 0;
const topicsOf = (text: string, snap = ALL_WITHHELD, ctx = COWRA) =>
  auditGovernedNarrativeAuthority(text, snap, ctx).map((f) => `${f.topic}/${f.kind}`);

// ── The five production units ───────────────────────────────────────────────

const P1_LAND_SIZE =
  "The property's large 988 m² land size drives demand from families and long-term renters who "
  + 'value outdoor space, storage and the ability to accommodate pets, sheds or play equipment in '
  + 'a way that smaller lots cannot easily support.';

const P2_DISCLOSURE =
  'Population and demographic statistics for the specific 2794 postal area could not be '
  + 'established from authoritative sources, so no resident counts, age profiles, income medians '
  + 'or SEIFA scores have been used in this report for demand analysis.';

const P3_BOCSAR_COUNTS =
  'The total count of **1,144 recorded offences** for 2025, compared with **1,111** in the '
  + 'previous 12 months, confirms a **3% increase in incidents** at postcode level, based on NSW '
  + "BOCSAR's recorded criminal incidents by month by postcode, using 2021 Census usual residents "
  + 'as the denominator for rate calculations.';

const P4_BOCSAR_RATE =
  "The postcode's recorded 1,144 criminal incidents in 2025 and a rate of 10,891 offences per "
  + '100,000 residents, compared with 7,598 per 100,000 across NSW, indicate a materially higher '
  + 'crime environment.';

const P5_DONUT =
  '{{donut: Family households 50, Working couples without children 25, Older residents 25 | '
  + 'title=Indicative composition of likely occupants by life stage | center=50% | '
  + 'centerSub=Family-focused households}}';

describe('RF-7.2B.1A.1 — the five production units', () => {
  it('PRODUCTION: the property\'s own land size is not a tenure claim', () => {
    expect(blocks(P1_LAND_SIZE)).toBe(false);
  });

  it('PRODUCTION: the model\'s own absence disclosure is not an assertion', () => {
    expect(blocks(P2_DISCLOSURE)).toBe(false);
  });

  it('PRODUCTION: BOCSAR offence counts are not demographics', () => {
    expect(blocks(P3_BOCSAR_COUNTS)).toBe(false);
  });

  it('PRODUCTION: a per-100,000 crime rate is not a population claim', () => {
    expect(blocks(P4_BOCSAR_RATE)).toBe(false);
  });

  it('PRODUCTION: the quantified demographic donut REMAINS a true positive', () => {
    expect(blocks(P5_DONUT)).toBe(true);
    expect(topicsOf(P5_DONUT)).toContain('population/substituted_figure');
  });
});

// ── Attribution, both directions ────────────────────────────────────────────

describe('RF-7.2B.1A.1 — figure before and after its label', () => {
  it('label first: "land size is 988 m²"', () => {
    expect(blocks('The land size is 988 m² and suits long-term renters.')).toBe(false);
  });

  it('value first: "988 m² land size"', () => {
    expect(blocks('The 988 m² land size suits long-term renters.')).toBe(false);
  });

  it('both directions hold for the deal\'s other figures', () => {
    expect(blocks('The $555,000 purchase price appeals to owner-occupiers.')).toBe(false);
    expect(blocks('The purchase price of $555,000 appeals to owner-occupiers.')).toBe(false);
    expect(blocks('An 80% loan-to-value ratio suits renters seeking stability.')).toBe(false);
  });

  it('the exemption cannot reach across the sentence to excuse a real claim', () => {
    // A land-size mention elsewhere must not excuse a median-age figure.
    expect(blocks('The land size is 988 m², and the median age of residents is 36.')).toBe(true);
    expect(topicsOf('The land size is 988 m², and the median age of residents is 36.'))
      .toContain('medianAge/substituted_figure');
  });
});

// ── The subject postcode ────────────────────────────────────────────────────

describe('RF-7.2B.1A.1 — the subject postcode is not a governed figure', () => {
  it('exempts the subject postcode in postcode position', () => {
    expect(blocks('No resident counts are available for the 2794 postal area.')).toBe(false);
    expect(blocks('Demographic data for postcode 2794 could not be established.')).toBe(false);
    expect(blocks('Population data for Cowra NSW 2794 is not available.')).toBe(false);
  });

  it('is NOT a blanket four-digit rule — a governed figure of 2794 still blocks', () => {
    expect(blocks('The area recorded a population of 2794 residents at the last count.')).toBe(true);
    expect(blocks('The median age of residents is 2794.')).toBe(true);
  });

  it('a four-digit governed statistic that is not the postcode still blocks', () => {
    expect(blocks('The area recorded a population of 8431 residents.')).toBe(true);
    expect(blocks('SEIFA IRSD for the area is 1024.')).toBe(true);
  });

  it('only the SUBJECT postcode is exempt, not any postcode-shaped number', () => {
    expect(blocks('No resident counts are available for the 2795 postal area.')).toBe(true);
  });

  it('with no subject postcode supplied, nothing is exempted on that ground', () => {
    // Measured, and the reason the context is threaded through both writers:
    // without the subject postcode the postal-area number is indistinguishable
    // from a figure ABOUT the area, and even the disclosure is refused because
    // the number sits right beside the topic it disclaims.
    expect(blocks('Population data for the 2794 postal area could not be established.',
      ALL_WITHHELD, { subjectPostcode: undefined })).toBe(true);
    // ...and supplying it is what makes the same sentence read correctly.
    expect(blocks('Population data for the 2794 postal area could not be established.'))
      .toBe(false);
  });
});

// ── Address and amenity measurements ───────────────────────────────────────

/*
 * Found by replaying the retained production report rather than by reasoning:
 * four further units were refused over a street number and a walking distance.
 */
describe('RF-7.2B.1A.1 — an address and a distance are not demographics', () => {
  it('PRODUCTION: a street number beside "residents" does not block', () => {
    expect(blocks(
      '48 Redfern Street sits within an established residential pocket of Cowra, giving '
      + 'residents close access to local parks and town-based recreation facilities that '
      + 'underpin a comfortable, active lifestyle.',
    )).toBe(false);
  });

  it('PRODUCTION: "residents at 48 Redfern Street" does not block', () => {
    expect(blocks(
      'Given Cowra\u2019s role as a regional centre rather than a metropolitan suburb, most '
      + 'residents at 48 Redfern Street will rely primarily on private car travel for commuting.',
    )).toBe(false);
  });

  it('PRODUCTION: an amenity distance does not block', () => {
    expect(blocks(
      'Residents at 48 Redfern Street have practical access to the CBD and associated services '
      + 'approximately 1.6 kilometres away, allowing most daily needs to be met with a short drive.',
    )).toBe(false);
  });

  it('PRODUCTION: a distance RANGE and a drive time do not block', () => {
    expect(blocks(
      'The nearby mix of neighbourhood parks, sports fields within roughly 1\u20133 kilometres, and '
      + 'river-corridor recreation reachable with a short 5\u201310 minute drive supports demand from '
      + 'residents who want everyday town amenity.',
    )).toBe(false);
  });

  it('a measured age in YEARS is still a median-age claim', () => {
    // `years` is deliberately absent from the duration list.
    expect(blocks('The median age of residents is 36 years.')).toBe(true);
  });

  it('a street-number exemption cannot excuse a figure that is not an address', () => {
    expect(blocks('At 48 Redfern Street the population is 13,795 residents.')).toBe(true);
  });
});

// ── The model does not always type an ASCII hyphen ──────────────────────────

describe('RF-7.2B.1A.1 — compound governed terms survive the model\u2019s typography', () => {
  it('PRODUCTION: a demand chart using U+2011 in "owner\u2011occupiers" is DETECTED', () => {
    // This unit passed before the hotfix only because the non-breaking hyphen
    // hid the term from the detector — a recall hole, closed here.
    expect(blocks(
      '{{bars: School\u2011oriented families 8, Local workers 7, Long\u2011term owner\u2011occupiers 8, '
      + 'Downsizers 4 | title=Indicative demand strength by household type (0\u201310 scale) | max=10}}',
    )).toBe(true);
    expect(topicsOf(
      '{{bars: School\u2011oriented families 8, Local workers 7, Long\u2011term owner\u2011occupiers 8, '
      + 'Downsizers 4 | title=Indicative demand strength by household type (0\u201310 scale) | max=10}}',
    )).toContain('tenure/substituted_figure');
  });

  it('every hyphen form of the tenure term is detected', () => {
    for (const h of ['-', '\u2010', '\u2011', '\u2012', '\u2013', '\u2014', ' ']) {
      expect(blocks(`Owner${h}occupiers make up 62% of dwellings.`)).toBe(true);
    }
  });

  it('every hyphen form of socio-economic is detected', () => {
    for (const h of ['-', '\u2011', '\u2013', ' ']) {
      expect(blocks(`The socio${h}economic index for the area is 947.`)).toBe(true);
    }
  });
});

// ── A crime chart is still crime ───────────────────────────────────────────

describe('RF-7.2B.1A.1 — a crime chart is not a demographic chart', () => {
  it('PRODUCTION: the recorded-offence rate chart does not block', () => {
    expect(blocks(
      '{{bars: Postcode 2794 10891, NSW postal-area average 7598 | title=Recorded offences per '
      + '100,000 residents (2025 calendar year, BOCSAR) | max=12000 | unit=rate}}',
    )).toBe(false);
  });
});

// ── Disclosure vs smuggling ─────────────────────────────────────────────────

describe('RF-7.2B.1A.1 — there is NO disclosure or negation exemption', () => {
  /*
   * The first cut of this hotfix exempted a unit naming an explicit absence
   * while no surviving figure sat within 40 characters of the topic. The
   * adversarial pass showed the distance IS the evasion. The rule is gone; the
   * production disclosure passes because the subject-postcode exemption leaves
   * it with no figure at all, not because it disclaims anything.
   */

  it('1. same sentence, distant figure — BLOCKS', () => {
    expect(blocks(
      'Median age could not be established from authoritative sources for this postal area; '
      + 'however, broader commentary suggests the current median age is 41.',
    )).toBe(true);
  });

  it('2. disclosure followed by an unsupported population — BLOCKS', () => {
    expect(blocks(
      'Population data for the postcode could not be established from authoritative sources. '
      + 'Based on broader market information, the area has approximately 12,272 residents.',
    )).toBe(true);
  });

  it('3. disclosure followed by cross-grain substitution — BLOCKS as cross_grain', () => {
    const t = 'No authoritative postcode-level income figure was available. At the wider SA2 '
      + 'level the median household income is $1,742 per week.';
    expect(blocks(t)).toBe(true);
    expect(topicsOf(t)).toContain('income/cross_grain_substitution');
  });

  it('4. legitimate pure disclosure — PASSES', () => {
    expect(blocks(P2_DISCLOSURE)).toBe(false);
  });

  it('5. the production disclosure containing 2794 — PASSES', () => {
    expect(blocks(
      'Population and demographic statistics for the specific 2794 postal area could not be '
      + 'established from authoritative sources, so no resident counts, age profiles, income '
      + 'medians or SEIFA scores have been used in this report.',
    )).toBe(false);
  });

  // ── distance-evasion probes: the term stated ONCE, the figure pushed away ──

  it('EVASION: a pronoun places the figure far from the term — still BLOCKS', () => {
    expect(blocks(
      'Median age could not be established from authoritative sources for this particular '
      + 'postal area, but other commentary sources put it at about 41.',
    )).toBe(true);
  });

  it('EVASION: padding between the disclaimer and a bare figure — still BLOCKS', () => {
    expect(blocks(
      'Population statistics could not be established from authoritative sources for this area, '
      + 'and after considerable additional desktop review the number appears to be 12,272.',
    )).toBe(true);
  });

  it('EVASION: a SEIFA disclaimer with a distant score — still BLOCKS', () => {
    expect(blocks(
      'SEIFA scores could not be established from authoritative sources for this postal area, '
      + 'though secondary commentary elsewhere indicates a score of about 947.',
    )).toBe(true);
  });

  it('an ordinary negation exempts nothing', () => {
    expect(blocks('This is not a small area: the population is 13,795.')).toBe(true);
  });

  it('the module carries no disclosure or negation exemption at all', () => {
    const src = readFileSync(resolve(__dirname,
      '../../../../supabase/functions/_shared/reports/contract/governedNarrativeAuthority.pure.ts'),
      'utf-8');
    expect(src).not.toMatch(/const ABSENCE_DISCLOSURE\s*=/);
    expect(src).not.toMatch(/function disclosureStands/);
    expect(src).not.toMatch(/DISCLOSURE_PROXIMITY/);
  });
});

// ── Crime ───────────────────────────────────────────────────────────────────

describe('RF-7.2B.1A.1 — recorded crime is not demographic authority', () => {
  it('accepts the production offence counts and rate', () => {
    expect(blocks(P3_BOCSAR_COUNTS)).toBe(false);
    expect(blocks(P4_BOCSAR_RATE)).toBe(false);
  });

  it('accepts an ordinary QLD/SA equivalent', () => {
    expect(blocks('QPS recorded 842 offences in the suburb, a rate of 4,102 per 100,000 residents.'))
      .toBe(false);
  });

  it('ADVERSARIAL: a crime source cannot carry a demographic figure', () => {
    expect(blocks('BOCSAR records 1,144 offences; the median age is 41.')).toBe(true);
    expect(topicsOf('BOCSAR records 1,144 offences; the median age is 41.'))
      .toContain('medianAge/substituted_figure');
  });

  it('ADVERSARIAL: naming BOCSAR does not exempt a population count', () => {
    expect(blocks('BOCSAR crime data aside, the population is 13,795 residents.')).toBe(true);
  });

  it('is not a keyword pass — "crime" alone exempts nothing', () => {
    expect(blocks('Crime is a consideration, and the population is 13,795.')).toBe(true);
  });
});

// ── Recall unchanged ────────────────────────────────────────────────────────

describe('RF-7.2B.1A.1 — recall is not weakened', () => {
  it('an unsupported demographic percentage still blocks', () => {
    expect(blocks('Owner-occupiers make up 62% of dwellings in the area.')).toBe(true);
  });

  it('an unsupported demographic chart still blocks', () => {
    expect(blocks('{{bars: Owner-occupiers 62, Renters 38 | title=Tenure mix}}')).toBe(true);
  });

  it('a false ABS/Census attribution still blocks, as false_attribution', () => {
    const t = 'According to the Australian Bureau of Statistics 2021 Census, the area recorded '
      + '12,272 residents.';
    expect(blocks(t)).toBe(true);
    expect(topicsOf(t)).toContain('population/false_attribution');
  });

  it('a cross-grain substitute figure still blocks, as cross_grain_substitution', () => {
    const t = 'The surrounding SA2 records a median age of 42 for its residents.';
    expect(blocks(t)).toBe(true);
    expect(topicsOf(t).some((x) => x.endsWith('/cross_grain_substitution'))).toBe(true);
  });

  it('the original two production fabrications still block', () => {
    expect(blocks(
      'According to the Australian Bureau of Statistics 2021 Census, Muswellbrook township '
      + 'recorded 12,272 residents, with a median age of 35.',
    )).toBe(true);
  });

  it('an admissible fact used accurately still passes', () => {
    const snap = snapshotOf([present('market.population', 13795), present('market.medianAge', 36)]);
    expect(blocks('The area has 13,795 residents and a median age of 36.', snap)).toBe(false);
  });
});

// ── Qualitative commentary ──────────────────────────────────────────────────

describe('RF-7.2B.1A.1 — qualitative commentary stays permitted', () => {
  it('governed words with no figures never block', () => {
    expect(blocks(
      'The home suits long-term family renters and owner-occupiers who value space, and the local '
      + 'workforce is weighted towards agriculture and health services.',
    )).toBe(false);
  });

  it('the deal\'s own numbers beside qualitative demographic words never block', () => {
    expect(blocks(
      'Leased at $445 per week on a 988 m² block, the property suits owner-occupiers and renters '
      + 'alike; stamp duty of $19,162 applies.',
    )).toBe(false);
  });
});

// ── The directive ───────────────────────────────────────────────────────────

describe('RF-7.2B.1A.1 — the directive forbids invented distributions', () => {
  const directive = governedCategoryDirective(ALL_WITHHELD);

  it('names charts and percentage splits specifically', () => {
    expect(directive).toMatch(/percentage split/i);
    expect(directive).toMatch(/donut/i);
    expect(directive).toMatch(/\{\{bars/);
  });

  it('refuses the "indicative" escape hatch by name', () => {
    expect(directive).toMatch(/indicative/i);
    expect(directive).toMatch(/does not make it qualitative/i);
  });

  it('still permits qualitative discussion', () => {
    expect(directive).toMatch(/discuss the area qualitatively/i);
  });

  it('is empty when nothing is withheld', () => {
    const snap = snapshotOf([
      'market.demographics', 'market.population', 'market.medianAge',
      'market.medianHouseholdIncomeWeekly', 'market.medianRentWeekly',
      'market.medianMortgageMonthly', 'market.ownerOccupierRate',
      'abs.seifa.irsd', 'abs.seifa.irsad', 'abs.seifa.ier', 'abs.seifa.ieo',
      'abs.unemploymentRate', 'abs.labourForceParticipation', 'abs.labourForce',
      'abs.industryShare.mining',
    ].map((n) => present(n, 1)));
    expect(governedCategoryDirective(snap)).toBe('');
  });
});

// ── The postcode helper ─────────────────────────────────────────────────────

describe('RF-7.2B.1A.1 — subjectPostcodeForAudit', () => {
  it('prefers a resolved geography postcode', () => {
    expect(subjectPostcodeForAudit({ geography: { postcode: '2333' } }, '48 Redfern St NSW 2794'))
      .toBe('2333');
  });

  it('falls back to the address, which is the unresolved case that matters', () => {
    expect(subjectPostcodeForAudit({ geography: { postcode: null } },
      '48 Redfern Street, Cowra NSW 2794')).toBe('2794');
  });

  it('takes the LAST four-digit group, not a street number', () => {
    expect(subjectPostcodeForAudit(null, '1234 Example Road, Somewhere VIC 3000')).toBe('3000');
  });

  it('returns null when there is nothing to read', () => {
    expect(subjectPostcodeForAudit(null, null)).toBeNull();
    expect(subjectPostcodeForAudit(null, 'Unit 2, Example Road')).toBeNull();
  });
});

// ── Both audit sites pass the context ───────────────────────────────────────

describe('RF-7.2B.1A.1 — both writers judge with the same context', () => {
  const read = (p: string) => readFileSync(resolve(__dirname, '../../../../', p), 'utf-8');
  const gen = read('supabase/functions/generate-investment-report/index.ts');
  const regen = read('supabase/functions/regenerate-report-qualitative/index.ts');

  it('first generation supplies the subject postcode', () => {
    expect(gen).toContain('subjectPostcodeForAudit(safeGeneration.snapshot, propertyAddress)');
  });

  it('regeneration supplies it too — one document, one judgement', () => {
    expect(regen).toContain('subjectPostcodeForAudit(safeGeneration.snapshot, propertyAddress)');
  });
});

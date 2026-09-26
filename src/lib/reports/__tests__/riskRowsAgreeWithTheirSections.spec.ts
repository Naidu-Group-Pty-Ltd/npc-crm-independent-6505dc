/**
 * The Risk Dashboard and the SWOT say what the rest of the document says.
 *
 * The 60 Lawley Street Compass (25 Sep 2026) contradicted itself three times
 * across its closing pages:
 *
 *  - Environment, Climate & Safety said, correctly, that "this report states
 *    no crime count, rate, period or safety rating for Spalding" — and the
 *    Risk Dashboard rated crime **High**, "Verified", from a council area
 *    profile found by search;
 *  - Transport & Connectivity said the Google Places count of zero stations
 *    "should not be treated as evidence that public transport is absent" —
 *    and the Risk Dashboard rated transport reliance **Moderate** from it;
 *  - the verdict page listed "Rapid recent price growth may indicate market
 *    cooling ahead" as a consideration, and the SWOT said of Threats "None
 *    identified".
 *
 * The first two were a general rule ("Not assessed is the level wherever the
 * evidence is something this report did not confirm") losing to a specific
 * cue in front of the model; the fix hands the register its row, in its own
 * vocabulary, from the block that owns the subject. The third was two readers
 * of one record reading different lists; there is one reader now.
 */
import { describe, expect, it } from 'vitest';

import { crimeStatBlocks } from '../../../../supabase/functions/_shared/reports/crimePromptBlocks.pure';
import { transportFactBlocks } from '../../../../supabase/functions/_shared/reports/location/amenityFactBlocks.pure';
import {
  NOT_ASSESSED,
  RISK_EVIDENCE_READINGS,
  RISK_EXPOSURE_LEVELS,
  unratedRiskRow,
} from '../../../../supabase/functions/_shared/reports/investment/riskRegister.pure';
import {
  recordedMarketRisks,
  verdictWatchPoints,
} from '../../../../supabase/functions/_shared/reports/investment/scoreSections.pure';
import {
  composeSwot,
  readStrategyRecord,
} from '../../../../supabase/functions/_shared/reports/investment/strategyPositions.pure';
import { platformVocabularyIn } from '../../../../supabase/functions/_shared/reports/adviserVoice.pure';
import type { MarketFacts } from '../../../../supabase/functions/_shared/reports/market/marketFactBlocks.pure';
import type { SubjectPrice } from '../../../../supabase/functions/_shared/reports/investment/subjectPrice.pure';

const ROW = (evidence: string) => new RegExp(`row reads "${NOT_ASSESSED}" with evidence "${evidence}"`);

describe('the row a section hands the register is in the register\'s own vocabulary', () => {
  it('names a level the register has and an evidence reading it has, and no platform word', () => {
    expect(RISK_EXPOSURE_LEVELS).toContain(NOT_ASSESSED);
    for (const evidence of RISK_EVIDENCE_READINGS) {
      const row = unratedRiskRow('crime', evidence, 'this report holds no recorded-crime figures for the area.');
      expect(row).toMatch(ROW(evidence));
      expect(platformVocabularyIn(row)).toEqual([]);
    }
  });

  it('says a searched page is context, never a rating and never "Verified"', () => {
    const row = unratedRiskRow('crime', 'Not checked', 'x.');
    expect(row).toMatch(/never a rating and never "Verified"/);
  });
});

describe('crime: the register rates nothing the report does not hold', () => {
  it('hands the register "Not assessed" / "Not checked" wherever no recorded-crime figures are held', () => {
    expect(crimeStatBlocks({})).toMatch(ROW('Not checked'));
    expect(crimeStatBlocks({ crimeStatistics: {} })).toMatch(ROW('Not checked'));
  });

  it('PRESERVATION — hands over nothing where recorded figures ARE held, so the rating stays the writer\'s', () => {
    const held = crimeStatBlocks({
      crimeStatistics: {
        totalLast12Months: 412, totalPrevious12Months: 398, totalChangePct: 3.5,
        area: '2155', areaKind: 'postcode', referencePeriod: 'Jul 2025 – Jun 2026',
        source: 'NSW Bureau of Crime Statistics and Research',
      },
    });
    expect(held).toContain('**412**');
    expect(held).not.toMatch(/row reads "Not assessed"/);
  });
});

describe('transport: the register rates nothing the stop data did not measure', () => {
  it('a station count alone is "Unverified" — the count was taken, the check that settles it was not', () => {
    const li = { transport: { stationsWithin2km: 0, source: 'google_places' } };
    const block = transportFactBlocks(li);
    expect(block).toMatch(/Transit stations within 5 km \(Google Places\): \*\*0\*\*/);
    expect(block).toMatch(ROW('Unverified'));
  });

  it('no reading at all is "Not checked"', () => {
    expect(transportFactBlocks({})).toMatch(ROW('Not checked'));
  });

  it('outside every loaded network is "Not checked", beside the sentence that says so', () => {
    const block = transportFactBlocks({ transport: { verdict: 'outside_loaded_networks' } });
    expect(block).toMatch(/does not cover this area/);
    expect(block).toMatch(ROW('Not checked'));
  });

  it('PRESERVATION — a measured reading hands the register nothing, so a real rating stays possible', () => {
    for (const verdict of ['stops_nearby', 'none_within_radius']) {
      const block = transportFactBlocks({
        transport: {
          verdict, nearestStation: 'Station St', distanceToStation: 0.4, stopsWithinRadius: 6, radiusMetres: 1600,
          sources: ['Transport for NSW'],
        },
      });
      expect(block, verdict).not.toMatch(/row reads "Not assessed"/);
    }
  });
});

describe('the SWOT reads the risks the verdict page reads', () => {
  const V2 = {
    grade: 'A+', totalScore: 89,
    recommendation: 'STRONG BUY - Excellent investment opportunity with strong fundamentals across the metrics assessed.',
    v2: { authority: 'v2' },
    weaknesses: [],
    risks: ['Rapid recent price growth may indicate market cooling ahead'],
  };
  const NO_MARKET: MarketFacts = {
    rows: [], withheld: [], unavailable: [], consulted: [], anyStated: false, evidenceMissing: true,
  };
  const PRICE: SubjectPrice = {
    basis: 'accepted_input', value: 499_000,
    label: 'Purchase price this analysis is modelled on', provenance: 'recorded by the adviser for this assessment',
  };
  const swotFor = (score: unknown) => composeSwot(readStrategyRecord(
    { propertyAddress: '60 Lawley Street, Spalding WA 6530', investmentScore: score },
    { market: NO_MARKET, price: PRICE, carriesModelling: false, transport: null },
  ), 'SWOT Analysis');
  const threats = (swot: string) => swot.split('### Threats')[1]?.split('\n### ')[0] ?? '';

  it('one reader: the verdict page\'s watch points and the SWOT\'s Threats come from the same list', () => {
    expect(recordedMarketRisks(V2)).toEqual(V2.risks);
    for (const risk of recordedMarketRisks(V2)) expect(verdictWatchPoints(V2)).toContain(risk);
  });

  it('prints the recorded market risk under Threats, in the scorer\'s words (60 Lawley Street)', () => {
    const t = threats(swotFor(V2));
    expect(t).toContain('Rapid recent price growth may indicate market cooling ahead.');
    expect(t).not.toMatch(/None identified/);
    expect(t).toMatch(/It describes the market, not this dwelling, and it is not a forecast/);
  });

  it('PRESERVATION — a V1 record\'s risks are statements about a purchase and never reach the SWOT', () => {
    const v1 = { ...V2, v2: undefined, risks: ['Significant negative cash flow requiring ongoing funding'] };
    expect(recordedMarketRisks(v1)).toEqual([]);
    expect(threats(swotFor(v1))).toMatch(/None identified/);
  });

  it('PRESERVATION — a record with no risks draws the Threats it always drew', () => {
    expect(threats(swotFor({ ...V2, risks: [] }))).toMatch(/None identified/);
  });
});

/**
 * The market figures a report may state.
 *
 * ## What the document did
 *
 * `MarketEvidence` reached `investment-scoring-service` and nothing else. The
 * generator built `marketPoints`, posted it, took the grade back — and no
 * prompt was ever handed a median. So the prose supplied its own. From the
 * Compass for 18 Annabelle Crescent, Kellyville:
 *
 * > Kellyville house medians are consistently **reported** around the
 * > **high-$1.8m to ~$2.0m range**, with annual house price growth **called
 * > in** the **low single digits** …
 * >
 * > Recent data sets **report** **median house prices in the order of
 * > $1.96m**, **unit medians in the high-$700k to low-$800k range**, and
 * > **median weekly house rents around $900** …
 * >
 * > a price guide around **$1.55m** … That guide positions the property
 * > **below the prevailing Kellyville house median**
 *
 * Six figures. `market_fact_snapshot` — the governed ledger the report was
 * built on — holds 27 ABS and RBA facts and **not one market price**: no
 * median, no rent, no growth rate, no sale count. Not `absent` with a ruling;
 * no such fact at all.
 *
 * The grammar is the tell: *is consistently reported*, *data sets report*,
 * *is called*. An agentless passive is what a sentence uses when it has no
 * source to name — and the Executive Verdict's central claim is a comparison
 * between two of these numbers.
 *
 * Exactly the shape of the planning defect (§8): the service answered, the
 * answer was stored, and the section that needed it read none of it.
 */
import { describe, expect, it } from 'vitest';
import {
  buildMarketFacts,
  marketFactRules,
  renderMarketFacts,
} from '../../../../supabase/functions/_shared/reports/market/marketFactBlocks.pure';

const point = (over: Record<string, unknown> = {}) => ({
  value: 1_960_000,
  level: 'suburb',
  areaName: 'Kellyville',
  dwellingType: 'house',
  dwellingTypeMatched: true,
  provider: 'nsw_dcj_rent_sales',
  asOf: 'year to 2026-Q2',
  sampleSize: 62,
  periodsAvailable: 40,
  method: 'published_median',
  licensingStatus: 'open',
  sourceNote: null,
  ...over,
});

/** What an open-data register answers for a NSW suburb. */
const OPEN_DATA = {
  points: {
    medianPrice: point(),
    growth5YearCagr: point({ value: 4.2, asOf: '2021-Q2 to 2026-Q2', sampleSize: null }),
    benchmarkMedianPrice: point({
      value: 1_120_000, level: 'state', areaName: 'Rest of NSW', sampleSize: null,
    }),
  },
  providersConsulted: ['nsw_dcj_rent_sales', 'domain'],
  providersUnavailable: [{ provider: 'domain', reason: 'the key’s project has no API package attached (403)' }],
};

const facts = buildMarketFacts({ marketEvidence: OPEN_DATA });

describe('the evidence reaches the page', () => {
  it('states each figure with its geography, dwelling split, sample and period', () => {
    const drawn = renderMarketFacts(facts);
    expect(drawn).toContain('| Median sale price | $1,960,000 | Kellyville — houses, 62 sales, year to 2026-Q2 | '
      + 'NSW Department of Communities and Justice — Rent and Sales Report |');
  });

  it('names the publisher rather than the enum', () => {
    expect(renderMarketFacts(facts)).not.toMatch(/nsw_dcj_rent_sales|qld_qgso_rlda|abs_res_dwell/);
  });

  it('draws a benchmark apart and says it is a different geography', () => {
    // A state figure printed in the subject's table reads as the suburb's.
    const drawn = renderMarketFacts(facts);
    const subjectTable = drawn.slice(0, drawn.indexOf('The wider market'));
    expect(subjectTable).not.toContain('Rest of NSW');
    expect(drawn).toMatch(/describes a DIFFERENT geography from the rows above/);
    expect(drawn.slice(drawn.indexOf('The wider market'))).toContain('Rest of NSW');
  });

  it('names a provider that was asked and could not answer, WITHOUT its reason', () => {
    /*
     * The reason is a vendor's own refusal string — an engineering diagnostic.
     * Rendered on a client page it read "Domain: Operation not permitted on
     * project — no API package is attached to the Domain project this key
     * belongs to", which tells a reader nothing and discloses the shape of
     * this deployment's credentials. The fact a reader needs is that a source
     * was asked and did not answer; the reason stays on the evidence record.
     */
    const facts = buildMarketFacts({
      marketEvidence: {
        points: { subject: {} },
        providersConsulted: ['domain'],
        providersUnavailable: [{ provider: 'domain', reason: 'Operation not permitted on project' }],
      },
    });
    const block = renderMarketFacts(facts);
    expect(block).toMatch(/\*\*Asked and could not answer\.\*\*/);
    expect(block).toContain('Domain');
    expect(block).not.toContain('Operation not permitted on project');
    expect(block).toContain("recorded on this report's evidence record");
    expect(facts.unavailable[0].reason).toBe('Operation not permitted on project');
  });

  it('lists the measures nothing published, so a short table reads as a short search', () => {
    const drawn = renderMarketFacts(facts);
    expect(drawn).toMatch(/\*\*Not held for this market:\*\*/);
    expect(drawn.toLowerCase()).toContain('median advertised weekly rent');
    expect(drawn.toLowerCase()).toContain('rental vacancy rate');
    // And not the ones it does hold.
    expect(drawn.slice(drawn.indexOf('Not held for this market'))).not.toMatch(/median sale price/i);
  });

  it('says a median is not a valuation', () => {
    expect(renderMarketFacts(facts)).toMatch(/None of them is a valuation of this\s+property/);
  });
});

describe('a licence decides what a client may be shown', () => {
  // CLAUDE.md: Domain's licensing is `unverified` until the rights follow-up
  // is answered — the engine scores on the points and the client-facing
  // statement withholds their provenance. Applied here rather than trusted
  // downstream, because "downstream" is a model.
  const withDomain = buildMarketFacts({ marketEvidence: {
    points: {
      medianPrice: point({ provider: 'domain', licensingStatus: 'unverified' }),
      medianRent: point({ value: 900, provider: 'domain', sampleSize: null }),
    },
    providersConsulted: ['domain'],
    providersUnavailable: [],
  } });

  it('withholds an unverified point and says the figure exists', () => {
    expect(withDomain.rows.map((r) => r.label)).toEqual(['Median advertised weekly rent']);
    expect(withDomain.withheld).toEqual([{
      label: 'Median sale price',
      publisher: 'Domain',
      reason: 'the right to publish this measure in a client document is not confirmed',
    }]);
    expect(renderMarketFacts(withDomain)).toMatch(/Held but not published.*Median sale price was measured by Domain/);
  });

  it('defaults to withholding when the status is absent', () => {
    const noStatus = buildMarketFacts({ marketEvidence: { points: { medianPrice: point({ licensingStatus: undefined }) } } });
    expect(noStatus.rows).toHaveLength(0);
    expect(noStatus.withheld).toHaveLength(1);
  });

  it('keeps a withheld measure out of the "not held" list', () => {
    // Held-but-unpublishable and never-measured are different statements, and
    // printing the first under the second would be false.
    const drawn = renderMarketFacts(withDomain);
    const notHeld = drawn.slice(drawn.indexOf('Not held for this market'));
    expect(notHeld).not.toMatch(/Median sale price/);
  });
});

describe('the rules close what the prose actually did', () => {
  const rules = marketFactRules(facts);

  it('names the closed list of measures that may be stated', () => {
    expect(rules).toMatch(/Exactly these measures are held and may be stated: Median sale price; Price growth, 5 years/);
    expect(rules).toMatch(/do not supply one from a live web search, a listing portal, a news article or your own knowledge/);
  });

  it('refuses the agentless attribution that introduced every figure', () => {
    expect(rules).toMatch(/An agentless attribution is NOT a source/);
    for (const phrase of ['is reported', 'is generally around', 'is called', 'recent data sets report',
      'market commentary suggests', 'multiple sources']) {
      expect(rules, phrase).toContain(phrase);
    }
  });

  it('permits the comparison and refuses the verdict', () => {
    // Corrected: a sourced comparison carrying its median's provenance is
    // legitimate and useful. What the Executive Verdict actually got wrong was
    // comparing two unsourced numbers and calling the result a position.
    expect(rules).toMatch(/You MAY \s*say how the subject\u2019s recorded price sits against a median in this table/);
    expect(rules).toMatch(/publisher, geography, dwelling split and period beside it/);
    expect(rules).toMatch(/turn the gap into a verdict/);
    for (const verdict of ['undervalued', 'a bargain', 'good buying']) {
      expect(rules, verdict).toContain(verdict);
    }
    expect(rules).toMatch(/what a median cannot see/);
  });

  it('makes the benchmark name its own geography, and agrees with its own count', () => {
    expect(rules).toMatch(/describes a DIFFERENT geography and is a benchmark/);
    expect(rules).toMatch(/never present it as this suburb’s figure/);
  });
});

describe('with nothing retrieved', () => {
  const none = buildMarketFacts({});
  const rules = marketFactRules(none);

  it('forbids every market figure rather than inviting a plausible one', () => {
    expect(none.evidenceMissing).toBe(true);
    expect(rules).toMatch(/Do NOT state a median sale price, a median rent, a price growth rate/);
    expect(rules).toMatch(/not from a live web search, a listing portal, a news article or your own knowledge/);
  });

  it('gives the permitted form rather than only a prohibition', () => {
    // The lesson the Compass document contract records: a prohibition with no
    // demonstration of what IS allowed is one a model routes around — which is
    // how six unsourced figures got written in the first place.
    expect(rules).toMatch(/write it qualitatively — position, dwelling mix, demand drivers/);
  });

  it('refuses a comparison against a median that does not exist', () => {
    expect(rules).toMatch(/Do NOT compare the asking price or price guide against a median/);
  });

  it('refuses a rating drawn from the absence', () => {
    expect(rules).toMatch(/not evidence that\s+the market is strong, weak, fair value or anything else/);
  });

  it('says on the page that the run retrieved none, not that the market has none', () => {
    expect(renderMarketFacts(none)).toMatch(/a statement about this run rather\s+than about the market/);
  });
});

describe('an empty points object is not a missing one', () => {
  it('distinguishes "asked and nothing answered" from "never assembled"', () => {
    const empty = buildMarketFacts({
      marketEvidence: { points: {}, providersConsulted: ['domain'], providersUnavailable: [] },
    });
    expect(empty.evidenceMissing).toBe(false);
    expect(empty.anyStated).toBe(false);
    // Still forbids every figure — the rules branch on `anyStated`, not on
    // which of the two absences it is.
    expect(marketFactRules(empty)).toMatch(/Do NOT state a median sale price/);
  });
});

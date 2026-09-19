/**
 * The audit's case is the first test: a 13 Silky Oak Court URL answered with
 * 10 Railway Avenue.
 */
import { describe, expect, it } from 'vitest';

import {
  contradictionMessage,
  corroborateAddress,
  distinctiveHintTokens,
} from '../../../supabase/functions/scrape-property-listing/addressCorroboration.pure';

describe('distinctiveHintTokens', () => {
  it('keeps the street name and number and drops the site furniture', () => {
    expect(distinctiveHintTokens('13 Silky Oak Court Kirwan Qld 4817').sort())
      .toEqual(['13', '4817', 'kirwan', 'oak', 'silky']);
  });

  it('drops a listing id, which is not a street number', () => {
    expect(distinctiveHintTokens('Property House Nsw Bowral 152220352'))
      .toEqual(['bowral']);
  });

  it('finds nothing distinctive in a slug that is all furniture', () => {
    expect(distinctiveHintTokens('property for sale nsw')).toEqual([]);
    expect(distinctiveHintTokens('')).toEqual([]);
    expect(distinctiveHintTokens(null)).toEqual([]);
  });
});

describe('corroborateAddress', () => {
  const silkyOak = '13 Silky Oak Court Kirwan Qld 4817';

  it('contradicts an answer about a different property', () => {
    const result = corroborateAddress({
      addressHint: silkyOak,
      scrapedFromPage: false,
      extractedParts: ['10 Railway Avenue', 'Cardiff', '10 Railway Avenue, Cardiff NSW 2285'],
    });
    expect(result.verdict).toBe('contradicted');
    expect(result.matched).toEqual([]);
  });

  it('corroborates the same property written differently', () => {
    const result = corroborateAddress({
      addressHint: silkyOak,
      scrapedFromPage: false,
      extractedParts: ['13 Silky Oak Ct', 'Kirwan', null],
    });
    expect(result.verdict).toBe('corroborated');
    expect(result.matched).toContain('silky');
  });

  it('never judges a scrape that read the page', () => {
    // The page is the authority there; a URL slug could only make a right
    // answer look wrong.
    expect(corroborateAddress({
      addressHint: silkyOak,
      scrapedFromPage: true,
      extractedParts: ['10 Railway Avenue', 'Cardiff'],
    }).verdict).toBe('no_signal');
  });

  it('never judges a URL that names nothing', () => {
    // Most listing URLs are an id and the site's own words. That is by far the
    // commonest case and it must not refuse anything.
    expect(corroborateAddress({
      addressHint: 'property for sale 152220352',
      scrapedFromPage: false,
      extractedParts: ['10 Railway Avenue', 'Cardiff'],
    }).verdict).toBe('no_signal');
  });

  it('will not contradict on a single unmatched token', () => {
    // The asymmetry is the whole safety margin: a false contradiction refuses
    // a scrape that worked.
    const result = corroborateAddress({
      addressHint: 'bowral',
      scrapedFromPage: false,
      extractedParts: ['6 Acer Court', 'Mittagong'],
    });
    expect(result.hintTokens).toEqual(['bowral']);
    expect(result.verdict).toBe('no_signal');
  });

  it('never judges an extraction that said nothing', () => {
    expect(corroborateAddress({
      addressHint: silkyOak,
      scrapedFromPage: false,
      extractedParts: [null, undefined, '   '],
    }).verdict).toBe('no_signal');
  });

  it('matches on a postcode alone', () => {
    expect(corroborateAddress({
      addressHint: silkyOak,
      scrapedFromPage: false,
      extractedParts: ['Somewhere', 'QLD 4817'],
    }).verdict).toBe('corroborated');
  });
});

describe('contradictionMessage', () => {
  it('names both addresses, because a refusal has to be checkable', () => {
    const message = contradictionMessage('13 Silky Oak Court Kirwan', '10 Railway Avenue, Cardiff');
    expect(message).toContain('13 Silky Oak Court Kirwan');
    expect(message).toContain('10 Railway Avenue, Cardiff');
  });

  it('names the remedy rather than only the refusal', () => {
    expect(contradictionMessage('a', 'b')).toMatch(/Firecrawl API key|by hand/i);
  });

  it('says nothing was filled in', () => {
    // The defect was a form quietly carrying another property's figures.
    expect(contradictionMessage('a', 'b')).toMatch(/Nothing has been filled in/i);
  });
});

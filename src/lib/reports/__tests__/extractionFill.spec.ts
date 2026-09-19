import { describe, expect, it } from 'vitest';

import { isAnswered, planExtractionFill } from '../extractionFill.pure';

const KEYS = ['price', 'beds', 'baths', 'landSize'] as const;
type Key = (typeof KEYS)[number];

describe('isAnswered', () => {
  it('treats zero and false as answers', () => {
    // The `if (extracted.x)` shape this replaces dropped both.
    expect(isAnswered(0)).toBe(true);
    expect(isAnswered(false)).toBe(true);
  });

  it('treats nothing-at-all as an absence', () => {
    expect(isAnswered(undefined)).toBe(false);
    expect(isAnswered(null)).toBe(false);
    expect(isAnswered('')).toBe(false);
    expect(isAnswered('   ')).toBe(false);
    expect(isAnswered([])).toBe(false);
    expect(isAnswered(Number.NaN)).toBe(false);
  });
});

describe('planExtractionFill', () => {
  it('writes what the extraction answered', () => {
    const plan = planExtractionFill<Key>({ price: 725000, beds: 4 }, KEYS);
    expect(plan.set).toEqual([
      { key: 'price', value: 725000 },
      { key: 'beds', value: 4 },
    ]);
    expect(plan.clear).toEqual([]);
    expect([...plan.owned].sort()).toEqual(['beds', 'price']);
  });

  it('clears a field the PREVIOUS extraction filled and this one did not answer', () => {
    // The audit's defect exactly: scrape A gives a price, scrape B does not,
    // and the form showed A's price beside B's address.
    const first = planExtractionFill<Key>({ price: 725000, beds: 4 }, KEYS);
    const second = planExtractionFill<Key>({ beds: 3 }, KEYS, first.owned);

    expect(second.set).toEqual([{ key: 'beds', value: 3 }]);
    expect(second.clear).toEqual(['price']);
    expect([...second.owned]).toEqual(['beds']);
  });

  it('never touches a field the operator typed themselves', () => {
    // `landSize` was never extraction-filled, so an extraction that says
    // nothing about it says nothing about it.
    const first = planExtractionFill<Key>({ price: 725000 }, KEYS);
    const second = planExtractionFill<Key>({ price: 640000 }, KEYS, first.owned);
    expect(second.clear).toEqual([]);
    expect(second.set).toEqual([{ key: 'price', value: 640000 }]);
  });

  it('gives a field back to the operator once it stops being extraction-filled', () => {
    const first = planExtractionFill<Key>({ price: 1 }, KEYS);
    const second = planExtractionFill<Key>({}, KEYS, first.owned);
    expect(second.clear).toEqual(['price']);
    // Cleared, and no longer owned — so a third extraction that is also silent
    // about it does not clear a value typed in between.
    const third = planExtractionFill<Key>({}, KEYS, second.owned);
    expect(third.clear).toEqual([]);
  });

  it('governs only the keys it was given', () => {
    const plan = planExtractionFill<Key>(
      { price: 5, somethingElse: 9 } as Record<string, unknown>,
      KEYS,
    );
    expect(plan.set).toEqual([{ key: 'price', value: 5 }]);
  });

  it('carries a zero through rather than clearing', () => {
    const first = planExtractionFill<Key>({ price: 400000 }, KEYS);
    const second = planExtractionFill<Key>({ price: 0 }, KEYS, first.owned);
    expect(second.set).toEqual([{ key: 'price', value: 0 }]);
    expect(second.clear).toEqual([]);
  });
});

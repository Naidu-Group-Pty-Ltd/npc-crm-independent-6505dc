import { describe, expect, it } from 'vitest';

import {
  UNFINISHED_REPORT_IS_FREE, describeTokenHold, describeTokenRelease,
} from '../tokenHold.pure';

describe('describeTokenRelease', () => {
  it('says the run was not charged, and how much came back', () => {
    expect(describeTokenRelease({ jobsReleased: 1, tokensReleased: 20, failures: 0 }))
      .toBe('You were not charged for this run — 20 tokens held for it have been released.');
  });

  it('never calls it a refund', () => {
    // These tokens were never spent. "Refund" says money moved twice, which is
    // the misreading the whole module exists to correct.
    const sentence = describeTokenRelease({ jobsReleased: 1, tokensReleased: 20 });
    expect(sentence).not.toMatch(/refund/i);
  });

  it('agrees with the singular', () => {
    expect(describeTokenRelease({ jobsReleased: 1, tokensReleased: 1 })).toMatch(/1 token held/);
  });

  it('still says it was free when the job carried no figure', () => {
    expect(describeTokenRelease({ jobsReleased: 2, tokensReleased: 0 }))
      .toBe('You were not charged for this run.');
  });

  it('never promises what could not be confirmed', () => {
    const sentence = describeTokenRelease({ jobsReleased: 1, tokensReleased: 20, failures: 1 });
    expect(sentence).toMatch(/could not be released/i);
    expect(sentence).not.toMatch(/were not charged/i);
  });

  it('says nothing where nothing was held', () => {
    expect(describeTokenRelease({ jobsReleased: 0, tokensReleased: 0, failures: 0 })).toBeNull();
    expect(describeTokenRelease(undefined)).toBeNull();
    expect(describeTokenRelease(null)).toBeNull();
    expect(describeTokenRelease('nope')).toBeNull();
  });
});

describe('describeTokenHold', () => {
  it('explains a balance that has dropped without anything being spent', () => {
    const sentence = describeTokenHold(20);
    expect(sentence).toMatch(/20 held/);
    expect(sentence).toMatch(/not a charge/i);
  });

  it('says nothing where there is no hold', () => {
    expect(describeTokenHold(0)).toBeNull();
    expect(describeTokenHold(undefined)).toBeNull();
    expect(describeTokenHold(-5)).toBeNull();
    expect(describeTokenHold(Number.NaN)).toBeNull();
  });

  it('groups a large hold the way a balance is read', () => {
    expect(describeTokenHold(12500)).toMatch(/12,500 held/);
  });
});

describe('UNFINISHED_REPORT_IS_FREE', () => {
  it('states the rule without naming a figure it cannot confirm', () => {
    expect(UNFINISHED_REPORT_IS_FREE).toMatch(/not charged/i);
    expect(UNFINISHED_REPORT_IS_FREE).not.toMatch(/\d/);
  });
});

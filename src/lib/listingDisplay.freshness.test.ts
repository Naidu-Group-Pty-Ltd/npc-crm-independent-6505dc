import { describe, expect, it } from 'vitest';
import { listingFreshness, photoFreshness } from './listingDisplay';

const NOW = Date.parse('2026-08-04T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

const listing = (over: Record<string, unknown>) => ({ ...over }) as never;

describe('listingFreshness', () => {
  it.each([
    [0, 'Added today'],
    [1, 'Added yesterday'],
    [4, 'Added 4 days ago'],
    [6, 'Added 6 days ago'],
    [8, 'Added last week'],
    [20, 'Added 2 weeks ago'],
    [45, 'Added over a month ago'],
  ])('reads %s days as "%s"', (days, expected) => {
    expect(listingFreshness(listing({ receivedAt: daysAgo(days) }), NOW)?.label).toBe(expected);
  });

  it('flags only the first few days as new', () => {
    // Airtable prunes at 30 days, so "new" has to mean days, not weeks.
    expect(listingFreshness(listing({ receivedAt: daysAgo(3) }), NOW)?.isNew).toBe(true);
    expect(listingFreshness(listing({ receivedAt: daysAgo(4) }), NOW)?.isNew).toBe(false);
  });

  it('says nothing when the date was invented rather than read', () => {
    // `listedAtKnown: false` marks exactly that. "Added today" on a month-old
    // listing is worse than no phrase at all.
    expect(listingFreshness(listing({ receivedAt: daysAgo(0), listedAtKnown: false }), NOW)).toBeNull();
  });

  it.each([
    ['no date at all', {}],
    ['an unparseable date', { receivedAt: 'not a date' }],
    ['a null date', { receivedAt: null }],
  ])('says nothing given %s', (_label, over) => {
    expect(listingFreshness(listing(over), NOW)).toBeNull();
  });

  it('says nothing for a future timestamp rather than counting down to it', () => {
    // A clock or parse problem, not a listing that has not happened yet.
    expect(listingFreshness(listing({ receivedAt: daysAgo(-3) }), NOW)).toBeNull();
  });

  it('falls back through the date fields in order of trustworthiness', () => {
    expect(
      listingFreshness(listing({ createdTime: daysAgo(1), listingDate: daysAgo(30) }), NOW)?.label,
    ).toBe('Added yesterday');
    expect(listingFreshness(listing({ listingDate: daysAgo(1) }), NOW)?.label).toBe('Added yesterday');
  });

  it('accepts a Date as readily as a string', () => {
    expect(listingFreshness(listing({ receivedAt: new Date(NOW - 86_400_000) }), NOW)?.label)
      .toBe('Added yesterday');
  });
});

describe('photoFreshness', () => {
  it.each([
    [0, 'Photos updated today'],
    [1, 'Photos updated yesterday'],
    [4, 'Photos updated 4 days ago'],
    [9, 'Photos updated last week'],
    [21, 'Photos updated 3 weeks ago'],
    [60, 'Photos updated 2 months ago'],
    [400, 'Photos over a year old'],
  ])('reads %s days as "%s"', (days, expected) => {
    expect(photoFreshness(listing({ imagesCapturedAt: daysAgo(days) }), NOW)?.label).toBe(expected);
  });

  it('answers about the photographs, not about the record', () => {
    // The case this exists for: a record that arrived months ago whose gallery
    // was re-scraped yesterday. Reading the record's own date would call those
    // photographs months old.
    const l = listing({ receivedAt: daysAgo(120), imagesCapturedAt: daysAgo(1) });
    expect(photoFreshness(l, NOW)?.label).toBe('Photos updated yesterday');
    expect(listingFreshness(l, NOW)?.label).toBe('Added over a month ago');
  });

  it('is silent when no capture was ever recorded', () => {
    // Absent means "we do not know". Falling back to the record's timestamp
    // would claim the photos are as recent as the record.
    expect(photoFreshness(listing({ receivedAt: daysAgo(1) }), NOW)).toBeNull();
    expect(photoFreshness(listing({ imagesCapturedAt: 'not a date' }), NOW)).toBeNull();
  });

  it('treats a future stamp as a clock problem, not a prediction', () => {
    expect(photoFreshness(listing({ imagesCapturedAt: daysAgo(-3) }), NOW)).toBeNull();
  });

  it('flags the first week as recent and carries the source through', () => {
    const l = listing({ imagesCapturedAt: daysAgo(5), imageSource: 'Web Scrape' });
    expect(photoFreshness(l, NOW)).toMatchObject({ isRecent: true, source: 'Web Scrape' });
    expect(photoFreshness(listing({ imagesCapturedAt: daysAgo(8) }), NOW)?.isRecent).toBe(false);
  });
});

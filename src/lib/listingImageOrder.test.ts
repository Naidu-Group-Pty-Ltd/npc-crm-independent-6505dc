import { describe, expect, it } from 'vitest';
import {
  looksLikeFloorplanUrl,
  orderImagesPhotosFirst,
} from '../../supabase/functions/_shared/listingImageOrder.pure';

describe('looksLikeFloorplanUrl', () => {
  it.each([
    'https://cdn.agency.com/media/floorplan-1.jpg',
    'https://cdn.agency.com/media/floor-plan.png',
    'https://cdn.agency.com/media/Floor_Plan_2.webp',
    'https://cdn.agency.com/listing/floorplans/main.jpg',
    'https://cdn.agency.com/media/siteplan.jpg',
    'https://cdn.agency.com/media/title-plan.png',
    'https://cdn.agency.com/media/lot_plan.jpg',
    'https://assets.example.com/plans/L2.png',
    'https://assets.example.com/plan/upper.jpg',
    'https://assets.agentbox.com.au/x/fp1.jpg',
  ])('flags %s', (url) => {
    expect(looksLikeFloorplanUrl(url)).toBe(true);
  });

  it.each([
    // Deliberately conservative: demoting a photograph is the worse error.
    'https://phimg.reapit.website/1a2b3c4d5e6f7a8b9c0d',
    'https://cdn.agency.com/media/backyard-planting.jpg',
    'https://cdn.agency.com/media/openplan-living.jpg',
    'https://cdn.agency.com/media/hero.jpg',
    'https://cdn.agency.com/planning-approved/exterior.jpg',
  ])('leaves %s alone', (url) => {
    expect(looksLikeFloorplanUrl(url)).toBe(false);
  });
});

describe('orderImagesPhotosFirst', () => {
  it('moves plans to the back without disturbing relative order', () => {
    const ordered = orderImagesPhotosFirst(
      ['floorplan-a.jpg', 'photo-1.jpg', 'siteplan.png', 'photo-2.jpg'],
      (u) => `https://x.com/${u}`,
    );
    expect(ordered).toEqual(['photo-1.jpg', 'photo-2.jpg', 'floorplan-a.jpg', 'siteplan.png']);
  });

  it('is a no-op when nothing looks like a plan', () => {
    const input = ['a.jpg', 'b.jpg'];
    expect(orderImagesPhotosFirst(input, (u) => u)).toEqual(input);
  });

  it('keeps an all-plans set intact rather than hiding it', () => {
    const input = ['floorplan1.jpg', 'floorplan2.jpg'];
    expect(orderImagesPhotosFirst(input, (u) => u)).toEqual(input);
  });
});

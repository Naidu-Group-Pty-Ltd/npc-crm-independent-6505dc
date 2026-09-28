/**
 * What "New assessment" creates.
 *
 * It creates the draft on the click and opens it on its Type step, which asks
 * the name and the transaction type first (`newAssessment.ts` records why that
 * is right now, where it once was not). These pin the draft itself: filed
 * under the right segment, typed by the building it concerns, filled from that
 * building, and called something that is not mistaken for a name.
 */

import { describe, expect, it } from 'vitest';
import {
  defaultTitle, isUntitled, planNewAssessment, segmentFor, startingType, UNTITLED_ASSESSMENT,
} from '../newAssessment';
import { buildCommercialPrefill, commercialOption, linkFor, registerLinkOf } from '../registerProperty';
import type { CommercialProperty } from '@/hooks/useCommercialProperties';

const PROPERTY = {
  id: '6b0f4c1e-9a55-4e3c-9c1b-2f6f1d2b7a10', user_id: 'u1', address: '45 Industrial Drive', suburb: 'Wetherill Park',
  state: 'NSW', postcode: '2164', asset_class: 'industrial', tenure: 'freehold', gst_treatment: 'going_concern',
  purchase_price: 6_100_000, nla_sqm: 4_200, site_area_sqm: 8_000, outgoings_recoverable: {}, industrial_specs: {},
  created_at: '', updated_at: '',
} as unknown as CommercialProperty;

describe('the segment an assessment is filed under', () => {
  it('follows a type that names one', () => {
    expect(segmentFor('industrial_investment', 'commercial', false)).toBe('industrial');
    expect(segmentFor('owner_occupied_commercial', 'industrial', true)).toBe('commercial');
  });

  it('takes the choice, then the building, for a type that fits either', () => {
    expect(segmentFor('refinance', 'industrial', false)).toBe('industrial');
    expect(segmentFor('refinance', null, true)).toBe('industrial');
    expect(segmentFor('refinance', null, null)).toBe('commercial');
  });
});

describe('the record it creates', () => {
  it('keeps the name the operator typed', () => {
    const plan = planNewAssessment({ title: '  45 Industrial Drive — acquisition ', assessmentType: 'industrial_investment', segmentChoice: null });
    expect(plan.title).toBe('45 Industrial Drive — acquisition');
    expect(plan.segment).toBe('industrial');
    expect(plan.payload.property.classification).toBe('industrial');
  });

  it('names itself after the building when nobody names it', () => {
    expect(defaultTitle('refinance', '45 Industrial Drive')).toBe('45 Industrial Drive — refinance');
    expect(defaultTitle('commercial_investment', null)).toBe('Untitled assessment');
    expect(defaultTitle('commercial_investment', '   ')).toBe(UNTITLED_ASSESSMENT);
  });

  it('knows the placeholder name from one somebody chose', () => {
    // The Type step shows the placeholder as an empty field, so this must
    // never mistake a real name for it, nor it for a real name.
    expect(isUntitled(UNTITLED_ASSESSMENT)).toBe(true);
    expect(isUntitled('  Untitled assessment ')).toBe(true);
    expect(isUntitled('Untitled assessment 2')).toBe(false);
    expect(isUntitled('45 Industrial Drive — industrial investment')).toBe(false);
    expect(isUntitled('')).toBe(false);
    expect(isUntitled(null)).toBe(false);
  });

  it('starts as the type the building implies, before the Type step is answered', () => {
    expect(startingType(true)).toBe('industrial_investment');
    expect(startingType(false)).toBe('commercial_investment');
  });

  it('starts an assessment with no building as an untitled commercial investment', () => {
    const plan = planNewAssessment({ title: '', assessmentType: startingType(false), segmentChoice: null });
    expect(plan.title).toBe(UNTITLED_ASSESSMENT);
    expect(plan.assessmentType).toBe('commercial_investment');
    expect(plan.segment).toBe('commercial');
    expect(plan.payload.assessmentType).toBe('commercial_investment');
    expect(plan.applied).toEqual([]);
  });

  it('files a refinance of an industrial building as industrial, down to its classification', () => {
    const option = commercialOption(PROPERTY);
    const plan = planNewAssessment({
      title: '',
      assessmentType: 'refinance',
      segmentChoice: null,
      property: { prefill: buildCommercialPrefill(PROPERTY), link: linkFor(option), industrial: option.industrial },
    });
    expect(plan.segment).toBe('industrial');
    expect(plan.payload.property.classification).toBe('industrial');
    expect(plan.payload.property.address).toBe('45 Industrial Drive');
    expect(plan.payload.property.purchasePrice).toBe(6_100_000);
    expect(registerLinkOf(plan.payload)?.propertyId).toBe(PROPERTY.id);
    expect(plan.applied.length).toBeGreaterThan(0);
    expect(plan.title).toBe('45 Industrial Drive — refinance');
  });
});

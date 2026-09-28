/**
 * An assessment's link to the property-register entry it concerns.
 *
 * The property register and the assessments had no connection: an assessment
 * copied a building in by hand and the register never learned it had been
 * assessed. The link is what joins them, and the property it most needs is to
 * SURVIVE — `hydrateAssessmentPayload` rebuilds a payload from a fixed list of
 * sections and drops any top-level key it does not know, so a link stored
 * there would vanish on the next load and be erased by the autosave after it.
 */

import { describe, expect, it } from 'vitest';
import {
  applyRegisterProperty, buildCommercialPrefill, buildIndustrialPrefill, commercialOption,
  industrialOption, linkFor, registerLinkOf, registerPropertyPath, withRegisterLink,
} from '../registerProperty';
import {
  REGISTER_PROPERTY_ID_PATH, readRegisterLink,
} from '../../../../supabase/functions/_shared/ciAssessments/registerLink.pure';
import { emptyAssessmentPayload, hydrateAssessmentPayload } from '../types';
import type { CommercialProperty } from '@/hooks/useCommercialProperties';
import type { IndustrialProperty } from '@/hooks/useIndustrialProperties';

const PROPERTY_ID = '6b0f4c1e-9a55-4e3c-9c1b-2f6f1d2b7a10';

function commercialRow(overrides: Partial<CommercialProperty> = {}): CommercialProperty {
  return {
    id: PROPERTY_ID, user_id: 'u1', address: 'G12/25 Solent Circuit', suburb: 'Norwest', state: 'NSW',
    postcode: '2153', asset_class: 'office', tenure: 'freehold', gst_treatment: 'going_concern',
    purchase_price: 2_400_000, valuation: null, nla_sqm: 310, site_area_sqm: null,
    outgoings_recoverable: { rates: 12_000, insurance: 4_000 }, industrial_specs: {},
    created_at: '', updated_at: '', ...overrides,
  } as CommercialProperty;
}

describe('the link survives the round trip every assessment makes', () => {
  it('is kept by hydrateAssessmentPayload, and therefore by every load and autosave', () => {
    const link = linkFor({ domain: 'commercial', propertyId: PROPERTY_ID, label: 'G12/25 Solent Circuit' }, new Date('2026-09-23T00:00:00Z'));
    const linked = withRegisterLink(emptyAssessmentPayload('commercial_investment'), link);
    const reloaded = hydrateAssessmentPayload(JSON.parse(JSON.stringify(linked)));
    expect(registerLinkOf(reloaded)).toEqual(link);
  });

  it('is filtered on by the path the server uses', () => {
    const linked = withRegisterLink(
      emptyAssessmentPayload('commercial_investment'),
      linkFor({ domain: 'industrial', propertyId: PROPERTY_ID, label: 'Unit 4' }),
    );
    // payload->property->registerProperty->>propertyId, read the same way here.
    const [, section, key, field] = REGISTER_PROPERTY_ID_PATH.split(/->>?/);
    expect(section).toBe('property');
    const walked = ((linked as unknown as Record<string, Record<string, Record<string, unknown>>>)[section][key])[field];
    expect(walked).toBe(PROPERTY_ID);
  });

  it('clears to the same shape as never having been linked', () => {
    const linked = withRegisterLink(
      emptyAssessmentPayload('commercial_investment'),
      linkFor({ domain: 'commercial', propertyId: PROPERTY_ID, label: 'x' }),
    );
    const cleared = withRegisterLink(linked, null);
    expect(registerLinkOf(cleared)).toBeNull();
    expect(Object.keys(cleared.property)).toEqual(Object.keys(emptyAssessmentPayload('commercial_investment').property));
  });

  it('refuses a malformed link rather than handing the app one to open', () => {
    expect(readRegisterLink({ registerProperty: { domain: 'commercial', propertyId: 'not-a-uuid' } })).toBeNull();
    expect(readRegisterLink({ registerProperty: { domain: 'residential', propertyId: PROPERTY_ID } })).toBeNull();
    expect(readRegisterLink({ registerProperty: 'x' })).toBeNull();
    expect(readRegisterLink(null)).toBeNull();
  });

  it('opens the property on its own page', () => {
    expect(registerPropertyPath({ domain: 'industrial', propertyId: PROPERTY_ID })).toBe(`/industrial/${PROPERTY_ID}`);
  });
});

describe('starting from a register property', () => {
  it('fills blanks, never overwrites, and links either way', () => {
    const payload = emptyAssessmentPayload('commercial_investment');
    payload.property.purchasePrice = 2_350_000; // negotiated — not the register's figure
    const link = linkFor(commercialOption(commercialRow()));
    const outcome = applyRegisterProperty(payload, buildCommercialPrefill(commercialRow()), link);

    expect(outcome.payload.property.address).toBe('G12/25 Solent Circuit');
    expect(outcome.payload.property.lettableAreaSqm).toBe(310);
    expect(outcome.payload.lease.recoverableOutgoings).toBe(16_000);
    expect(outcome.payload.property.purchasePrice).toBe(2_350_000);
    expect(outcome.skipped.map((change) => change.field)).toContain('property.purchasePrice');
    expect(registerLinkOf(outcome.payload)?.propertyId).toBe(PROPERTY_ID);
  });

  it('labels a register row the way the register does', () => {
    expect(commercialOption(commercialRow())).toMatchObject({
      domain: 'commercial', label: 'G12/25 Solent Circuit', industrial: false,
    });
    expect(commercialOption(commercialRow({ asset_class: 'industrial' })).industrial).toBe(true);
    const industrial = {
      id: PROPERTY_ID, user_id: 'u1', property_name: 'Estate A', street: '4 Dock Rd', suburb: 'Yennora',
      state: 'NSW', postcode: '2161', asset_subtype: 'warehouse', status: 'active', created_at: '', updated_at: '',
    } as IndustrialProperty;
    expect(industrialOption(industrial)).toMatchObject({ domain: 'industrial', label: 'Estate A', industrial: true });
    expect(buildIndustrialPrefill(industrial).address).toBe('4 Dock Rd, Yennora, NSW, 2161');
  });
});

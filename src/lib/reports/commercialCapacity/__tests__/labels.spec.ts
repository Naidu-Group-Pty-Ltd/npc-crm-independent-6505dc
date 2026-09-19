/**
 * The label maps are a copy. This is what stops it going stale.
 *
 * `normalise.pure.ts` cannot import `src/lib/ciAssessment/types.ts`: that module
 * resolves through the `@/` alias and an Edge Function resolves relative `.ts`
 * paths and nothing else. So the transaction-type, asset-class and GST labels
 * exist twice.
 *
 * A table of strings written in one file and consumed in another goes stale
 * silently, and the failure mode here is a client's report saying
 * "Purchase plus fitout" where the product everywhere else says "Purchase plus
 * fit-out" — or, once a new asset class ships, "Data centre" turning into
 * "Data_centre". Both directions are asserted: every key the engine has is
 * known here, and every key known here still exists.
 *
 * This is the same guard `borrowingCapacity/__tests__/audit.spec.ts` puts on
 * its polarity table, for the same reason. It found the fifteen that exist.
 */

import { describe, expect, it } from 'vitest';
import {
  ASSESSMENT_TYPE_DEFINITIONS,
  type AssetClass,
  type GstTreatmentKey,
} from '@/lib/ciAssessment/types';
import { OUTCOME_LABELS as ENGINE_OUTCOME_LABELS } from '@/lib/ciAssessment/engine';
import {
  ASSESSMENT_TYPE_LABELS,
  ASSET_CLASS_LABELS,
  GST_TREATMENT_LABELS,
  OUTCOME_LABELS,
} from '../normalise.pure';

describe('transaction types', () => {
  it('knows every type the engine defines, and no others', () => {
    expect(Object.keys(ASSESSMENT_TYPE_LABELS).sort())
      .toEqual(ASSESSMENT_TYPE_DEFINITIONS.map((d) => d.key).sort());
  });

  it('uses the engine\'s own wording for each', () => {
    // Not "close enough". A report and the screen it was generated from
    // describing the same transaction differently is a support question.
    for (const definition of ASSESSMENT_TYPE_DEFINITIONS) {
      expect(ASSESSMENT_TYPE_LABELS[definition.key], definition.key).toBe(definition.label);
    }
  });
});

describe('outcomes', () => {
  it('matches the engine\'s vocabulary exactly', () => {
    // This is the sentence at the top of the first page. The engine's wording
    // is chosen with care — nothing here says "approved" — so it is copied,
    // not paraphrased.
    expect(OUTCOME_LABELS).toEqual(ENGINE_OUTCOME_LABELS);
  });
});

describe('asset classes', () => {
  /**
   * The union's members, listed here because a TypeScript union does not exist
   * at runtime. The test below is what makes the list trustworthy: TypeScript
   * fails the assignment if a member is added to the union and not to this
   * array, so the list cannot fall behind the type.
   */
  const CLASSES: AssetClass[] = [
    'office', 'retail', 'warehouse', 'logistics', 'manufacturing',
    'cold_storage', 'medical', 'childcare', 'hospitality',
    'showroom', 'transport_yard', 'data_centre', 'mixed_use', 'other',
  ];

  it('labels every asset class the payload can hold', () => {
    for (const key of CLASSES) {
      expect(ASSET_CLASS_LABELS[key], key).toBeTruthy();
    }
  });

  it('labels nothing that is not one', () => {
    expect(Object.keys(ASSET_CLASS_LABELS).sort()).toEqual([...CLASSES].sort());
  });
});

describe('GST treatments', () => {
  const TREATMENTS: GstTreatmentKey[] = [
    'going_concern', 'margin_scheme', 'plus_gst', 'gst_inclusive', 'input_taxed', 'unknown',
  ];

  it('labels every treatment, including the one that means "not yet decided"', () => {
    for (const key of TREATMENTS) {
      expect(GST_TREATMENT_LABELS[key], key).toBeTruthy();
    }
    // `unknown` must not read as a missing value: on a commercial contract the
    // GST treatment being undecided is a fact about the deal, not a gap in the
    // form.
    expect(GST_TREATMENT_LABELS.unknown).toBe('Not yet determined');
  });

  it('labels nothing that is not one', () => {
    expect(Object.keys(GST_TREATMENT_LABELS).sort()).toEqual([...TREATMENTS].sort());
  });
});

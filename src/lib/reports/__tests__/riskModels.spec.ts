import { describe, expect, it } from 'vitest';

import {
  ASSET_TYPE_MODAL_SHARE,
  ASSET_TYPES_OFF_SCALE,
  BUYER_SCOPED_INPUTS,
  modelsHoldingPropertyInvariance,
  PROPERTY_SCOPED_INPUTS,
  RISK_MODEL_WEIGHTS,
  scoreRiskModel,
  UNMAPPED_STORED_TYPES,
  type RiskModelId,
} from '@/lib/reports/market/riskModels.pure';
import { RISK_WEIGHTS } from '@/lib/reports/market/riskScoring.pure';

/**
 * ME-5 items 11–13 — the three Risk models, decided by an invariant.
 *
 * The pair below is real: two reports on 1 Boxer Drive, Wyndham Vale, written
 * the same day, at the same $635,000 and the same −$562 weekly net, one at 80%
 * LVR and one at 90%. Three more Truganina addresses carry the identical pair.
 */
const boxerDriveAt80 = { lvr: 80, weeklyCashFlow: -562, propertyType: 'House', growth1Year: 6 };
const boxerDriveAt90 = { lvr: 90, weeklyCashFlow: -562, propertyType: 'House', growth1Year: 6 };

const ALL: RiskModelId[] = ['A_asset_only', 'B_asset_scored_finance_disclosed', 'C_blended'];

describe('risk models', () => {
  describe('the invariant that separates them', () => {
    it('A and B give the same property the same score; C does not', () => {
      expect(modelsHoldingPropertyInvariance(boxerDriveAt80, boxerDriveAt90))
        .toEqual(['A_asset_only', 'B_asset_scored_finance_disclosed']);
    });

    it('measures how much C moves for a typed loan-to-value ratio', () => {
      const at80 = scoreRiskModel('C_blended', boxerDriveAt80).score!;
      const at90 = scoreRiskModel('C_blended', boxerDriveAt90).score!;
      expect(at80).toBeGreaterThan(at90);
      // 62 → 30 on the leverage anchors, at 0.40 of the weight.
      expect(at80 - at90).toBeGreaterThan(10);
    });

    it('holds for every model when nothing about the report differs', () => {
      expect(modelsHoldingPropertyInvariance(boxerDriveAt80, boxerDriveAt80)).toEqual(ALL);
    });
  });

  describe('Model B discards nothing — it relocates it', () => {
    it('reports the buyer’s position separately and keeps it out of the score', () => {
      const at80 = scoreRiskModel('B_asset_scored_finance_disclosed', boxerDriveAt80);
      const at90 = scoreRiskModel('B_asset_scored_finance_disclosed', boxerDriveAt90);

      expect(at80.score).toBe(at90.score);                       // the property is the property
      expect(at80.financeSuitability).not.toBeNull();            // and the financing is still told
      expect(at90.financeSuitability).not.toBeNull();
      expect(at80.financeSuitability!.score)
        .toBeGreaterThan(at90.financeSuitability!.score);         // 80% is a safer position
    });

    it('Model A drops the same information rather than relocating it', () => {
      const a = scoreRiskModel('A_asset_only', boxerDriveAt90);
      expect(a.financeSuitability).toBeNull();
      expect(a.statement).toMatch(/is not scored and is not reported/);
    });

    it('Model C folds it in, and says so', () => {
      expect(scoreRiskModel('C_blended', boxerDriveAt90).statement)
        .toMatch(/different loan-to-value ratios receive different Risk scores/);
    });
  });

  describe('what each model treats as a property fact', () => {
    it('scopes leverage and serviceability to the buyer', () => {
      expect(BUYER_SCOPED_INPUTS).toEqual(['leverage', 'serviceability']);
      expect(PROPERTY_SCOPED_INPUTS).toEqual(['assetType', 'marketOverheating']);
    });

    it('A and B score only property-scoped inputs', () => {
      for (const m of ['A_asset_only', 'B_asset_scored_finance_disclosed'] as RiskModelId[]) {
        expect(Object.keys(RISK_MODEL_WEIGHTS[m]).sort()).toEqual([...PROPERTY_SCOPED_INPUTS].sort());
      }
    });

    it('C is exactly the model in production today', () => {
      expect(RISK_MODEL_WEIGHTS.C_blended).toEqual({ ...RISK_WEIGHTS });
    });

    it('every model’s weights sum to one over what it scores', () => {
      for (const m of ALL) {
        const sum = Object.values(RISK_MODEL_WEIGHTS[m]).reduce((a, b) => a + b, 0);
        expect(sum).toBeCloseTo(1, 2);
      }
    });
  });

  describe('absent is never zero', () => {
    it('returns null rather than a score when nothing scoreable is present', () => {
      for (const m of ALL) {
        const r = scoreRiskModel(m, {});
        expect(r.score).toBeNull();
        expect(r.missing.length).toBeGreaterThan(0);
      }
    });

    it('refuses a placeholder dwelling type rather than treating it as a house', () => {
      const withPlaceholder = scoreRiskModel('A_asset_only', {
        propertyType: 'Residential Property', growth1Year: 6,
      });
      expect(withPlaceholder.missing).toContain('assetType');
      const withReal = scoreRiskModel('A_asset_only', { propertyType: 'House', growth1Year: 6 });
      expect(withReal.missing).not.toContain('assetType');
      expect(withReal.score).not.toBe(withPlaceholder.score);
    });

    it('renormalises over what is present rather than scoring an absence as zero', () => {
      const onlyAsset = scoreRiskModel('A_asset_only', { propertyType: 'House' });
      expect(onlyAsset.score).toBe(82);           // the house reading itself, not 0.67 of it
      expect(onlyAsset.missing).toEqual(['marketOverheating']);
    });
  });

  describe('overheating sensitivity (item 13)', () => {
    it('does not move for ordinary growth, and does move for rapid growth', () => {
      const ordinary = scoreRiskModel('A_asset_only', { propertyType: 'House', growth1Year: 8 });
      const alsoOrdinary = scoreRiskModel('A_asset_only', { propertyType: 'House', growth1Year: 11 });
      const rapid = scoreRiskModel('A_asset_only', { propertyType: 'House', growth1Year: 25 });
      expect(ordinary.score).toBe(alsoOrdinary.score);
      expect(rapid.score!).toBeLessThan(ordinary.score!);
    });

    it('carries a larger share of Risk once leverage leaves — which is the trade-off to weigh', () => {
      expect(RISK_MODEL_WEIGHTS.C_blended.marketOverheating).toBe(0.10);
      expect(RISK_MODEL_WEIGHTS.A_asset_only.marketOverheating).toBeGreaterThan(0.3);
    });
  });

  describe('the asset-type component, challenged (item 12)', () => {
    it('names the real stored types the table does not cover', () => {
      expect(UNMAPPED_STORED_TYPES).toEqual(['house_and_land', 'villa']);
      for (const t of UNMAPPED_STORED_TYPES) {
        // They are genuine values, and they resolve to nothing.
        expect(scoreRiskModel('A_asset_only', { propertyType: t }).missing).toContain('assetType');
      }
    });

    it('records that the component is a near-constant on this corpus', () => {
      // 631 of the 896 reports carrying a real dwelling type are `house`.
      expect(ASSET_TYPE_MODAL_SHARE).toBeGreaterThan(0.7);
    });

    it('marks vacant land as off-scale rather than merely low', () => {
      expect(ASSET_TYPES_OFF_SCALE).toEqual(['land']);
      // It still scores today — this records the objection, it does not act on it.
      expect(scoreRiskModel('A_asset_only', { propertyType: 'land' }).score).toBe(45);
    });

    it('costs Models A and B far more than C when the type is unresolvable', () => {
      const unmapped = { propertyType: 'villa', lvr: 80, weeklyCashFlow: -100, growth1Year: 6 };
      expect(scoreRiskModel('A_asset_only', unmapped).missing).toContain('assetType');
      // C still has leverage and serviceability to fall back on; A and B do not.
      expect(scoreRiskModel('C_blended', unmapped).components.map((c) => c.key).sort())
        .toEqual(['leverage', 'marketOverheating', 'serviceability']);
      expect(scoreRiskModel('A_asset_only', unmapped).components.map((c) => c.key))
        .toEqual(['marketOverheating']);
    });
  });
});

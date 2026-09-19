import { describe, expect, it } from 'vitest';

import {
  FIELD_AUTHORITY,
  resolveAllFacts,
  resolveFact,
  type FactStores,
} from '@/lib/reports/facts/historicalFactAuthority.pure';

/**
 * ME-5 item 4 — the Historical Fact Authority.
 *
 * These pin the two rules the module exists for: precedence is PER FIELD, and a
 * superseded value is kept rather than erased. They also pin the finding that
 * made the precedence what it is — `manual_overrides` is the calculator's INPUT
 * and therefore the observed value, with `financial_calculations` its derivative.
 */
describe('historical fact authority', () => {
  describe('the precedence table itself', () => {
    it('declares every field with at least one candidate and a rationale', () => {
      expect(FIELD_AUTHORITY.length).toBeGreaterThan(0);
      for (const authority of FIELD_AUTHORITY) {
        expect(authority.order.length).toBeGreaterThan(0);
        expect(authority.rationale.trim().length).toBeGreaterThan(20);
        for (const step of authority.order) {
          // A path must name its own store first, so a resolution is auditable.
          expect(step.path.split('.')[0]).toBe(step.source);
        }
      }
    });

    it('names no field twice', () => {
      const names = FIELD_AUTHORITY.map((a) => a.field);
      expect(new Set(names).size).toBe(names.length);
    });

    it('never consults report prose at any precedence', () => {
      const sources = FIELD_AUTHORITY.flatMap((a) => a.order.map((s) => String(s.source)));
      for (const source of sources) {
        expect(source).not.toMatch(/content|narrative|prose|markdown|section/i);
      }
    });
  });

  describe('precedence is per field, never universal', () => {
    it('prefers the operator-stated override for a calculator INPUT', () => {
      const stores: FactStores = {
        manual_overrides: { purchasePrice: 750_000 },
        financial_calculations: { initialCosts: { propertyValue: 750_000 } },
      };
      const fact = resolveFact<number>('purchasePrice', stores);
      expect(fact.value).toBe(750_000);
      expect(fact.source).toBe('manual_overrides');
      expect(fact.kind).toBe('observed');
      expect(fact.sourcePath).toBe('manual_overrides.purchasePrice');
      expect(fact.note).toMatch(/agreed/);
    });

    it('falls through to the derived block when no override was stated', () => {
      const fact = resolveFact<number>('purchasePrice', {
        financial_calculations: { initialCosts: { propertyValue: 612_000 } },
      });
      expect(fact.value).toBe(612_000);
      expect(fact.source).toBe('financial_calculations');
      expect(fact.kind).toBe('derived');
      expect(fact.derivation).toBeTruthy();
    });

    it('gives a calculator OUTPUT no override path at all', () => {
      const authority = FIELD_AUTHORITY.find((a) => a.field === 'weeklyCashFlow');
      expect(authority).toBeDefined();
      expect(authority?.order.map((s) => s.source)).toEqual(['financial_calculations']);

      // An override naming it is not consulted — that is the point of the rule.
      const fact = resolveFact<number>('weeklyCashFlow', {
        manual_overrides: { weeklyNet: 480 },
        financial_calculations: { keyMetrics: { weeklyNet: -120 } },
      });
      expect(fact.value).toBe(-120);
      expect(fact.source).toBe('financial_calculations');
      expect(fact.kind).toBe('derived');
    });
  });

  describe('a superseded value is kept, never erased', () => {
    it('records the disagreeing lower-precedence value and its store', () => {
      const fact = resolveFact<number>('purchasePrice', {
        manual_overrides: { purchasePrice: 810_000 },
        financial_calculations: { initialCosts: { propertyValue: 795_000 } },
      });
      expect(fact.value).toBe(810_000);
      expect(fact.supersededValue).toBe(795_000);
      expect(fact.supersededSource).toBe('financial_calculations');
      expect(fact.note).toMatch(/superseded rather than discarded/);
    });

    it('carries no superseded value where the stores agree', () => {
      const fact = resolveFact<number>('lvr', {
        manual_overrides: { loanToValueRatio: 80 },
        financial_calculations: { keyMetrics: { lvr: 80 } },
      });
      expect(fact.supersededValue).toBeNull();
      expect(fact.supersededSource).toBeNull();
    });
  });

  describe('absent is never zero', () => {
    it('resolves an empty record to unavailable rather than to a default', () => {
      const fact = resolveFact<number>('weeklyRent', {});
      expect(fact.value).toBeNull();
      expect(fact.source).toBe('none');
      expect(fact.kind).toBe('unavailable');
      expect(fact.note).toMatch(/Absent, not zero/);
    });

    it('refuses a field with no declared authority rather than guessing a path', () => {
      const fact = resolveFact('cashOnCashReturn', {
        financial_calculations: { keyMetrics: { cashOnCashReturn: 4.2 } },
      });
      expect(fact.value).toBeNull();
      expect(fact.source).toBe('none');
      expect(fact.note).toMatch(/No authority is declared/);
    });

    it('treats a non-numeric or unparseable figure as absent', () => {
      expect(resolveFact<number>('weeklyRent', {
        manual_overrides: { weeklyRent: 'not a number' },
      }).value).toBeNull();
    });

    it('reads a numeric string, because a stored JSON figure may be one', () => {
      expect(resolveFact<number>('weeklyRent', {
        manual_overrides: { weeklyRent: '640' },
      }).value).toBe(640);
    });
  });

  describe('a placeholder is not a fact', () => {
    it.each([
      'Residential Property',
      'residential property',
      'Other',
      'Unknown',
      'N/A',
      '   ',
    ])('resolves the stored dwelling type %j to unavailable', (stored) => {
      const fact = resolveFact<string>('dwellingType', {
        property_specs: { property_type: stored },
      });
      expect(fact.value).toBeNull();
      expect(fact.kind).toBe('unavailable');
    });

    it('keeps a real dwelling type', () => {
      const fact = resolveFact<string>('dwellingType', {
        property_specs: { property_type: 'Townhouse' },
      });
      expect(fact.value).toBe('Townhouse');
      expect(fact.source).toBe('property_specs');
      expect(fact.kind).toBe('observed');
    });
  });

  describe('geography', () => {
    it('reads the suburb from the resolved geography record and nowhere else', () => {
      const authority = FIELD_AUTHORITY.find((a) => a.field === 'suburb');
      expect(authority?.order.map((s) => s.source)).toEqual(['report_geography']);

      const fact = resolveFact<string>('suburb', {
        report_geography: { suburb: 'Traralgon' },
        // A free-text address is never a source — it is not even a candidate.
        property_specs: { property_address: 'somewhere else entirely' },
      });
      expect(fact.value).toBe('Traralgon');
      expect(fact.sourcePath).toBe('report_geography.suburb');
    });
  });

  describe('resolveAllFacts', () => {
    it('answers for every declared field, present or not', () => {
      const all = resolveAllFacts({
        manual_overrides: { purchasePrice: 500_000 },
      });
      expect(Object.keys(all).sort()).toEqual(FIELD_AUTHORITY.map((a) => a.field).sort());
      expect(all.purchasePrice.value).toBe(500_000);
      expect(all.weeklyCashFlow.value).toBeNull();
      expect(all.weeklyCashFlow.kind).toBe('unavailable');
    });
  });
});

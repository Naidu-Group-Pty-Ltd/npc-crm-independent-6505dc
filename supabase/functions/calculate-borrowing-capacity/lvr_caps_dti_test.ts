/**
 * Phase I7/I8 Parity Tests — Per-Security LVR Caps + DTI Denominator
 *
 * I7: equity-release / pool-release respect lender × intent × kind caps.
 * I8: DTI denominator surfaces an APS 220-aligned adjusted income note when
 *     typed components show heavy rental / non-PAYG mix.
 */

import { assert, assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import {
  resolveLvrCap,
  inferPropertyKind,
  inferPropertyIntent,
} from '../_shared/lenderLvrCaps.ts';
import { computeDtiDenominator } from '../_shared/dtiDenominator.ts';

Deno.test('I7: bank_standard INV established cap = 90%', () => {
  const r = resolveLvrCap({ lenderId: 'bank_standard', intent: 'investment', kind: 'established' });
  assertEquals(r.cap, 0.90);
});

Deno.test('I7: bank_standard OO established + FHB = 97%', () => {
  const r = resolveLvrCap({ lenderId: 'bank_standard', intent: 'owner_occupier', kind: 'established', isFirstHomeBuyer: true });
  assertEquals(Math.round(r.cap * 100) / 100, 0.97);
});

Deno.test('I7: foreign-buyer haircut on Macquarie INV', () => {
  const r = resolveLvrCap({ lenderId: 'macquarie', intent: 'investment', kind: 'established', isForeignBuyer: true });
  // 0.90 - 0.20 = 0.70
  assertEquals(Math.round(r.cap * 100) / 100, 0.70);
});

Deno.test('I7: vacant land INV is much tighter than established', () => {
  const r = resolveLvrCap({ lenderId: 'bank_standard', intent: 'investment', kind: 'vacant_land' });
  assertEquals(r.cap, 0.75);
});

Deno.test('I7: explicit override only TIGHTENS — cannot exceed policy', () => {
  // Try to push 95% INV — policy is 90%, request denied
  const r1 = resolveLvrCap({ lenderId: 'bank_standard', intent: 'investment', kind: 'established', explicitCap: 0.95 });
  assertEquals(r1.cap, 0.90);
  assert(r1.reason.includes('denied'));
  // Tighten to 80% — accepted
  const r2 = resolveLvrCap({ lenderId: 'bank_standard', intent: 'investment', kind: 'established', explicitCap: 0.80 });
  assertEquals(r2.cap, 0.80);
});

Deno.test('I7: kind inference handles AU vernacular', () => {
  assertEquals(inferPropertyKind('Investment Property — vacant land'), 'vacant_land');
  assertEquals(inferPropertyKind('Off-the-plan apartment'), 'off_the_plan');
  assertEquals(inferPropertyKind('Owner-occupier home'), 'established');
  assertEquals(inferPropertyIntent('Investment Property'), 'investment');
  assertEquals(inferPropertyIntent('Owner-occupier home'), 'owner_occupier');
});

Deno.test('I8: DTI denominator caps rental at 75%', () => {
  const r = computeDtiDenominator({
    fallbackGrossAnnual: 200000,
    incomeComponents: [
      { id: '1', label: 'Salary', type: 'base_salary', grossAnnual: 140000, currentShadingRate: 1.0 },
      { id: '2', label: 'Rental', type: 'rental_residential', grossAnnual: 60000, currentShadingRate: 0.8 },
    ],
  });
  // 140k*1.0 + 60k*0.75 = 185k
  assertEquals(r.dtiAdjustedAnnualIncome, 185000);
});

Deno.test('I8: DTI denominator falls back to gross when no components', () => {
  const r = computeDtiDenominator({ fallbackGrossAnnual: 180000 });
  assertEquals(r.dtiAdjustedAnnualIncome, 180000);
  assert(r.notes[0].includes('fallback'));
});

Deno.test('I8: rental-heavy mix surfaces a warning note', () => {
  const r = computeDtiDenominator({
    fallbackGrossAnnual: 100000,
    incomeComponents: [
      { id: '1', label: 'Rental A', type: 'rental_residential', grossAnnual: 50000, currentShadingRate: 0.8 },
      { id: '2', label: 'Rental B', type: 'rental_commercial', grossAnnual: 50000, currentShadingRate: 0.75 },
    ],
  });
  // 50k*0.75 + 50k*0.70 = 72.5k → ratio 72.5%
  assertEquals(r.dtiAdjustedAnnualIncome, 72500);
  assert(r.notes.some(n => /capped/i.test(n)));
});

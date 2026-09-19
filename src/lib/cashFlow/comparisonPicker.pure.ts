/**
 * Choosing which already-generated properties a cash-flow analysis is compared
 * against.
 *
 * The picker was a 380px popover holding a flat list of addresses: no figures,
 * no ordering a person could choose, and one line of text per property. It is
 * the moment an adviser decides which four properties a client's decision will
 * be argued from, so it needs to show what is being chosen — the price, the
 * rent and the yield the comparison will actually draw — and let the list be
 * put in the order the question is being asked in.
 *
 * Everything here is derived from figures the candidate row already carries.
 * Nothing in this module reads a new field, calls anything, or decides what is
 * comparable: `comparisonCandidates.pure.ts` owns that.
 */
import { resolveCashFlowFinancialSummary } from '@/components/cash-flow/financialSummary';

import type { ComparisonCandidate } from './comparisonCandidates.pure';

/** A candidate with its two headline figures and the yield they imply. */
export interface PickerRow {
  id: string;
  address: string;
  purchasePrice: number | null;
  weeklyRent: number | null;
  /** Gross yield as a percentage, or null when either figure is missing. */
  grossYield: number | null;
  createdAt: string | null;
}

export type PickerSort = 'recent' | 'price_desc' | 'yield_desc' | 'address';

/**
 * Gross yield, as a percentage.
 *
 * Annualised at 52 weeks, which is the convention the rest of the cash-flow
 * engine uses for a headline yield. It returns null rather than 0 when a figure
 * is missing: a property whose rent was never recorded has an UNKNOWN yield,
 * and 0% is a claim about the property rather than about the record.
 */
export function grossYield(
  purchasePrice: number | null | undefined,
  weeklyRent: number | null | undefined,
): number | null {
  if (typeof purchasePrice !== 'number' || !Number.isFinite(purchasePrice) || purchasePrice <= 0) return null;
  if (typeof weeklyRent !== 'number' || !Number.isFinite(weeklyRent) || weeklyRent <= 0) return null;
  return ((weeklyRent * 52) / purchasePrice) * 100;
}

/** Project a candidate onto what the picker draws. */
export function toPickerRow(
  candidate: ComparisonCandidate & { created_at?: string | null },
): PickerRow {
  const { purchasePrice, weeklyRent } = resolveCashFlowFinancialSummary(candidate);
  return {
    id: candidate.id,
    address: String(candidate.property_address ?? '').trim(),
    purchasePrice,
    weeklyRent,
    grossYield: grossYield(purchasePrice, weeklyRent),
    createdAt: candidate.created_at ?? null,
  };
}

/**
 * Does this row match what was typed?
 *
 * Every word must match, and an empty query matches everything. Typing
 * "chester nsw" finds 10 Chester Street in NSW and not a Chester Street in
 * Victoria — which a single substring test cannot do, because the words are
 * not adjacent in the address.
 */
export function matchesQuery(row: PickerRow, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = row.address.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/**
 * Order the list.
 *
 * A row with no figure sorts LAST in every value ordering rather than as zero:
 * an unpriced record is not the cheapest property, and putting it at the top of
 * "highest price" is how a list stops being readable. `recent` is the order the
 * query already returns and is the default, so the newest work is in front.
 */
export function sortRows(rows: PickerRow[], sort: PickerSort): PickerRow[] {
  const copy = [...rows];
  const lastIfNull = (value: number | null) => (value === null ? -Infinity : value);
  switch (sort) {
    case 'price_desc':
      return copy.sort((a, b) => lastIfNull(b.purchasePrice) - lastIfNull(a.purchasePrice));
    case 'yield_desc':
      return copy.sort((a, b) => lastIfNull(b.grossYield) - lastIfNull(a.grossYield));
    case 'address':
      return copy.sort((a, b) => a.address.localeCompare(b.address, 'en-AU'));
    case 'recent':
    default:
      return copy;
  }
}

/** Search then sort, in that order, so sorting never has to know about search. */
export function visibleRows(rows: PickerRow[], query: string, sort: PickerSort): PickerRow[] {
  return sortRows(rows.filter((row) => matchesQuery(row, query)), sort);
}

/**
 * What the counter says.
 *
 * Counted in REPORTS COMPARED rather than peers added, because that is the
 * number on the page ("Comparing 3 properties") and the number the ceiling is
 * expressed in. A counter that says "2 of 4" beside a heading that says
 * "5 properties" is two ways of saying one thing, and the reader has to work
 * out which is which.
 */
export function selectionSummary(selectedCount: number, total: number): string {
  const compared = selectedCount + 1;
  return `Comparing ${compared} of ${total} reports`;
}

/** Whether another property may still be added. */
export function canAddMore(selectedCount: number, maxPeers: number): boolean {
  return selectedCount < maxPeers;
}

/**
 * Filling an analysis from a saved property record.
 *
 * The standalone calculators each read the linked property themselves and each
 * decided independently what to do with it, which is why the same building
 * could show one purchase price on the cap-rate card and another on the
 * borrowing card. Here there is one mapping, it is pure, and it is auditable:
 * every value it writes also records where it came from, so the workspace can
 * say "from the property record" beside a figure nobody typed.
 *
 * ## The rule about overwriting
 *
 * A prefill never overwrites a value the operator has already set. It fills
 * blanks. The property record is a *starting point*, and an analysis that
 * silently replaced a negotiated price with the one on file would be worse
 * than one that filled nothing — the operator would have no way to know.
 * Anything already present is reported back as skipped, with both values, so
 * the difference can be resolved deliberately on screen.
 */

import type { CalculatorPrefill } from '@/contexts/CalculatorPrefillContext';
import { withAnalysis } from './analysis';
import type { AssessmentPayload, FieldProvenance } from './types';

export interface PrefillChange {
  field: string;
  label: string;
  value: number | string;
  /** Set when the analysis already held a different value; nothing was written. */
  existing?: number | string;
}

export interface PrefillOutcome {
  payload: AssessmentPayload;
  /** What was written. */
  applied: PrefillChange[];
  /** What was left alone because the analysis already had a value. */
  skipped: PrefillChange[];
}

const usable = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value) && value !== 0
);

function provenanceFor(field: string, propertyId: string): FieldProvenance {
  return {
    field,
    source: 'client_profile',
    sourceRef: `Property record ${propertyId}`,
    requiresConfirmation: true,
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Apply a property record to an analysis payload.
 *
 * Returns a new payload; the caller decides whether to keep it. Nothing here
 * reaches the network or the store.
 */
export function applyPropertyPrefill(
  payload: AssessmentPayload,
  prefill: CalculatorPrefill,
): PrefillOutcome {
  const applied: PrefillChange[] = [];
  const skipped: PrefillChange[] = [];
  const provenance: FieldProvenance[] = [];

  let next: AssessmentPayload = {
    ...payload,
    property: { ...payload.property },
    lease: { ...payload.lease },
  };

  const setNumber = (
    field: string,
    label: string,
    incoming: number | null | undefined,
    current: number,
    write: (value: number) => void,
  ) => {
    if (!usable(incoming)) return;
    if (usable(current)) {
      if (current !== incoming) skipped.push({ field, label, value: incoming, existing: current });
      return;
    }
    write(incoming);
    applied.push({ field, label, value: incoming });
    provenance.push(provenanceFor(field, prefill.propertyId));
  };

  const setText = (
    field: string,
    label: string,
    incoming: string | null | undefined,
    current: string,
    write: (value: string) => void,
  ) => {
    const value = (incoming ?? '').trim();
    if (!value) return;
    if (current.trim()) {
      if (current.trim() !== value) skipped.push({ field, label, value, existing: current });
      return;
    }
    write(value);
    applied.push({ field, label, value });
    provenance.push(provenanceFor(field, prefill.propertyId));
  };

  // ---- Identity ----------------------------------------------------------
  setText('property.address', 'Address', prefill.address, next.property.address, (value) => {
    next.property.address = value;
  });
  setText('property.state', 'State', prefill.state ?? '', next.property.state, (value) => {
    next.property.state = value as AssessmentPayload['property']['state'];
  });

  // ---- Value -------------------------------------------------------------
  setNumber('property.purchasePrice', 'Purchase price', prefill.purchasePrice, next.property.purchasePrice, (value) => {
    next.property.purchasePrice = value;
  });
  setNumber('property.currentValuation', 'Current valuation', prefill.valuation, next.property.currentValuation, (value) => {
    next.property.currentValuation = value;
  });

  // ---- Areas -------------------------------------------------------------
  // Lettable area: whichever measure the record carries, in the order a
  // valuer would prefer — net lettable, then gross lettable, then gross floor.
  setNumber(
    'property.lettableAreaSqm', 'Lettable area',
    prefill.nlaSqm ?? prefill.glaSqm ?? prefill.gfaSqm,
    next.property.lettableAreaSqm,
    (value) => { next.property.lettableAreaSqm = value; },
  );
  setNumber('property.siteAreaSqm', 'Site area', prefill.siteAreaSqm, next.property.siteAreaSqm, (value) => {
    next.property.siteAreaSqm = value;
  });

  // ---- Income ------------------------------------------------------------
  setNumber(
    'lease.marketRentAnnual', 'Market rent', prefill.marketRentPa,
    next.lease.marketRentAnnual,
    (value) => { next.lease.marketRentAnnual = value; },
  );
  setNumber(
    'lease.recoverableOutgoings', 'Recoverable outgoings', prefill.recoveredOutgoingsPa,
    next.lease.recoverableOutgoings,
    (value) => { next.lease.recoverableOutgoings = value; },
  );

  // ---- Industrial site detail -------------------------------------------
  const industrialBefore = next;
  const industrialApplied: PrefillChange[] = [];
  const analysisPatch: Record<string, number> = {};
  const currentAnalysis = (payload.analysis?.industrial ?? {}) as Record<string, number>;

  const setIndustrial = (key: string, label: string, incoming: number | null | undefined) => {
    if (!usable(incoming)) return;
    const current = currentAnalysis[key];
    if (usable(current)) {
      if (current !== incoming) {
        skipped.push({ field: `analysis.industrial.${key}`, label, value: incoming, existing: current });
      }
      return;
    }
    analysisPatch[key] = incoming;
    industrialApplied.push({ field: `analysis.industrial.${key}`, label, value: incoming });
    provenance.push(provenanceFor(`analysis.industrial.${key}`, prefill.propertyId));
  };

  setIndustrial('hardstandAreaSqm', 'Hardstand area', prefill.hardstandSqm);
  setIndustrial('clearanceMetres', 'Clearance height', prefill.clearanceMetres);
  // The record holds kVA; the analysis records amps, so an unconverted number
  // is not written — a wrong unit is worse than a blank field.
  if (usable(prefill.officePct) && usable(prefill.nlaSqm ?? prefill.glaSqm)) {
    setIndustrial(
      'officeAreaSqm', 'Office area',
      Math.round(((prefill.nlaSqm ?? prefill.glaSqm) as number) * (prefill.officePct / 100)),
    );
  }

  if (Object.keys(analysisPatch).length) {
    next = withAnalysis(industrialBefore, 'industrial', analysisPatch);
    applied.push(...industrialApplied);
  }

  return {
    payload: { ...next, provenance: [...payload.provenance, ...provenance] },
    applied,
    skipped,
  };
}

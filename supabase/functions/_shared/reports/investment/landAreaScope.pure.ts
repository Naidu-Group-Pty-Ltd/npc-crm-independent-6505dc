/**
 * What a recorded land area is an area OF.
 *
 * The audit of 291 Stone Mason Drive (QA-21) found "Land Size 1.25 ha" in the
 * property table of a strata townhouse — the scheme's site area, printed
 * under a label that reads as the lot the buyer would own — with a caveat
 * about strata ownership several pages later. A later caveat does not stop a
 * reader, or a downstream calculation, treating a scheme area as owned land.
 *
 * Two rules. **Scope is part of the label**: an area whose scope cannot be
 * resolved from the record is labelled as unresolved in the table itself,
 * never as "Land size". And **an unresolved area is not an input**: it may
 * not be used for land content, redevelopment or valuation reasoning until
 * the registered plan and the individual lot area are held — the reading
 * says so, and `usableForCalculation` is the flag a calculation asks.
 *
 * The record cannot always say whether a dwelling is strata (the audited
 * row's type was unresolved), so size is a second witness: a residential
 * dwelling on 4,000 m² or more is far likelier to be recorded at the site
 * than at the lot, and the cost of the caveat where it was not is a
 * sentence, while the cost of the missed one is a valuation on somebody
 * else's land.
 *
 * Deno-compatible: no imports.
 */

export interface LandAreaInput {
  /** The area the record carries under "land size", in m². */
  landSizeSqm?: number | null;
  /** An individually owned lot area, where the record holds one separately. */
  lotAreaSqm?: number | null;
  propertyType?: string | null;
  isStrata?: boolean | null;
}

export type LandAreaScope = 'lot' | 'unresolved';

export interface LandAreaReading {
  /** The row label, carrying the scope. */
  label: string;
  /** The figure, with a hectare reading beside a large one. */
  value: string;
  scope: LandAreaScope;
  usableForCalculation: boolean;
  /** The sentence the table prints beside an unresolved area. */
  note?: string;
}

/** Dwelling types that commonly sit in a scheme whose site area is recorded as "land". */
const SHARED_SITE_TYPES = /\b(unit|apartment|flat|townhouse|villa|terrace|duplex|strata|retirement|studio)\b/i;
/** Types where a large area is the lot itself. */
const LARGE_LOT_TYPES = /\b(acreage|rural|farm|lifestyle|land|vacant|estate)\b/i;
/** Above this a suburban dwelling's "land size" is read as a site area unless the type says otherwise. */
export const SITE_SCALE_SQM = 4_000;

export const UNRESOLVED_AREA_NOTE =
  'The recorded area is not resolved to the individual lot: it may be the strata scheme or site area rather than the land the buyer would own. Confirm the registered plan, the individual lot area, the common-property extent and the unit entitlement from the title before relying on it, and do not use it for land-content, redevelopment or valuation reasoning.';

const formatArea = (sqm: number): string => {
  const rounded = Math.round(sqm);
  const grouped = String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (rounded >= 10_000) return `${(rounded / 10_000).toFixed(2).replace(/\.?0+$/, '')} ha (${grouped} m²)`;
  return `${grouped} m²`;
};

const finite = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;

/** The reading for the property table, or null when no area is recorded. */
export function describeLandArea(input: LandAreaInput): LandAreaReading | null {
  const lot = finite(input.lotAreaSqm);
  if (lot !== undefined) {
    return { label: 'Land size (individual lot)', value: formatArea(lot), scope: 'lot', usableForCalculation: true };
  }
  const area = finite(input.landSizeSqm);
  if (area === undefined) return null;
  const type = input.propertyType ?? '';
  const sharedType = input.isStrata === true || SHARED_SITE_TYPES.test(type);
  const largeLotType = LARGE_LOT_TYPES.test(type);
  const siteScale = area >= SITE_SCALE_SQM && !largeLotType;
  if (sharedType || siteScale) {
    return {
      label: 'Recorded area (scope unresolved: scheme/site or individual lot)',
      value: formatArea(area),
      scope: 'unresolved',
      usableForCalculation: false,
      note: UNRESOLVED_AREA_NOTE,
    };
  }
  return { label: 'Land size', value: formatArea(area), scope: 'lot', usableForCalculation: true };
}

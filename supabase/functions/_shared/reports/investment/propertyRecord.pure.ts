/**
 * What the record knows about the property itself.
 *
 * ## The defect this exists to end
 *
 * `generate-investment-report` resolves every property fact by merging the
 * operator's `manual_overrides` over the listing's `propertyDetails` —
 * `effectiveLandSizeSqm`, `effectiveBuildSizeSqm`, `effectivePropertyType`,
 * `effectiveBeds`, `effectiveBaths`. Those merged values build the prompt, the
 * duty assessment and the score.
 *
 * Then it persists `property_specs` from `propertyDetails` **alone**:
 *
 * ```ts
 * const propertySpecs = {
 *   land_size_sqm: propertyDetails?.landSizeSqm || null,
 *   building_size_sqm: propertyDetails?.buildSizeSqm || null,
 *   …
 *   property_type: standardizedPropertyType || propertyDetails?.propertyType || 'Residential Property',
 * };
 * ```
 *
 * So the answer is computed, used, and then thrown away at the moment of
 * writing it down. Measured across the completed corpus on 2026-09-08:
 *
 * | the operator supplied | the spec column stored |
 * | --- | ---: |
 * | `landSizeSqm` | null on **127** |
 * | `buildSizeSqm` | null on **122** |
 * | `carSpaces` | null on **144** |
 * | `propertyType` | the literal `'Residential Property'` on **84** |
 *
 * Every one of the 68 reports generated since June 2026 carries an
 * **entirely null** spec block apart from that literal — including
 * `1/27D Mitchell Street`, whose address says unit and whose record says
 * nothing, and `6 Acer Court`, whose overrides hold 1,922 m², 253 m², two car
 * spaces and `house`.
 *
 * ## Two rules
 *
 * **The record must hold what the document asserts.** A fact an operator
 * supplied is persisted where readers look for it.
 *
 * **Absent is absent — never a placeholder.** `'Residential Property'` is not
 * a measurement; it is a hardcoded string that matches no branch in any
 * engine (`normalisePropertyType` returns undefined, `dRisk` tests
 * `unit|apartment|townhouse|house` and hits none, `financialEngine` tests
 * `=== 'unit'` for the strata estimate). Presenting it as the property's type
 * is the same class as a `0.00%` yield standing in for an unknown rent.
 *
 * ## Why reading heals as well as writing
 *
 * Fixing the write alone leaves all 1,180 stored reports with an empty spec
 * block for ever, and the facts are still there in `manual_overrides` on every
 * one of them. So the read resolves the spec column FIRST and falls back to
 * the overrides — the same asymmetry `healFinanceIdentity` settled on, and for
 * the same reason: a repair on the read path reaches every reader with no
 * migration and no stored byte overwritten.
 *
 * The precedence is deliberate. A persisted spec is what the generator
 * concluded at the time; an override is what a person typed. Where both
 * exist they agree (the persisted one is now built FROM the merge), and where
 * they disagree the historical row is the one missing the operator's later
 * correction — so the override is the better answer, not merely the fallback.
 */

import { normalisePropertyType } from './overrides.pure.ts';

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

const str = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Strings that are the ABSENCE of a property type rather than a type.
 *
 * `Residential Property` is the generator's own literal default; the other two
 * are what a caller sends when it has nothing. None of them resolves through
 * `normalisePropertyType`, so none of them reaches an engine branch — storing
 * one is storing a placeholder that reads as a measurement.
 */
const NON_TYPES = new Set(['residential property', 'property', 'unknown', 'n/a', 'other']);

/** A property type worth storing, or null. Never a placeholder. */
export function meaningfulPropertyType(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  return NON_TYPES.has(s.toLowerCase()) ? null : s;
}

/** The merged facts the generator has already resolved for this request. */
export interface EffectivePropertyFacts {
  propertyType?: unknown;
  landSizeSqm?: unknown;
  buildSizeSqm?: unknown;
  beds?: unknown;
  baths?: unknown;
  carSpaces?: unknown;
  yearBuilt?: unknown;
  zoning?: unknown;
  councilArea?: unknown;
}

/** `investment_reports.property_specs`, in the shape the column has always had. */
export interface PropertySpecs {
  property_type: string | null;
  land_size_sqm: number | null;
  building_size_sqm: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  parking: number | null;
  year_built: number | null;
  zoning: string | null;
  council_area: string | null;
}

/**
 * Compose the spec block from the values the request actually resolved.
 *
 * Every field is `| null`. A caller that knows nothing writes nulls, which is
 * a true statement about the record; it does not write a string that looks
 * like a type.
 */
export function composePropertySpecs(facts: EffectivePropertyFacts): PropertySpecs {
  return {
    property_type: meaningfulPropertyType(facts.propertyType),
    land_size_sqm: num(facts.landSizeSqm),
    building_size_sqm: num(facts.buildSizeSqm),
    bedrooms: num(facts.beds),
    bathrooms: num(facts.baths),
    parking: num(facts.carSpaces),
    year_built: num(facts.yearBuilt),
    zoning: str(facts.zoning),
    council_area: str(facts.councilArea),
  };
}

/**
 * Read the property facts off a stored report, healing the historical rows.
 *
 * Takes both `property_specs` and `manual_overrides` because every caller
 * already loads both, and because the second is where the answer actually is
 * on every report written before this module existed.
 *
 * `normalisedType` is the engine's vocabulary (`house | unit | townhouse`) and
 * is **undefined rather than defaulted** where nothing resolves — the rule
 * `effectivePropertyType` already established: a type that will not resolve
 * stays unresolved, because defaulting it to a house awards the scorer's `+3`
 * to a property nobody has classified.
 */
export interface ResolvedPropertyFacts {
  /** As recorded, for display. */
  propertyType: string | null;
  /** The engine's vocabulary, or undefined. Never guessed. */
  normalisedType: 'house' | 'unit' | 'townhouse' | undefined;
  landSizeSqm: number | null;
  buildSizeSqm: number | null;
  beds: number | null;
  baths: number | null;
  carSpaces: number | null;
  yearBuilt: number | null;
  zoning: string | null;
  councilArea: string | null;
}

export function readPropertyFacts(
  specs: unknown,
  overrides: unknown,
): ResolvedPropertyFacts {
  const s = isRecord(specs) ? specs : {};
  const o = isRecord(overrides) ? overrides : {};

  // The spec column first, the operator's own entry second. Note the spec
  // column's snake_case and the overrides' camelCase are different spellings
  // of one fact — reading only one of them is how 127 land sizes went missing.
  const propertyType = meaningfulPropertyType(s.property_type)
    ?? meaningfulPropertyType(o.propertyType);
  const pick = (specKey: string, ovrKey: string): number | null =>
    num(s[specKey]) ?? num(o[ovrKey]);

  return {
    propertyType,
    normalisedType: normalisePropertyType(propertyType),
    landSizeSqm: pick('land_size_sqm', 'landSizeSqm'),
    buildSizeSqm: pick('building_size_sqm', 'buildSizeSqm'),
    beds: pick('bedrooms', 'bedrooms'),
    baths: pick('bathrooms', 'bathrooms'),
    carSpaces: pick('parking', 'carSpaces'),
    // Three spellings of one fact. The override registry's key is
    // `constructionYear` (`src/types/overrideFields.ts`), the spec column's is
    // `year_built`, and `yearBuilt` is what this reader asked for and nothing
    // writes — so a construction year an operator had entered was invisible
    // here on every report that held one. `reportBindingProjection` already
    // healed the same three keys for templates; the scoring reader did not.
    yearBuilt: num(s.year_built) ?? num(o.yearBuilt) ?? num(o.constructionYear),
    zoning: str(s.zoning) ?? str(o.zoningCode),
    councilArea: str(s.council_area) ?? str(o.councilArea),
  };
}

/**
 * Keys `fork-investment-report` reads off `property_specs` that **no writer
 * has ever written**.
 *
 * `price`, `weeklyRent` and `state` are read at `scoreInputRaw`; the spec
 * writer has only ever emitted `land_size_sqm`, `building_size_sqm`,
 * `bedrooms`, `bathrooms`, `parking`, `year_built`, `property_type`, `zoning`
 * and `council_area`. `propertyType` is read too and the writer spells it
 * `property_type`.
 *
 * This is the class the `aml.cases.tenant_id` sweep closed for SQL columns —
 * except JSONB never errors, so the read yields `undefined`, `Number(undefined)`
 * yields `NaN`, and the `||` chain silently takes the next rung. Nothing
 * reports it. Exported so a test can assert the phantom keys stay gone.
 */
export const PHANTOM_SPEC_KEYS = ['price', 'weeklyRent', 'state', 'propertyType'] as const;

/** The keys the spec writer actually emits. */
export const PROPERTY_SPEC_KEYS = [
  'property_type',
  'land_size_sqm',
  'building_size_sqm',
  'bedrooms',
  'bathrooms',
  'parking',
  'year_built',
  'zoning',
  'council_area',
] as const;

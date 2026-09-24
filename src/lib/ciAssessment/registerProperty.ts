/**
 * An assessment and the property-register entry it concerns.
 *
 * The register holds the facts about a building — address, areas, value,
 * outgoings, industrial specification — and outlives any one deal; an
 * assessment is a finance test of one transaction on it. This module is the
 * one place that turns a register row into assessment inputs and records which
 * row an assessment came from. See `registerLink.pure.ts` (the shared half, also
 * read by `manage-ci-assessments`) for why the link lives where it does.
 *
 * ## The prefill rule is unchanged
 *
 * `applyPropertyPrefill` fills blanks and never overwrites, and reports what it
 * left alone. Linking a property is the same act whether it happens when the
 * assessment is created or later, from the Property & transaction step.
 */

import type { CalculatorPrefill } from '@/contexts/CalculatorPrefillContext';
import type { CommercialProperty } from '@/hooks/useCommercialProperties';
import type { IndustrialProperty } from '@/hooks/useIndustrialProperties';
import {
  REGISTER_PROPERTY_KEY, isRegisterDomain, readRegisterLink, registerPropertyPath,
  type RegisterDomain, type RegisterPropertyLink,
} from '../../../supabase/functions/_shared/ciAssessments/registerLink.pure.ts';
import { applyPropertyPrefill, type PrefillChange } from './propertyPrefill';
import type { AssessmentPayload } from './types';

export { isRegisterDomain, registerPropertyPath };
export type { RegisterDomain, RegisterPropertyLink };

// ---------------------------------------------------------------------------
// The link
// ---------------------------------------------------------------------------

/** The register entry this assessment was started from, or null. */
export function registerLinkOf(payload: AssessmentPayload): RegisterPropertyLink | null {
  return readRegisterLink(payload.property);
}

/**
 * Set or clear the link, returning a new payload.
 *
 * Clearing removes the key rather than writing `null`, so an assessment that
 * was never linked and one that was unlinked read the same.
 */
export function withRegisterLink(
  payload: AssessmentPayload,
  link: RegisterPropertyLink | null,
): AssessmentPayload {
  const { [REGISTER_PROPERTY_KEY]: _previous, ...property } = payload.property as AssessmentPayload['property']
    & Record<string, unknown>;
  return {
    ...payload,
    property: (link ? { ...property, [REGISTER_PROPERTY_KEY]: link } : property) as AssessmentPayload['property'],
  };
}

// ---------------------------------------------------------------------------
// Register rows, read for an assessment
// ---------------------------------------------------------------------------

function sumOutgoings(map?: Record<string, number> | null): number {
  if (!map) return 0;
  return Object.values(map).reduce((acc, value) => acc + (Number(value) || 0), 0);
}

/** A commercial register row as the prefill reads it. */
export function buildCommercialPrefill(p: CommercialProperty): CalculatorPrefill {
  const specs = (p.industrial_specs ?? {}) as Record<string, unknown>;
  const outgoings = (p.outgoings_recoverable ?? {}) as Record<string, number>;
  return {
    propertyId: p.id,
    domain: 'commercial',
    address: p.address,
    state: p.state ?? null,
    assetCategory: p.asset_class === 'industrial' ? 'industrial' : 'commercial',
    assetSubtype: p.asset_sub_type ?? p.asset_class,
    gstTreatment: p.gst_treatment,
    purchasePrice: p.purchase_price ?? null,
    valuation: p.valuation ?? null,
    gfaSqm: p.gfa_sqm ?? null,
    nlaSqm: p.nla_sqm ?? null,
    glaSqm: p.nla_sqm ?? null,
    siteAreaSqm: p.site_area_sqm ?? null,
    parkingBays: p.parking_bays ?? null,
    hardstandSqm: Number(specs.hardstand_sqm) || null,
    officePct: Number(specs.office_pct) || null,
    siteCoverPct: Number(specs.site_cover_pct) || null,
    clearanceMetres: Number(specs.clearance_metres) || null,
    powerKva: Number(specs.power_kva) || null,
    dockDoors: Number(specs.dock_doors) || null,
    groundFloorLoadKpa: Number(specs.ground_floor_load_kpa) || null,
    recoveredOutgoingsPa: sumOutgoings(outgoings) || null,
    outgoings,
    yearBuilt: p.year_built ?? null,
    zoning: p.zoning ?? null,
  };
}

/** An industrial register row as the prefill reads it. */
export function buildIndustrialPrefill(p: IndustrialProperty): CalculatorPrefill {
  return {
    propertyId: p.id,
    domain: 'industrial',
    address: [p.street, p.suburb, p.state, p.postcode].filter(Boolean).join(', '),
    state: p.state ?? null,
    assetCategory: 'industrial',
    assetSubtype: p.asset_subtype,
    purchasePrice: p.purchase_price ?? null,
    valuation: p.current_valuation ?? null,
    glaSqm: p.gla_sqm ?? null,
    siteAreaSqm: p.site_area_sqm ?? null,
    siteCoverPct: p.site_cover_pct ?? null,
    officePct: p.office_pct ?? null,
    hardstandSqm: p.hardstand_sqm ?? null,
    clearanceMetres: p.clearance_metres ?? null,
    powerKva: p.power_kva ?? null,
    dockDoors: p.dock_doors ?? null,
    groundFloorLoadKpa: p.ground_floor_load_kpa ?? null,
    yearBuilt: p.year_built ?? null,
    zoning: p.zoning ?? null,
    conditionRating: p.condition_rating ?? null,
  };
}

/** One register property, as a picker offers it. */
export interface RegisterPropertyOption {
  domain: RegisterDomain;
  propertyId: string;
  /** Address, or an industrial property's own name. */
  label: string;
  /** A second line: suburb and type. */
  detail: string;
  /** Whether the building itself is industrial — a commercial-register row can be. */
  industrial: boolean;
}

function joinAddress(...parts: Array<string | null | undefined>): string {
  return parts.map((part) => (part ?? '').trim()).filter(Boolean).join(', ');
}

export function commercialOption(p: CommercialProperty): RegisterPropertyOption {
  const place = joinAddress(p.suburb, [p.state, p.postcode].filter(Boolean).join(' '));
  return {
    domain: 'commercial',
    propertyId: p.id,
    label: (p.address || '').trim() || 'Untitled property',
    detail: [place, (p.asset_class || '').replace(/_/g, ' ')].filter(Boolean).join(' · '),
    industrial: p.asset_class === 'industrial',
  };
}

export function industrialOption(p: IndustrialProperty): RegisterPropertyOption {
  const address = joinAddress(p.street, p.suburb, [p.state, p.postcode].filter(Boolean).join(' '));
  return {
    domain: 'industrial',
    propertyId: p.id,
    label: (p.property_name || '').trim() || address || 'Untitled property',
    detail: [p.property_name ? address : '', (p.asset_subtype || '').replace(/_/g, ' ')].filter(Boolean).join(' · '),
    industrial: true,
  };
}

/** The link an assessment records for a register property. */
export function linkFor(option: Pick<RegisterPropertyOption, 'domain' | 'propertyId' | 'label'>, now: Date = new Date()): RegisterPropertyLink {
  return {
    domain: option.domain,
    propertyId: option.propertyId,
    label: option.label.slice(0, 300),
    linkedAt: now.toISOString(),
  };
}

export interface RegisterPrefillOutcome {
  payload: AssessmentPayload;
  applied: PrefillChange[];
  skipped: PrefillChange[];
}

/**
 * Link a register property and fill the assessment's blanks from it.
 *
 * The link is recorded whether or not anything was filled: "this assessment is
 * of that building" is true even when every figure was already typed.
 */
export function applyRegisterProperty(
  payload: AssessmentPayload,
  prefill: CalculatorPrefill,
  link: RegisterPropertyLink,
): RegisterPrefillOutcome {
  const outcome = applyPropertyPrefill(payload, prefill);
  return {
    payload: withRegisterLink(outcome.payload, link),
    applied: outcome.applied,
    skipped: outcome.skipped,
  };
}

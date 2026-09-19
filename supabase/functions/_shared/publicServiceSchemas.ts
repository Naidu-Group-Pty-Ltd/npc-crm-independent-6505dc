/**
 * WP-24: request schemas for the unauthenticated location data services.
 *
 * ## Why these five first
 *
 * `abs-employment-service`, `climate-data-service`, `crime-statistics-service`,
 * `public-transport-service` and `school-data-service` are classified `public`
 * in `SECURITY_REGISTRY.json` — no session, no cookie, reachable by anyone with
 * the publishable key that ships in the browser bundle.
 *
 * All five read their body with a bare `await req.json()` and a TypeScript type
 * *assertion*, which checks nothing at runtime. That has three consequences, in
 * increasing order of how much they matter:
 *
 *  1. A non-JSON body throws inside the try and answers 500. Noise.
 *  2. `{"state": {"$ne": null}}` reaches whatever the handler does with `state`
 *     — string interpolation into a URL, a lookup key — as an object.
 *  3. **There is no size bound.** `req.json()` will read whatever is sent. On an
 *     endpoint that needs no credentials at all, that is an unauthenticated
 *     memory-pressure vector, and it is the reason these five went first rather
 *     than the 31 `public-auth` ones behind a login.
 *
 * `parseJsonBody` from `_shared/validate.ts` fixes all three in one call,
 * because the size bound and the shape check are the same call.
 *
 * ## Shapes
 *
 * Deliberately `.strict()`. These take a locality and nothing else; an unknown
 * key is a caller sending something the endpoint does not implement, and saying
 * so is more useful than ignoring it. Bounds are generous enough that no real
 * Australian locality is rejected and small enough that none of this is a
 * payload: no suburb name is 120 characters.
 */
import { z } from 'npm:zod@3.25.76';
import { optionalField } from './schemaHelpers.ts';

/** Australian state/territory abbreviations, plus the long forms seen in the wild. */
const stateField = z.string().trim().min(2).max(40);

/** A locality string. Trimmed, bounded, and never empty when present. */
const localityField = z.string().trim().max(120);

/**
 * Australian postcode.
 *
 * Accepts a number because callers send both, and always yields a **string** —
 * a validator that hands downstream code a union has moved the problem rather
 * than solved it, and every consumer here treats a postcode as text.
 */
const postcodeField = z.union([
  z.string().trim().regex(/^\d{3,4}$/),
  z.number().int().min(200).max(9999),
]).transform((v) => String(v));

/**
 * `{ suburb, state, postcode }` — `abs-employment`, `climate`, `crime-statistics`.
 *
 * Only `state` is required; each handler already returns 400 without it, and
 * that check stays where it is so this schema does not quietly become the place
 * business rules live.
 */
export const LocalityRequest = z.object({
  suburb: optionalField(localityField),
  state: stateField,
  postcode: optionalField(postcodeField),
}).strict();

/** `school-data-service` — the locality plus optional coordinates. */
export const SchoolDataRequest = z.object({
  suburb: optionalField(localityField),
  state: stateField,
  postcode: optionalField(postcodeField),
  latitude: optionalField(z.number().min(-90).max(90)),
  longitude: optionalField(z.number().min(-180).max(180)),
}).strict();

/** `public-transport-service` — coordinates are required here, the locality is not. */
export const PublicTransportRequest = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  state: stateField,
  suburb: optionalField(localityField),
}).strict();

/**
 * `climate-data-service` — the coordinate is the question (SILO's grid is
 * point-keyed); the locality fields remain accepted for the legacy callers
 * and for the honest no-coordinate refusal.
 */
export const ClimateDataRequest = z.object({
  suburb: optionalField(localityField),
  state: optionalField(stateField),
  postcode: optionalField(postcodeField),
  latitude: optionalField(z.number().min(-90).max(90)),
  longitude: optionalField(z.number().min(-180).max(180)),
}).strict();

/**
 * `crime-statistics-service` — the locality, plus the LGA where the state's
 * register is LGA-keyed (QLD): the generator passes the cadastre's own
 * shire name once planning data has resolved it.
 */
/**
 * RF-7.2B.1B0-F4 — the population a per-capita rate divides by is ADMITTED
 * EVIDENCE supplied by the caller, never something the crime service looks up.
 * Every field is required when it is present at all: a population with no
 * source, geography or vintage cannot describe its own denominator, and a rate
 * that cannot describe its denominator is what §25 forbids.
 */
const admittedPopulation = z.object({
  value: z.number().finite().positive(),
  source: z.string().min(1).max(120),
  geography: z.string().min(1).max(120),
  grain: z.enum(['postcode', 'lga', 'sa2', 'region', 'state']),
  vintage: z.string().min(1).max(200),
}).strict();

export const CrimeStatisticsRequest = z.object({
  suburb: optionalField(localityField),
  state: stateField,
  postcode: optionalField(postcodeField),
  lga: optionalField(localityField),
  population: admittedPopulation.optional(),
}).strict();

/**
 * `abs-regional-service` — the coordinate is the question (the SA2 that
 * contains it is resolved server-side); the locality fields remain accepted
 * for the honest no-coordinate refusal and the Australia gate.
 */
export const RegionalTrendsRequest = z.object({
  suburb: optionalField(localityField),
  state: optionalField(stateField),
  postcode: optionalField(postcodeField),
  latitude: optionalField(z.number().min(-90).max(90)),
  longitude: optionalField(z.number().min(-180).max(180)),
}).strict();

/**
 * `planning-data-service` — the coordinate is the question; the locality
 * fields only order which jurisdiction's layers are preferred when two
 * boundary polygons both claim a point.
 */
export const PlanningDataRequest = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  state: optionalField(stateField),
  postcode: optionalField(postcodeField),
}).strict();

/**
 * 8 KiB. A locality lookup that needs more than this is not a locality lookup,
 * and on an endpoint with no authentication the ceiling should be the smallest
 * one that cannot inconvenience a real caller.
 */
export const PUBLIC_SERVICE_MAX_BODY_BYTES = 8 * 1024;

/**
 * Where an assessment records the property-register entry it was started from.
 *
 * ## Why an assessment needs to know
 *
 * The Commercial & Industrial module holds two records of a building. The
 * **property register** holds the facts about the asset — address, areas,
 * tenancies, capital works — and outlives any one deal. An **assessment** is a
 * finance test of one transaction on it. The two had no connection at all: an
 * assessment copied the address and price in by hand, the register never
 * learned an assessment existed, and the only trace of a register property in
 * an assessment was a free-text provenance note. Opening a building and asking
 * "what have we assessed here?" had no answer.
 *
 * ## Why it lives inside `payload.property`
 *
 * The link is written to `payload.property.registerProperty` rather than to a
 * new top-level key, because `hydrateAssessmentPayload` rebuilds the payload
 * from a fixed list of sections and silently drops a top-level key it does not
 * know — while every section is spread, so a key inside one survives. A link
 * stored at the top level would have been lost on the next load and erased
 * from the database by the autosave after it.
 *
 * It is a pointer, not a copy: the figures an assessment uses are its own
 * (filled from the register once, blanks only, then edited freely), and the
 * link is what lets the register list the assessments made of a property.
 */

/** The key under `payload.property` that holds the link. */
export const REGISTER_PROPERTY_KEY = 'registerProperty';

/** The PostgREST path the list operation filters on. */
export const REGISTER_PROPERTY_ID_PATH = `payload->property->${REGISTER_PROPERTY_KEY}->>propertyId`;

export type RegisterDomain = 'commercial' | 'industrial';

export interface RegisterPropertyLink {
  /** Which register table the property is in, and which detail route opens it. */
  domain: RegisterDomain;
  propertyId: string;
  /** The address or name at the time of linking, so the link reads without a fetch. */
  label: string;
  /** ISO timestamp the link was made. */
  linkedAt: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export function isRegisterDomain(value: unknown): value is RegisterDomain {
  return value === 'commercial' || value === 'industrial';
}

/**
 * Read a link from anything shaped like a payload's property section.
 *
 * Returns null for a missing, partial or malformed link rather than a link the
 * app would then try to open.
 */
export function readRegisterLink(propertySection: unknown): RegisterPropertyLink | null {
  if (!propertySection || typeof propertySection !== 'object') return null;
  const raw = (propertySection as Record<string, unknown>)[REGISTER_PROPERTY_KEY];
  if (!raw || typeof raw !== 'object') return null;
  const link = raw as Record<string, unknown>;
  if (!isRegisterDomain(link.domain) || !isUuid(link.propertyId)) return null;
  return {
    domain: link.domain,
    propertyId: link.propertyId,
    label: typeof link.label === 'string' ? link.label.slice(0, 300) : '',
    linkedAt: typeof link.linkedAt === 'string' ? link.linkedAt : '',
  };
}

/** The in-app route of a register property's own page. */
export function registerPropertyPath(link: Pick<RegisterPropertyLink, 'domain' | 'propertyId'>): string {
  return `/${link.domain}/${encodeURIComponent(link.propertyId)}`;
}

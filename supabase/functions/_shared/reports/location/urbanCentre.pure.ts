/**
 * Which city a "CBD commute" should be measured to.
 *
 * ## What the capital-only rule did to a regional property
 *
 * `cbdDestination.pure.ts` resolves the STATE CAPITAL and names this gap in
 * its own header: *"whether the state capital is the right destination for a
 * given property at all. For a Moranbah or a Gympie it plainly is not, and
 * choosing an appropriate centre is its own piece of work."* This is that
 * piece of work.
 *
 * Measured on the 9 Hollow Street Compass of 20 Sep 2026. Golden Square is a
 * suburb of **Bendigo**, a city of about 100,000 with its own CBD, hospital,
 * university campus and employment base — which that document's own prose
 * says twice: *"practical access to employment, retail and services in Bendigo
 * CBD"* and *"proximity to Bendigo's employment base, amenities and
 * services"*. The commute was measured to **Melbourne**, 114 minutes, and
 * `COMMUTE_ANCHORS` ends at `[110, 0]` — so the reading scored **0 of 100** on
 * a component of Location, and Location came out at 49 against 69 and 74 for
 * the two metropolitan properties beside it.
 *
 * A 114-minute drive to Melbourne is a true fact and a real distance. It is
 * not a reading about this property's access to anything, because Melbourne is
 * not this property's market.
 *
 * ## The register
 *
 * The ABS publishes the answer already: **Significant Urban Areas**, the
 * ASGS's own classification of Australia's urban centres of 10,000 people and
 * over. `resolveOneReportGeography.ts` has queried the `SUA` layer at
 * `geo.abs.gov.au` since ME-5 and stores `sua_code_2021` / `sua_name_2021`
 * against every resolved coordinate, so the platform already knows which
 * urban centre a property is in. What it has never held is a POINT for that
 * centre, which is what a commute needs — `urban_centre_register` is that,
 * and `urban-centre-register-ingest` loads it from the same service and the
 * same release.
 *
 * ## Two rules, and the second works before the register has run
 *
 * **A commute is measured to the property's OWN urban centre where the
 * register names one.** That is the fix: Golden Square is measured to Bendigo.
 *
 * **A commute to somewhere that is NOT this property's urban centre is not a
 * reading about this property's access.** It is still measured, recorded and
 * reported — it is true — and it carries `ownCentre: 'no'`, which
 * `scoreLocation` excludes from the score rather than scoring as zero. That is
 * `PLANNING_CONTROLS_IN_THE_REPORT.md` §9's rule in a different dress: the
 * reading describes the distance between two markets, and rating it as this
 * property's access rates something nobody measured.
 *
 * The second rule needs no register at all — it needs only to know whether the
 * property's SUA is the capital's, which the SUA NAME answers — so a
 * deployment whose ingest has never run stops scoring the wrong measurement
 * immediately and starts measuring the right one when the register lands.
 * `CLONE_PROVISIONING_GAPS.md`'s rule: a feature the migrations have not
 * reached degrades rather than failing.
 *
 * ## Three bounds
 *
 * **`ownCentre` is a three-state reading, never a boolean.** Where no SUA was
 * resolved the answer is `'unknown'`, and an unknown is scored exactly as it
 * is today — a rule that cannot tell a Bendigo property from a Sydney one must
 * not act as though it could.
 *
 * **The capital match is state-scoped and on a word boundary.** `Canberra -
 * Queanbeyan` is the ACT's SUA and does not equal `Canberra`, so an equality
 * test would send every ACT property down the not-my-centre path and discard a
 * correct reading. A substring test alone would be worse — but the comparison
 * is only ever made against the property's OWN state's capital, so a locality
 * sharing a capital's name in another state is never consulted.
 *
 * **A register point states how it was derived.** A capital's CBD is a placed
 * coordinate; an SUA's is the centre of a published polygon, whose error is
 * bounded by the size of the urban area it describes. `pointBasis` records
 * which, because a reader comparing a five-minute Bendigo commute with a
 * forty-minute Sydney one should be able to see that the two points were
 * chosen differently.
 *
 * Pure: no imports beyond the capitals, no I/O.
 */
import { resolveCbdDestination, type CbdDestination } from './cbdDestination.pure.ts';

/** How a centre's coordinate was arrived at. */
/**
 * How a centre's point was arrived at, in the register's own words.
 *
 * `sua_boundary_centroid` is what the loader writes and what the ABS supports:
 * the layer publishes no centroid and no coordinate field, so the point is the
 * area-weighted centre of the publisher's own generalised boundary, computed
 * by us. `sua_centroid` would claim the ABS supplied it.
 *
 * Measured 20 Sep 2026 on the first live reading: the service read a register
 * row saying `sua_boundary_centroid` and reported `sua_centroid`, because the
 * read coerced anything that was not `capital_cbd` into it. The register had
 * been made honest and the reader put the overstatement back — so the value
 * travels as written now, and an unrecognised one is refused rather than
 * rounded to the nearest claim.
 */
export type UrbanCentrePointBasis =
  | 'capital_cbd'
  | 'sua_centroid'
  | 'sua_boundary_centroid';

const POINT_BASES: ReadonlyArray<UrbanCentrePointBasis> =
  ['capital_cbd', 'sua_centroid', 'sua_boundary_centroid'];

/** The register's own word for how a point was arrived at, or null. */
export function readPointBasis(value: unknown): UrbanCentrePointBasis | null {
  const raw = String(value ?? '').trim();
  return (POINT_BASES as readonly string[]).includes(raw)
    ? raw as UrbanCentrePointBasis
    : null;
}

/** One row of the register. */
export interface UrbanCentre {
  /** `sua_code_2021`. */
  readonly code: string;
  /** `sua_name_2021`, as the ABS publishes it. */
  readonly name: string;
  /** The state the centre sits in, upper case. */
  readonly state: string;
  readonly lat: number;
  readonly lng: number;
  readonly pointBasis: UrbanCentrePointBasis;
}

/**
 * Whether the destination is the property's own urban centre.
 *
 * `unknown` is its own answer and is treated as today's behaviour, because a
 * rule that cannot tell which market a property is in must not act.
 */
export type OwnCentreReading = 'yes' | 'no' | 'unknown';

export interface CommuteDestination {
  readonly lat: number;
  readonly lng: number;
  /** The city a reader is told the commute was measured TO. */
  readonly label: string;
  /** `own_urban_centre` where the destination is this property's own centre. */
  readonly basis: 'own_urban_centre' | 'state_capital';
  readonly ownCentre: OwnCentreReading;
  readonly pointBasis: UrbanCentrePointBasis;
}

/** The SUA a coordinate resolved to, as `resolveOneReportGeography` records it. */
export interface ResolvedSua {
  readonly code?: string | null;
  readonly name?: string | null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Is this SUA the one the capital sits in?
 *
 * Word-boundary rather than equality, because the ACT's SUA is published as
 * `Canberra - Queanbeyan`; and only ever against the property's own state's
 * capital, so `Perth, TAS` is never compared with `Perth, WA`.
 */
export function suaNameIsCapital(suaName: string | null | undefined, capital: string): boolean {
  const name = norm(String(suaName ?? ''));
  const cap = norm(capital);
  if (!name || !cap) return false;
  return name === cap || name.split(' ').includes(cap)
    || cap.split(' ').every((w) => name.split(' ').includes(w));
}

/** Find the register row for a resolved SUA. Code first — a name can be re-styled. */
export function findUrbanCentre(
  sua: ResolvedSua | null | undefined,
  register: readonly UrbanCentre[],
): UrbanCentre | null {
  const code = String(sua?.code ?? '').trim();
  if (code) {
    const byCode = register.find((c) => c.code === code);
    if (byCode) return byCode;
  }
  const name = norm(String(sua?.name ?? ''));
  if (!name) return null;
  return register.find((c) => norm(c.name) === name) ?? null;
}

/**
 * Where this property's commute should be measured to.
 *
 * Returns null exactly where {@link resolveCbdDestination} does — no state
 * means no known destination, and nothing is assumed. Every other answer
 * carries what it is and how it was chosen.
 */
export function resolveCommuteDestination(args: {
  readonly state: string | null | undefined;
  readonly sua?: ResolvedSua | null;
  readonly register?: readonly UrbanCentre[];
}): CommuteDestination | null {
  const capital: CbdDestination | null = resolveCbdDestination(args.state);
  if (!capital) return null;

  const asCapital = (ownCentre: OwnCentreReading): CommuteDestination => ({
    lat: capital.lat,
    lng: capital.lng,
    label: capital.capital,
    basis: ownCentre === 'yes' ? 'own_urban_centre' : 'state_capital',
    ownCentre,
    pointBasis: 'capital_cbd',
  });

  const name = String(args.sua?.name ?? '').trim();
  const code = String(args.sua?.code ?? '').trim();
  // No urban area resolved: this is today's behaviour, and it says so rather
  // than claiming the capital is or is not this property's centre.
  if (!name && !code) return asCapital('unknown');

  if (suaNameIsCapital(name, capital.capital)) return asCapital('yes');

  const centre = findUrbanCentre(args.sua, args.register ?? []);
  if (centre) {
    return {
      lat: centre.lat,
      lng: centre.lng,
      label: centre.name,
      basis: 'own_urban_centre',
      ownCentre: 'yes',
      pointBasis: centre.pointBasis,
    };
  }

  // The property is in an urban centre the register does not yet name. The
  // capital is measured, because a real distance is worth recording, and it is
  // marked as not this property's centre so the score does not rate it.
  return asCapital('no');
}

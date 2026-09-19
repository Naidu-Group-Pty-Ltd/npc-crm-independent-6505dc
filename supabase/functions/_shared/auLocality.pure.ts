/**
 * Australian state and postcode reconciliation.
 *
 * The intake table's `Postcode` and `State` columns look well populated — 8 of 8
 * in every sample — and are wrong often enough to be dangerous. Values carry
 * over between listings processed in the same batch:
 *
 *   - "5 Banya Street, Campbells Creek, **VIC**" → postcode **4171**.
 *     4171 is Balmoral, Queensland. Campbells Creek is 3451.
 *   - A record in **Caboolture, QLD** → postcode **6015**, which is City Beach,
 *     Western Australia.
 *   - A record with no address and no suburb at all → postcode **6015**, QLD.
 *
 * `6015` recurs across unrelated records, which is the signature of a value
 * being reused within a batch rather than extracted per listing. The upstream
 * `Address Confidence` score does not catch it: the first of those scored 0.90.
 *
 * Left alone, this feeds a geocoder — so a Victorian property is looked up in
 * Queensland and the map places it, confidently, 1,400 km from the house. It
 * also corrupts every postcode and state facet in the filter panel.
 *
 * So a postcode and a state are only trusted when they agree with each other.
 * When they conflict the untrustworthy one is dropped rather than guessed at,
 * and the conflict is recorded so the UI can say the data is disputed instead of
 * quietly presenting one of two contradictory answers.
 *
 * Pure: no Deno, Supabase, network, DOM or clock.
 */

export type AuState = 'NSW' | 'VIC' | 'QLD' | 'SA' | 'WA' | 'TAS' | 'NT' | 'ACT';

/** How much of the locality survived reconciliation. */
export type LocalityTrust =
  /** Postcode and state agreed, or only one was present and it was usable. */
  | 'record'
  /** One was missing and was derived from the other. */
  | 'derived'
  /** They contradicted each other; the loser was dropped. */
  | 'conflict'
  /** Nothing usable was present. */
  | 'unknown';

export interface ReconciledLocality {
  state: AuState | null;
  postcode: string | null;
  trust: LocalityTrust;
  /** Human-readable, for the provenance panel and logs. */
  conflicts: string[];
}

/**
 * Postcode ranges by state.
 *
 * ACT is carved out of the NSW range and must be tested first — 2600 is
 * Canberra, not New South Wales, and a plain range check would say otherwise.
 * Ranges are the published Australia Post allocations; they are contiguous
 * enough that a range test is the right tool, and precise enough to catch a
 * postcode borrowed from a different state, which is the failure mode here.
 */
const ACT_RANGES: Array<[number, number]> = [
  [200, 299],
  [2600, 2618],
  [2900, 2920],
];

const STATE_RANGES: Array<[AuState, Array<[number, number]>]> = [
  ['NSW', [[1000, 2599], [2619, 2899], [2921, 2999]]],
  ['VIC', [[3000, 3999], [8000, 8999]]],
  ['QLD', [[4000, 4999], [9000, 9999]]],
  ['SA', [[5000, 5799], [5800, 5999]]],
  ['WA', [[6000, 6797], [6800, 6999]]],
  ['TAS', [[7000, 7799], [7800, 7999]]],
  ['NT', [[800, 899], [900, 999]]],
];

const STATE_ALIASES: Record<string, AuState> = {
  nsw: 'NSW',
  'new south wales': 'NSW',
  vic: 'VIC',
  victoria: 'VIC',
  qld: 'QLD',
  queensland: 'QLD',
  sa: 'SA',
  'south australia': 'SA',
  wa: 'WA',
  'western australia': 'WA',
  tas: 'TAS',
  tasmania: 'TAS',
  nt: 'NT',
  'northern territory': 'NT',
  act: 'ACT',
  'australian capital territory': 'ACT',
};

/** Normalises whatever the source called a state, or null. */
export function normaliseAuState(value: unknown): AuState | null {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase().replace(/\s+/g, ' ');
  return STATE_ALIASES[key] ?? null;
}

/** A four-digit Australian postcode as a zero-padded string, or null. */
export function normalisePostcode(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const digits = String(value).trim().match(/^(\d{3,4})$/);
  if (!digits) return null;
  const padded = digits[1].padStart(4, '0');
  // 0000 and 9999-style placeholders are not real allocations.
  return stateForPostcode(padded) ? padded : null;
}

/** The state a postcode belongs to, or null if it falls in no allocation. */
export function stateForPostcode(postcode: unknown): AuState | null {
  const raw = typeof postcode === 'number' ? String(postcode) : String(postcode ?? '').trim();
  if (!/^\d{3,4}$/.test(raw)) return null;
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return null;

  // ACT first: its ranges sit inside the block otherwise allocated to NSW.
  for (const [low, high] of ACT_RANGES) {
    if (numeric >= low && numeric <= high) return 'ACT';
  }
  for (const [state, ranges] of STATE_RANGES) {
    for (const [low, high] of ranges) {
      if (numeric >= low && numeric <= high) return state;
    }
  }
  return null;
}

export interface LocalityInput {
  state?: unknown;
  postcode?: unknown;
}

/**
 * Reconciles a record's state and postcode against each other.
 *
 * The rule is that two fields which disagree cannot both be kept, and there is
 * no basis for preferring either — so both are dropped and the conflict is
 * surfaced. That is deliberately more destructive than picking a winner: a
 * geocoder given "Campbells Creek VIC" finds the right town, while one given
 * "Campbells Creek 4171" or "Campbells Creek QLD" does not, and a blank field
 * makes the caller fall back to the suburb rather than trusting a coin flip.
 */
export function reconcileLocality({ state, postcode }: LocalityInput): ReconciledLocality {
  const declaredState = normaliseAuState(state);
  const declaredPostcode = normalisePostcode(postcode);
  const conflicts: string[] = [];

  if (!declaredState && !declaredPostcode) {
    return { state: null, postcode: null, trust: 'unknown', conflicts };
  }

  if (declaredState && !declaredPostcode) {
    return { state: declaredState, postcode: null, trust: 'record', conflicts };
  }

  if (!declaredState && declaredPostcode) {
    // The postcode implies a state, and a postcode is far harder to transpose
    // plausibly than a two-letter code, so deriving here is safe.
    return {
      state: stateForPostcode(declaredPostcode),
      postcode: declaredPostcode,
      trust: 'derived',
      conflicts,
    };
  }

  const impliedState = stateForPostcode(declaredPostcode);
  if (impliedState === declaredState) {
    return { state: declaredState, postcode: declaredPostcode, trust: 'record', conflicts };
  }

  conflicts.push(
    `postcode ${declaredPostcode} belongs to ${impliedState ?? 'no state'}, ` +
      `but the record says ${declaredState}`,
  );
  return { state: null, postcode: null, trust: 'conflict', conflicts };
}

/**
 * The address string handed to a geocoder.
 *
 * Built only from parts that survived reconciliation, and never from the
 * placeholder text the projection used to emit — "Unknown Address, Unknown
 * Suburb" is a query that returns a confident result for somewhere entirely
 * unrelated.
 */
export function buildGeocodeQuery(parts: {
  address?: string | null;
  suburb?: string | null;
  state?: string | null;
  postcode?: string | null;
}): string {
  const clean = (value: string | null | undefined, max: number): string => {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (/^unknown\b/i.test(trimmed)) return '';
    return trimmed.slice(0, max);
  };
  return [
    clean(parts.address, 160),
    clean(parts.suburb, 80),
    clean(parts.state, 12),
    clean(parts.postcode, 8),
  ]
    .filter(Boolean)
    .join(', ');
}

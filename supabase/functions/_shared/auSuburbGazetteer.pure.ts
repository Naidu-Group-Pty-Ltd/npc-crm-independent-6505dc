import { normaliseAuState } from './auLocality.pure.ts';

/**
 * Which Australian locality does a bare suburb name mean?
 *
 * The geocoder is restricted to `country:AU`, which is the strongest thing a
 * provider parameter can say — and it is not nearly enough. Australia reuses
 * locality names across states relentlessly, so a record carrying a suburb and
 * NO state is genuinely ambiguous, and the provider answers it by picking one.
 * `Donnybrook` exists in Queensland, Victoria AND Western Australia; five
 * Victorian builder properties were plotted at Donnybrook WA, 2,700km from the
 * estate they belong to. Nothing downstream could catch it: `assessAuPoint`
 * cross-checks a point against the state the RECORD names, and the record
 * named none.
 *
 * Builder stock is the acute case — every published item carries a suburb and
 * neither state nor postcode — but it is the same hole a listing falls through
 * whenever intake writes `Unknown` into the state column.
 *
 * The fix is to answer the question BEFORE asking the provider, from
 * `public.suburb_directory`: 18,519 Australian localities with their state and
 * postcode. Three outcomes, and the third is the one that matters:
 *
 *  - the name exists in exactly one state → adopt that state (and its postcode
 *    when the name maps to exactly one), so the provider is asked a question
 *    with one answer and `assessAuPoint` gains a state to check against;
 *  - the name exists in several states → do NOT pick one. Look for a hint from
 *    the cohort the record arrived with (see `cohortState`), and use it only if
 *    it is one of the real options;
 *  - no hint, or a hint that is not an option → resolve NOTHING and say so.
 *
 * That last rule is the point. A wrong state is far worse than a missing one:
 * a missing state leaves the record where it already was, while a wrong one is
 * a confident pin in another state that every gate downstream will wave
 * through, because they all cross-check against exactly the state we invented.
 *
 * This is the SUBURB -> state question, and it is deliberately a separate
 * module from `auLocality.pure.ts`, which answers the different question of
 * whether a record's own state and postcode agree with each other. That one
 * reconciles two fields the record supplied; this one supplies a field the
 * record never had. They compose: resolve the locality here, then reconcile.
 *
 * Pure: no Deno, no DOM, no database. The caller supplies the gazetteer rows.
 */

export interface LocalityRow {
  suburb: string;
  state: string;
  postcode?: string | null;
}

export type LocalityOutcome =
  | 'no_suburb'
  | 'already_stated'
  | 'unknown_locality'
  | 'resolved_unique'
  | 'resolved_by_cohort'
  | 'ambiguous';

export interface LocalityResolution {
  /** The state to use, or null when nothing could be resolved honestly. */
  state: string | null;
  /** The postcode to use, or null. Only ever adopted when unambiguous. */
  postcode: string | null;
  outcome: LocalityOutcome;
  /** The states the name could mean — for reporting an ambiguity to a human. */
  candidates: string[];
}

/** Localities are matched case- and punctuation-insensitively, never fuzzily. */
export function normaliseLocalityName(value: string | null | undefined): string {
  if (typeof value !== 'string') return '';
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** `Unknown` is not a state, and neither is an empty string. */
function statedState(value: string | null | undefined): string | null {
  return normaliseAuState(value);
}

export type LocalityIndex = Map<string, LocalityRow[]>;

export function indexLocalities(rows: LocalityRow[]): LocalityIndex {
  const index: LocalityIndex = new Map();
  for (const row of rows) {
    const key = normaliseLocalityName(row.suburb);
    if (!key) continue;
    const state = statedState(row.state);
    if (!state) continue;
    const list = index.get(key);
    if (list) list.push({ ...row, state });
    else index.set(key, [{ ...row, state }]);
  }
  return index;
}

/**
 * The cohort hint.
 *
 * Records arrive in batches that share an origin — one builder's stock upload,
 * one intake run — and the unambiguous members of that batch say where the
 * batch is. Sixteen of nineteen builder suburbs resolve to Victoria on their
 * own, which is what makes `Clyde` and `Armstrong Creek` and `Donnybrook`
 * Victorian too. It is a hint and never an override: it is consulted ONLY for
 * a name that is genuinely ambiguous, and only when it names one of that
 * name's real states.
 *
 * Returns null unless one state holds a clear majority of the cohort, because
 * a batch spread evenly over three states says nothing about any of them.
 */
export function cohortStateFrom(
  suburbs: Array<string | null | undefined>,
  index: LocalityIndex,
): string | null {
  const tally = new Map<string, number>();
  for (const suburb of suburbs) {
    const rows = index.get(normaliseLocalityName(suburb));
    if (!rows || rows.length === 0) continue;
    const states = new Set(rows.map((r) => r.state));
    // Only unambiguous members get a vote — an ambiguous name cannot be
    // evidence for the very question it is asking.
    if (states.size !== 1) continue;
    const state = [...states][0];
    tally.set(state, (tally.get(state) ?? 0) + 1);
  }
  if (tally.size === 0) return null;
  const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  const total = ranked.reduce((sum, [, n]) => sum + n, 0);
  const [topState, topCount] = ranked[0];
  // A clear majority, not merely the largest minority.
  return topCount * 2 > total ? topState : null;
}

export function resolveAuLocality(
  input: { suburb?: string | null; state?: string | null; postcode?: string | null },
  index: LocalityIndex,
  cohortState?: string | null,
): LocalityResolution {
  const stated = statedState(input.state);
  const postcode = typeof input.postcode === 'string' && input.postcode.trim()
    ? input.postcode.trim()
    : null;

  if (stated) {
    return { state: stated, postcode, outcome: 'already_stated', candidates: [stated] };
  }

  const key = normaliseLocalityName(input.suburb);
  if (!key) return { state: null, postcode, outcome: 'no_suburb', candidates: [] };

  const rows = index.get(key);
  if (!rows || rows.length === 0) {
    return { state: null, postcode, outcome: 'unknown_locality', candidates: [] };
  }

  const candidates = [...new Set(rows.map((r) => r.state))].sort();

  const postcodeFor = (state: string): string | null => {
    if (postcode) return postcode;
    const codes = [
      ...new Set(
        rows
          .filter((r) => r.state === state)
          .map((r) => (typeof r.postcode === 'string' ? r.postcode.trim() : ''))
          .filter(Boolean),
      ),
    ];
    // A suburb can straddle postcodes; only adopt one when there is no doubt.
    return codes.length === 1 ? codes[0] : null;
  };

  if (candidates.length === 1) {
    const state = candidates[0];
    return { state, postcode: postcodeFor(state), outcome: 'resolved_unique', candidates };
  }

  const hint = statedState(cohortState);
  if (hint && candidates.includes(hint)) {
    return { state: hint, postcode: postcodeFor(hint), outcome: 'resolved_by_cohort', candidates };
  }

  // Several real options and nothing that can honestly choose between them.
  return { state: null, postcode, outcome: 'ambiguous', candidates };
}

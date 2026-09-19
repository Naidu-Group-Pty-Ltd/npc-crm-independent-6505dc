import { isOnAustralianLand } from './auLandMask.pure.ts';

/**
 * Sanity for Australian listing coordinates.
 *
 * Every property in this corpus is in Australia, which makes an unusually
 * strong invariant available: a coordinate outside the continent is not an
 * unusual listing, it is a wrong answer. The map, the heat surface and the
 * coordinate caches all consume points from sources that can be wrong in
 * different ways — a geocoder answering a contaminated locality with the
 * wrong hemisphere's town, an approximate match landing on open water, a
 * poisoned cache entry from an earlier bug surviving in someone's browser —
 * and none of those sources can be individually trusted to stay clean. The
 * gate sits at the point of use instead.
 *
 * Two checks, in order of strength:
 *
 * 1. **Country bounds** — a generous box around the continent and Tasmania.
 *    South East Cape, the southernmost habitable point, is -43.64; the box
 *    stops at -43.9. A "listing" south of that is in the Southern Ocean.
 * 2. **State cross-check** — when the record names its state, the point must
 *    fall inside that state's box, padded ~0.4° (~40km) so border towns
 *    (Albury, Coolangatta, the ACT) never false-positive. A Perth listing
 *    plotted in the Tasman Sea fails this even though both points are
 *    "in Australia".
 *
 * Pure: no Deno, no DOM. Shared by the browser and any function that stores
 * or serves coordinates.
 */

export interface GeoAssessment {
  ok: boolean;
  reason?: 'outside_australia' | 'offshore' | 'wrong_state';
}

interface Box {
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
}

/** Continent + Tasmania, with a small sea margin for jetty-end geocodes. */
const AUSTRALIA: Box = { latMin: -43.9, latMax: -9.9, lngMin: 112.6, lngMax: 153.9 };

/** Per-state boxes. Coarse on purpose — the padding does the diplomacy. */
const STATE_BOXES: Record<string, Box> = {
  WA: { latMin: -35.3, latMax: -13.6, lngMin: 112.6, lngMax: 129.1 },
  NT: { latMin: -26.1, latMax: -10.9, lngMin: 128.9, lngMax: 138.1 },
  SA: { latMin: -38.2, latMax: -25.9, lngMin: 128.9, lngMax: 141.1 },
  QLD: { latMin: -29.3, latMax: -9.9, lngMin: 137.9, lngMax: 153.9 },
  NSW: { latMin: -37.6, latMax: -28.1, lngMin: 140.9, lngMax: 153.7 },
  ACT: { latMin: -36.0, latMax: -35.1, lngMin: 148.7, lngMax: 149.5 },
  VIC: { latMin: -39.3, latMax: -33.9, lngMin: 140.9, lngMax: 150.1 },
  TAS: { latMin: -43.9, latMax: -39.4, lngMin: 143.7, lngMax: 148.6 },
};

/** ~40km of grace, because state borders have towns on both sides. */
const STATE_PADDING = 0.4;

const STATE_ALIASES: Record<string, string> = {
  'western australia': 'WA',
  'northern territory': 'NT',
  'south australia': 'SA',
  queensland: 'QLD',
  'new south wales': 'NSW',
  'australian capital territory': 'ACT',
  victoria: 'VIC',
  tasmania: 'TAS',
};

export function normaliseAuState(state: string | null | undefined): string | null {
  if (!state) return null;
  const trimmed = state.trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  if (upper in STATE_BOXES) return upper;
  return STATE_ALIASES[trimmed.toLowerCase()] ?? null;
}

function inBox(lat: number, lng: number, box: Box, pad = 0): boolean {
  return (
    lat >= box.latMin - pad &&
    lat <= box.latMax + pad &&
    lng >= box.lngMin - pad &&
    lng <= box.lngMax + pad
  );
}

/**
 * Judge a coordinate claimed for an Australian property.
 *
 * An unknown or unrecognised state only weakens the check to country bounds —
 * it never rejects. Rejection always names its reason so the UI can say what
 * failed rather than silently shrinking the plotted count.
 */
export function assessAuPoint(
  lat: number,
  lng: number,
  state?: string | null,
): GeoAssessment {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, reason: 'outside_australia' };
  }
  if (!inBox(lat, lng, AUSTRALIA)) return { ok: false, reason: 'outside_australia' };

  // The country box is a rectangle, and every rectangle around Australia
  // contains sea — Bass Strait, the Bight and the Coral Sea are all inside
  // it. A record with no state and no postcode used to get only the box, so
  // open water could pass every gate. The land mask is the check rectangles
  // cannot do, and because it runs here, every consumer of this module —
  // the browser's validator, the map's final filter and the geocoder — asks
  // the same question: could a property stand on this coordinate at all?
  if (!isOnAustralianLand(lat, lng)) return { ok: false, reason: 'offshore' };

  const code = normaliseAuState(state);
  if (code) {
    const box = STATE_BOXES[code];
    if (box && !inBox(lat, lng, box, STATE_PADDING)) {
      return { ok: false, reason: 'wrong_state' };
    }
  }
  return { ok: true };
}

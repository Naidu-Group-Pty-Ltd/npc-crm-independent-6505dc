/**
 * Postcode-region sanity: the layer state boxes cannot provide.
 *
 * The state cross-check in `auGeoSanity.pure` catches a Perth listing plotted
 * in the Tasman — but a Sunshine Coast property geocoded to Cairns passes it,
 * because both points are in Queensland and Queensland is two thousand
 * kilometres tall. The record's postcode carries the missing resolution:
 * Australian postcodes are allocated in regional bands, so a coarse table of
 * band → bounding box turns "somewhere in the right state" into "in the right
 * part of the state".
 *
 * The table is deliberately coarse and deliberately generous:
 *
 * - Only bands whose geography is unambiguous are listed. A postcode outside
 *   every band simply skips this check — absence of an entry can never hold a
 *   listing back.
 * - Boxes are drawn wide (roughly a hundred kilometres of slack) and padded
 *   again at check time. The point is to catch a pin placed hundreds of
 *   kilometres from its postcode — never to adjudicate a boundary suburb.
 * - Known trap postcodes that jump geography (4825 reaches Mount Isa, 872
 *   spans three states' worth of desert) are simply not listed.
 *
 * Wrong-region beats no-check for this corpus because the failure it catches
 * is common in contaminated intake data and invisible to every other gate.
 *
 * Pure: no Deno, no DOM. Shared by browser and edge functions.
 */

interface Band {
  from: number;
  to: number;
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
}

/** Checked at ±0.35° (~35km) on top of the already-generous boxes. */
const PADDING = 0.35;

const BANDS: Band[] = [
  // --- NSW ---
  { from: 2000, to: 2249, latMin: -34.4, latMax: -33.2, lngMin: 150.4, lngMax: 151.7 }, // Sydney metro
  { from: 2250, to: 2263, latMin: -33.7, latMax: -33.0, lngMin: 151.0, lngMax: 151.8 }, // Central Coast
  { from: 2280, to: 2330, latMin: -33.4, latMax: -32.2, lngMin: 150.7, lngMax: 152.2 }, // Newcastle / Hunter
  { from: 2440, to: 2490, latMin: -31.5, latMax: -28.1, lngMin: 152.3, lngMax: 153.7 }, // Mid North Coast → Tweed
  { from: 2500, to: 2540, latMin: -35.2, latMax: -34.2, lngMin: 150.3, lngMax: 151.1 }, // Illawarra
  { from: 2600, to: 2620, latMin: -35.9, latMax: -35.1, lngMin: 148.9, lngMax: 149.5 }, // Canberra / ACT
  { from: 2640, to: 2660, latMin: -36.3, latMax: -35.0, lngMin: 146.3, lngMax: 147.6 }, // Albury / Riverina east
  // --- VIC ---
  { from: 3000, to: 3211, latMin: -38.6, latMax: -37.3, lngMin: 144.2, lngMax: 145.8 }, // Melbourne metro
  { from: 3212, to: 3232, latMin: -38.6, latMax: -37.9, lngMin: 143.9, lngMax: 144.8 }, // Geelong / Surf Coast
  { from: 3350, to: 3364, latMin: -37.9, latMax: -37.2, lngMin: 143.5, lngMax: 144.1 }, // Ballarat
  { from: 3550, to: 3573, latMin: -37.0, latMax: -36.2, lngMin: 144.0, lngMax: 144.8 }, // Bendigo
  { from: 3850, to: 3880, latMin: -38.8, latMax: -37.5, lngMin: 146.5, lngMax: 148.3 }, // Gippsland east
  // --- QLD ---
  { from: 4000, to: 4179, latMin: -28.0, latMax: -26.9, lngMin: 152.6, lngMax: 153.6 }, // Brisbane metro
  { from: 4207, to: 4287, latMin: -28.4, latMax: -27.5, lngMin: 152.8, lngMax: 153.6 }, // Gold Coast + hinterland
  { from: 4300, to: 4347, latMin: -28.1, latMax: -27.3, lngMin: 152.2, lngMax: 153.1 }, // Ipswich corridor
  { from: 4350, to: 4405, latMin: -28.4, latMax: -26.9, lngMin: 151.2, lngMax: 152.3 }, // Toowoomba / Downs east
  { from: 4500, to: 4521, latMin: -27.5, latMax: -26.7, lngMin: 152.6, lngMax: 153.3 }, // Moreton Bay north
  { from: 4550, to: 4581, latMin: -27.0, latMax: -25.7, lngMin: 152.5, lngMax: 153.3 }, // Sunshine Coast / Noosa
  { from: 4670, to: 4671, latMin: -25.1, latMax: -24.6, lngMin: 152.0, lngMax: 152.6 }, // Bundaberg
  { from: 4700, to: 4703, latMin: -23.6, latMax: -23.1, lngMin: 150.2, lngMax: 150.9 }, // Rockhampton
  { from: 4740, to: 4757, latMin: -21.5, latMax: -20.8, lngMin: 148.5, lngMax: 149.4 }, // Mackay
  { from: 4810, to: 4819, latMin: -19.7, latMax: -19.0, lngMin: 146.3, lngMax: 147.1 }, // Townsville
  { from: 4868, to: 4879, latMin: -17.4, latMax: -16.5, lngMin: 145.3, lngMax: 145.9 }, // Cairns
  // --- SA ---
  { from: 5000, to: 5174, latMin: -35.4, latMax: -34.5, lngMin: 138.4, lngMax: 139.1 }, // Adelaide metro
  // --- WA ---
  { from: 6000, to: 6199, latMin: -32.7, latMax: -31.4, lngMin: 115.5, lngMax: 116.4 }, // Perth metro
  { from: 6207, to: 6215, latMin: -33.0, latMax: -32.3, lngMin: 115.5, lngMax: 116.2 }, // Peel / Mandurah
  { from: 6229, to: 6339, latMin: -35.2, latMax: -33.0, lngMin: 114.9, lngMax: 118.3 }, // South West → Great Southern
  { from: 6430, to: 6434, latMin: -31.1, latMax: -30.5, lngMin: 121.2, lngMax: 121.8 }, // Kalgoorlie
  { from: 6530, to: 6532, latMin: -29.0, latMax: -28.5, lngMin: 114.4, lngMax: 114.9 }, // Geraldton
  { from: 6725, to: 6726, latMin: -18.2, latMax: -17.7, lngMin: 122.0, lngMax: 122.5 }, // Broome
  // --- TAS ---
  { from: 7000, to: 7099, latMin: -43.2, latMax: -42.6, lngMin: 147.0, lngMax: 147.7 }, // Hobart
  { from: 7248, to: 7325, latMin: -41.6, latMax: -41.0, lngMin: 146.3, lngMax: 147.5 }, // Launceston / north
  // --- NT ---
  { from: 800, to: 832, latMin: -12.9, latMax: -12.2, lngMin: 130.7, lngMax: 131.2 }, // Darwin / Palmerston
  { from: 870, to: 871, latMin: -24.0, latMax: -23.4, lngMin: 133.6, lngMax: 134.1 }, // Alice Springs
];

export function normaliseAuPostcode(postcode: string | number | null | undefined): number | null {
  if (postcode === null || postcode === undefined) return null;
  const digits = String(postcode).trim().match(/^0?(\d{3,4})$/);
  if (!digits) return null;
  const value = Number(digits[1]);
  return value >= 200 && value <= 9999 ? value : null;
}

export interface PostcodeAssessment {
  ok: boolean;
  /** Set only on failure. */
  reason?: 'wrong_region';
  /** Whether the postcode had a band to check against at all. */
  checked: boolean;
}

export function assessAuPostcodePoint(
  lat: number,
  lng: number,
  postcode: string | number | null | undefined,
): PostcodeAssessment {
  const value = normaliseAuPostcode(postcode);
  if (value === null) return { ok: true, checked: false };
  const band = BANDS.find((b) => value >= b.from && value <= b.to);
  if (!band) return { ok: true, checked: false };
  const ok =
    lat >= band.latMin - PADDING &&
    lat <= band.latMax + PADDING &&
    lng >= band.lngMin - PADDING &&
    lng <= band.lngMax + PADDING;
  return ok ? { ok: true, checked: true } : { ok: false, reason: 'wrong_region', checked: true };
}

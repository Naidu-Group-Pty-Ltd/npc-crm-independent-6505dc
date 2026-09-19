/**
 * A coarse land mask for Australia: can this coordinate be standing on
 * Australian ground at all?
 *
 * The bounding boxes in `auGeoSanity.pure` are rectangles, and every
 * rectangle around Australia necessarily contains sea — Bass Strait, the
 * Great Australian Bight and the Coral Sea are all *inside* the country box.
 * A record that carries no state and no postcode gets only that rectangle
 * check, so a geocoder answering its contaminated address with open water
 * sailed through every gate and put a cluster bubble in the ocean. Rectangles
 * cannot say "sea"; a polygon can.
 *
 * The outline is deliberately coarse and deliberately generous: drawn by hand
 * at ~40 vertices for the mainland, buffered roughly 30–60km *seaward* of the
 * true coast, plus rings for Tasmania and boxes for the inhabited islands
 * (King, Flinders, Groote, the Tiwis — Kangaroo Island falls inside the
 * mainland ring's buffer). The failure mode of a too-tight edge is a coastal
 * listing held off the map, so every edge errs outward; the sea areas this
 * exists to exclude are hundreds of kilometres wide, and a 60km buffer costs
 * none of that. It does not attempt Norfolk, Christmas or Cocos — nothing in
 * this corpus lives there, and absence from the mask fails closed.
 *
 * Pure: no Deno, no DOM. Shared by the browser and the geocoder.
 */

type Ring = ReadonlyArray<readonly [number, number]>; // [lat, lng]

/**
 * Mainland, clockwise from Cape York. Includes the Gulf of Carpentaria dip so
 * the Gulf itself stays sea, and swings wide of Fraser Island, Wilsons Prom,
 * Cape Otway, Cape Leeuwin and the Eyre Peninsula.
 */
const MAINLAND: Ring = [
  [-10.4, 142.6], // Cape York
  [-10.7, 143.9],
  [-14.3, 144.9],
  [-16.2, 146.3],
  [-19.0, 147.7],
  [-20.8, 149.7],
  [-22.4, 151.1],
  [-24.4, 153.2], // off Fraser Island
  [-26.5, 154.0],
  [-29.0, 153.9], // off Byron Bay
  [-32.5, 153.1],
  [-34.2, 151.7], // off Sydney
  [-36.0, 150.7],
  [-37.6, 150.4], // off Gabo Island
  [-38.1, 149.0],
  [-39.5, 146.9], // south of Wilsons Promontory
  [-38.9, 145.0],
  [-39.2, 143.4], // off Cape Otway
  [-38.6, 141.0], // off Portland
  [-38.2, 139.6],
  [-36.6, 137.0], // south of Kangaroo Island
  [-35.5, 135.7], // off the Eyre Peninsula
  [-34.0, 132.8],
  [-33.4, 129.0], // off the Bight coast
  [-34.3, 124.0], // off Esperance
  [-35.6, 118.6], // off Albany
  [-34.9, 114.7], // off Cape Leeuwin
  [-33.5, 114.4], // off Margaret River
  [-31.5, 115.1], // off Perth (west of Rottnest)
  [-29.5, 114.2], // off Geraldton
  [-27.5, 112.9], // off Shark Bay
  [-25.4, 112.5],
  [-23.5, 113.2],
  [-21.8, 113.7], // off the North West Cape (Exmouth)
  [-21.5, 114.5],
  [-20.2, 116.0],
  [-19.4, 118.5],
  [-18.0, 121.4], // off Broome
  [-16.0, 122.3],
  [-13.8, 125.5], // Kimberley
  [-13.2, 128.5],
  [-11.9, 129.9],
  [-10.9, 130.5], // north of the Tiwi Islands
  [-10.9, 131.8],
  [-11.7, 133.0], // Arnhem Land coast
  [-11.3, 136.9], // off the Wessel Islands
  [-12.8, 136.9],
  [-13.6, 136.2], // west side of the Gulf — the Gulf itself stays sea
  [-16.0, 137.8],
  [-17.4, 139.0],
  [-17.4, 140.8],
  [-16.0, 141.2],
  [-13.5, 141.3], // east side of the Gulf, up Cape York's west coast
  [-11.5, 141.8],
];

/** Tasmania, buffered like the mainland — South East Cape sits at −43.64. */
const TASMANIA: Ring = [
  [-40.35, 144.4],
  [-40.35, 148.4],
  [-41.5, 148.7],
  [-43.3, 148.3],
  [-43.95, 146.9],
  [-43.6, 145.5],
  [-42.0, 144.8],
  [-40.9, 144.3],
];

/** Inhabited islands big enough to hold addresses of their own. */
const ISLANDS: Ring[] = [
  [
    // King Island
    [-39.5, 143.6],
    [-39.5, 144.3],
    [-40.2, 144.3],
    [-40.2, 143.6],
  ],
  [
    // Flinders Island
    [-39.5, 147.6],
    [-39.5, 148.5],
    [-40.6, 148.5],
    [-40.6, 147.6],
  ],
  [
    // Groote Eylandt
    [-13.5, 136.2],
    [-13.5, 137.2],
    [-14.5, 137.2],
    [-14.5, 136.2],
  ],
];

const RINGS: Ring[] = [MAINLAND, TASMANIA, ...ISLANDS];

/** Standard ray cast; winding-agnostic, edges count as inside. */
function inRing(lat: number, lng: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [latI, lngI] = ring[i];
    const [latJ, lngJ] = ring[j];
    const crosses = latI > lat !== latJ > lat;
    if (!crosses) continue;
    const atLng = ((latJ === latI ? 0 : (lat - latI) / (latJ - latI)) * (lngJ - lngI)) + lngI;
    if (lng < atLng) inside = !inside;
  }
  return inside;
}

/** True when the coordinate falls on (generously buffered) Australian land. */
export function isOnAustralianLand(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return RINGS.some((ring) => inRing(lat, lng, ring));
}

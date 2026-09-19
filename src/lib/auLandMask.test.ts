import { describe, expect, it } from 'vitest';
import { isOnAustralianLand } from '../../supabase/functions/_shared/auLandMask.pure';

/**
 * The mask is hand-drawn, so the test is the surveyor: every capital, the
 * awkward coastal towns near each vertex, and the island communities must be
 * inside; the open-water regions that have carried phantom cluster bubbles
 * must be outside. A failure here means a vertex is wrong, not a listing.
 */
describe('isOnAustralianLand — land stays land', () => {
  it.each([
    ['Sydney', -33.87, 151.21],
    ['Melbourne', -37.81, 144.96],
    ['Brisbane', -27.47, 153.02],
    ['Perth', -31.95, 115.86],
    ['Adelaide', -34.93, 138.6],
    ['Hobart', -42.88, 147.33],
    ['Darwin', -12.46, 130.84],
    ['Canberra', -35.28, 149.13],
    ['Alice Springs', -23.7, 133.88],
    ['Cairns', -16.92, 145.77],
    ['Byron Bay', -28.64, 153.61],
    ['Fraser Island (K’gari)', -25.3, 153.2],
    ['Wilsons Promontory', -39.03, 146.32],
    ['Cape Otway', -38.85, 143.51],
    ['Portland VIC', -38.35, 141.6],
    ['Kingscote, Kangaroo Island', -35.66, 137.64],
    ['Port Lincoln', -34.72, 135.86],
    ['Ceduna', -32.13, 133.67],
    ['Esperance', -33.86, 121.89],
    ['Albany', -35.02, 117.88],
    ['Margaret River', -33.95, 115.07],
    ['Rottnest Island', -32.0, 115.5],
    ['Geraldton', -28.77, 114.61],
    ['Exmouth', -21.93, 114.13],
    ['Broome', -17.96, 122.24],
    ['Nhulunbuy (Gove)', -12.18, 136.78],
    ['Karumba (Gulf coast)', -17.49, 140.83],
    ['Weipa', -12.63, 141.88],
    ['Cooktown', -15.47, 145.25],
    ['St Helens TAS', -41.32, 148.24],
    ['Strahan TAS', -42.15, 145.33],
    ['South East Cape TAS', -43.64, 146.83],
    ['Currie, King Island', -39.93, 143.85],
    ['Whitemark, Flinders Island', -40.12, 148.02],
    ['Alyangula, Groote Eylandt', -13.85, 136.42],
    ['Eden NSW', -37.06, 149.9],
    ['Mallacoota', -37.56, 149.75],
    ['Lakes Entrance', -37.88, 147.98],
    ['Yeppoon', -23.13, 150.74],
    ['Airlie Beach', -20.27, 148.72],
  ])('%s is on land', (_name, lat, lng) => {
    expect(isOnAustralianLand(lat, lng)).toBe(true);
  });
});

describe('isOnAustralianLand — the sea stays sea', () => {
  it.each([
    // Every one of these regions has hosted a phantom cluster bubble.
    ['middle of Bass Strait', -39.9, 145.8],
    ['eastern Bass Strait', -39.6, 146.4],
    ['Great Australian Bight', -34.5, 130.0],
    ['deep Bight', -36.0, 132.0],
    ['Coral Sea off Queensland', -18.0, 152.0],
    ['Tasman Sea off Sydney', -34.5, 155.0],
    ['Southern Ocean below Tasmania', -46.0, 146.0],
    ['Indian Ocean off Perth', -31.5, 113.5],
    ['Gulf of Carpentaria open water', -14.5, 139.5],
    ['Timor Sea', -11.5, 126.0],
    ['Spencer Gulf mouth, far offshore', -37.5, 136.0],
    ['New Zealand (Auckland)', -36.85, 174.76],
    ['null island', 0, 0],
  ])('%s is not land', (_name, lat, lng) => {
    expect(isOnAustralianLand(lat, lng)).toBe(false);
  });

  it('rejects non-finite input', () => {
    expect(isOnAustralianLand(Number.NaN, 140)).toBe(false);
  });
});

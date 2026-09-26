/**
 * A report made from a builder's brochure carries the brochure's own
 * photographs — and only its own, and only the ones the adviser confirmed.
 *
 * The owner (25 Sep 2026): new-build reports are usually made from a PDF
 * brochure, and the brochure holds images of the property or its design that
 * the report should use. And the owner's standing rule for every report
 * photograph: it is of the report's own address and property, never a picture
 * chosen to fill a slot.
 *
 * So these specs pin, in order: where pdf.js says each picture is drawn; the
 * floors no pixel is needed for; one picture however often a brochure draws
 * it; which pages are about THIS property; what the adviser is offered and the
 * one photograph suggested; the lot-aware form of the address rule that a new
 * build's `Lot 12 Smith Street` needs; the record the server writes before it
 * files a photograph; and the server and broker code that hold all of it.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import {
  BROCHURE_FLOORS,
  brochurePageLabel,
  brochurePlanSelection,
  brochurePropertyIdentity,
  brochureSelection,
  describeBrochureFiling,
  fileBrochurePhotographs,
  FURNITURE_PAGES,
  gatherBrochureCandidates,
  imagePlacements,
  isFurniture,
  isPictureOfPage,
  isRetryableBrochureFailure,
  joinPageText,
  MAX_BROCHURE_OFFER,
  MAX_BROCHURE_PLAN_OFFER,
  offerBrochurePhotographs,
  pageShare,
  passesBrochureFloors,
  pixelKey,
  readBrochurePage,
  type BrochureCandidate,
  type BrochurePhotographRequest,
  type BrochureTransportAnswer,
  type OperatorCodes,
  type PdfTextRun,
  type RasterSighting,
} from '../brochurePhotographs.pure';
import {
  BROCHURE_RECORD_NAME,
  brochurePhotographsAreOfReportAddress,
  brochurePhotographSource,
  capturedFloorPlansForReport,
  FLOOR_PLAN_SUBFOLDER,
  floorPlanFolder,
  floorPlansForReport,
  isDocumentDigest,
  lotDesignation,
  lotsNamedIn,
  MIN_PRINT_LONG_EDGE_PX,
  newBrochureRecord,
  parseBrochureRecord,
  photographsAreOfReportAddress,
  REPORT_FLOOR_PLAN_LIMIT,
  REPORT_PHOTOGRAPH_LIMIT,
  streetLineWithoutLot,
  type StoredListingPhotograph,
} from '../../../../supabase/functions/_shared/reportPhotographs.pure';

/** pdf.js 4.4's own numbers, written out so the walk is tested without pdf.js. */
const OPS: OperatorCodes = {
  save: 10,
  restore: 11,
  transform: 12,
  beginMarkedContent: 69,
  beginMarkedContentProps: 70,
  endMarkedContent: 71,
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
  beginGroup: 76,
  endGroup: 77,
  beginAnnotation: 80,
  endAnnotation: 81,
  paintImageXObject: 85,
};

const list = (...entries: Array<[number, unknown[]]>) => ({
  fnArray: entries.map(([fn]) => fn),
  argsArray: entries.map(([, args]) => args),
});

const A4 = [0, 0, 595, 842];
const DIGEST = 'a'.repeat(64);

describe('where the page draws each picture, read off pdf.js\'s operator list', () => {
  it('follows the matrix through save, restore and transform', () => {
    const placements = imagePlacements(list(
      [OPS.save, []],
      [OPS.transform, [1, 0, 0, 1, 40, 400]],
      [OPS.transform, [515, 0, 0, 331, 0, 0]],
      [OPS.paintImageXObject, ['img_p0_1', 1400, 900]],
      [OPS.restore, []],
      [OPS.paintImageXObject, ['img_p0_2', 200, 80]],
    ), OPS);
    expect(placements).toEqual([
      { objId: 'img_p0_1', width: 1400, height: 900, drawn: { x: 40, y: 400, width: 515, height: 331 } },
      { objId: 'img_p0_2', width: 200, height: 80, drawn: { x: 0, y: 0, width: 1, height: 1 } },
    ]);
  });

  it('applies a form\'s own matrix inside it, and not after it', () => {
    const [inside, after] = imagePlacements(list(
      [OPS.transform, [2, 0, 0, 2, 10, 10]],
      [OPS.paintFormXObjectBegin, [[1, 0, 0, 1, 5, 5], [0, 0, 100, 100]]],
      [OPS.transform, [100, 0, 0, 50, 0, 0]],
      [OPS.paintImageXObject, ['img_a', 2000, 1000]],
      [OPS.paintFormXObjectEnd, []],
      [OPS.paintImageXObject, ['img_b', 2000, 1000]],
    ), OPS);
    expect(inside.drawn).toEqual({ x: 20, y: 20, width: 200, height: 100 });
    expect(after.drawn).toEqual({ x: 10, y: 10, width: 2, height: 2 });
  });

  it('draws a transparency group under the matrix already in force, as pdf.js does', () => {
    const [drawn] = imagePlacements(list(
      [OPS.transform, [1, 0, 0, 1, 30, 40]],
      [OPS.beginGroup, [{ matrix: [9, 0, 0, 9, 0, 0], bbox: [0, 0, 1, 1] }]],
      [OPS.transform, [300, 0, 0, 200, 0, 0]],
      [OPS.paintImageXObject, ['img_g', 1500, 1000]],
      [OPS.endGroup, []],
    ), OPS);
    expect(drawn.drawn).toEqual({ x: 30, y: 40, width: 300, height: 200 });
  });

  it('places a widget\'s appearance by its own transform, whatever came before it', () => {
    const [inside, after] = imagePlacements(list(
      [OPS.transform, [3, 0, 0, 3, 0, 0]],
      [OPS.beginAnnotation, ['a1', [50, 60, 350, 260], [1, 0, 0, 1, 50, 60], [1, 0, 0, 1, 0, 0], false]],
      [OPS.save, []],
      [OPS.transform, [300, 0, 0, 200, 0, 0]],
      [OPS.paintImageXObject, ['img_w', 2000, 1250]],
      [OPS.endAnnotation, []],
      [OPS.paintImageXObject, ['img_x', 1200, 900]],
    ), OPS);
    expect(inside.drawn).toEqual({ x: 50, y: 60, width: 300, height: 200 });
    expect(after.drawn).toEqual({ x: 0, y: 0, width: 3, height: 3 });
  });

  it('draws nothing in a hidden layer, and a layer it cannot judge counts as shown', () => {
    const hidden = imagePlacements(list(
      [OPS.beginMarkedContentProps, ['OC', { id: 'hidden' }]],
      [OPS.paintFormXObjectBegin, [[1, 0, 0, 1, 0, 0], null]],
      [OPS.paintImageXObject, ['img_h', 1400, 900]],
      [OPS.paintFormXObjectEnd, []],
      [OPS.endMarkedContent, []],
      [OPS.beginMarkedContent, ['Artifact']],
      [OPS.paintImageXObject, ['img_v', 1400, 900]],
      [OPS.endMarkedContent, []],
    ), OPS, (properties) => (properties as { id?: string }).id !== 'hidden');
    expect(hidden.map((p) => p.objId)).toEqual(['img_v']);

    const unjudged = imagePlacements(list(
      [OPS.beginMarkedContentProps, ['OC', { id: 'x' }]],
      [OPS.paintImageXObject, ['img_u', 1400, 900]],
      [OPS.endMarkedContent, []],
    ), OPS, () => { throw new Error('no config'); });
    expect(unjudged.map((p) => p.objId)).toEqual(['img_u']);
  });

  it('refuses a drawing with no image id or no size, rather than guessing one', () => {
    expect(imagePlacements(list(
      [OPS.paintImageXObject, ['', 1400, 900]],
      [OPS.paintImageXObject, ['img_1', 0, 900]],
      [OPS.paintImageXObject, [null, 1400, 900]],
    ), OPS)).toEqual([]);
  });

  it('counts only the part of a picture that lies on the page', () => {
    expect(pageShare({ x: 0, y: 0, width: 595, height: 421 }, A4)).toBeCloseTo(0.5, 3);
    // A full-bleed picture set past the trim is the whole page, not more.
    expect(pageShare({ x: -20, y: -20, width: 700, height: 900 }, A4)).toBeCloseTo(1, 6);
    expect(pageShare({ x: 700, y: 0, width: 100, height: 100 }, A4)).toBe(0);
    // A page box that does not start at the origin.
    expect(pageShare({ x: 100, y: 100, width: 50, height: 50 }, [100, 100, 200, 200])).toBeCloseTo(0.25, 6);
  });
});

describe('what can be a report photograph, before a pixel is read', () => {
  it('passes a photograph-sized picture drawn large enough on its page', () => {
    expect(passesBrochureFloors({ width: 1400, height: 900, pageShare: 0.2 })).toBe(true);
  });

  it('refuses a logo, a banner, and anything the server would refuse as too small to print', () => {
    expect(passesBrochureFloors({ width: 1400, height: 900, pageShare: BROCHURE_FLOORS.minPageShare - 0.001 })).toBe(false);
    expect(passesBrochureFloors({ width: 4400, height: 1000, pageShare: 0.3 })).toBe(false);
    expect(passesBrochureFloors({ width: 1000, height: 3400, pageShare: 0.3 })).toBe(false);
    expect(passesBrochureFloors({ width: MIN_PRINT_LONG_EDGE_PX - 1, height: 700, pageShare: 0.5 })).toBe(false);
    expect(passesBrochureFloors({ width: MIN_PRINT_LONG_EDGE_PX, height: 700, pageShare: 0.5 })).toBe(true);
  });

  it('refuses a raster that IS the page, but not a full-bleed photograph with the brochure\'s type set over it', () => {
    expect(isPictureOfPage({ pageShare: 0.98, pageTextLength: 0 })).toBe(true);
    expect(isPictureOfPage({ pageShare: 0.98, pageTextLength: 240 })).toBe(false);
    expect(isPictureOfPage({ pageShare: 0.5, pageTextLength: 0 })).toBe(false);
  });

  it('knows one picture by its pixels, whatever pdf.js calls it on each page', () => {
    const square = new Uint8Array(64 * 64 * 4).map((_, index) => (index * 7) % 251);
    const same = new Uint8Array(square);
    const other = new Uint8Array(square);
    other[1000] ^= 1;
    expect(pixelKey(square, 1400, 900)).toBe(pixelKey(same, 1400, 900));
    expect(pixelKey(square, 1400, 900)).not.toBe(pixelKey(other, 1400, 900));
    expect(pixelKey(square, 1400, 900)).not.toBe(pixelKey(square, 1400, 901));
  });
});

const sighting = (overrides: Partial<RasterSighting>): RasterSighting => ({
  page: 1,
  key: 'k',
  width: 1400,
  height: 900,
  pageShare: 0.3,
  kind: 'photo',
  signature: '0123456789abcdef',
  ...overrides,
});

describe('one picture, however many times the brochure draws it', () => {
  it('gathers every drawing of a picture into one candidate, pages in order, largest share a page', () => {
    const [candidate] = gatherBrochureCandidates([
      sighting({ page: 3, pageShare: 0.1 }),
      sighting({ page: 1, pageShare: 0.4 }),
      sighting({ page: 3, pageShare: 0.05, key: 'k' }),
    ]);
    expect(candidate.pages).toEqual([1, 3]);
    expect(candidate.shareByPage).toEqual({ 1: 0.4, 3: 0.1 });
    // Drawn twice on page 3: a tile, a pattern, a repeated rule.
    expect(candidate.tiled).toBe(true);
  });

  it('calls a picture furniture when it is tiled, or drawn on three pages or more', () => {
    const twice = gatherBrochureCandidates([sighting({ page: 1 }), sighting({ page: 2 })])[0];
    const thrice = gatherBrochureCandidates([1, 2, 3].map((page) => sighting({ page })))[0];
    expect(FURNITURE_PAGES).toBe(3);
    expect(isFurniture(twice)).toBe(false);
    expect(isFurniture(thrice)).toBe(true);
  });
});

describe('a new build is named by its lot, and a lot is read only where it stands as one', () => {
  it('reads the lot a new build\'s address names', () => {
    expect(lotDesignation('Lot 12 Smith Street, Box Hill NSW 2765')).toBe('12');
    expect(lotDesignation('LOT 1234A Hunza Road')).toBe('1234a');
    expect(lotDesignation('Lot No. 7, Stage 3')).toBe('7');
    expect(lotDesignation('Proposed Lot 012 Smith St')).toBe('12');
    expect(lotDesignation('34 Smith Street (Lot 12)')).toBe('12');
  });

  it('names no lot in a word that merely contains one, or in a land size', () => {
    expect(lotDesignation('12 Allotment Road')).toBeNull();
    expect(lotDesignation('5 Plot Street')).toBeNull();
    expect(lotDesignation('12 Lots Road')).toBeNull();
    expect(lotDesignation('Lot 450m2 of land')).toBeNull();
    expect(lotDesignation('Lot size: 450m²')).toBeNull();
    expect(lotDesignation(undefined)).toBeNull();
  });

  it('lists every lot a page names, once each', () => {
    expect(lotsNamedIn('Lot 12 $650k · Lot 13 $660k · lot 12 sold')).toEqual(['12', '13']);
    expect(lotsNamedIn('Inclusions')).toEqual([]);
  });

  it('reads the street line under the lot the way any other street line is read', () => {
    expect(streetLineWithoutLot('Lot 12 Smith Street')).toBe('Smith Street');
    expect(streetLineWithoutLot('Lot 12, 34 Smith Street')).toBe('34 Smith Street');
    expect(streetLineWithoutLot('Lot 12/34 Smith Street')).toBe('34 Smith Street');
    expect(streetLineWithoutLot('Lot 12 (No. 34) Smith Street')).toBe('34) Smith Street');
    expect(streetLineWithoutLot('34 Smith Street')).toBe('34 Smith Street');
  });
});

describe('rule 4, for the addresses a new build actually has', () => {
  const source = { address: 'Lot 12 Smith Street', suburb: 'Box Hill' };

  it('matches the same lot on the same street in the same suburb, however it is written', () => {
    expect(brochurePhotographsAreOfReportAddress('Lot 12 Smith Street, Box Hill NSW 2765', source)).toBe(true);
    expect(brochurePhotographsAreOfReportAddress('LOT 12 SMITH ST, BOX HILL NSW', source)).toBe(true);
    expect(brochurePhotographsAreOfReportAddress('Lot 12, 34 Smith Street, Box Hill NSW 2765', source)).toBe(true);
  });

  it('refuses another lot, another street, another suburb', () => {
    expect(brochurePhotographsAreOfReportAddress('Lot 13 Smith Street, Box Hill NSW 2765', source)).toBe(false);
    expect(brochurePhotographsAreOfReportAddress('Lot 12 Jones Street, Box Hill NSW 2765', source)).toBe(false);
    expect(brochurePhotographsAreOfReportAddress('Lot 12 Smith Street, Riverstone NSW 2765', source)).toBe(false);
  });

  it('refuses where the two sides disagree on anything either states', () => {
    const withNumber = { address: 'Lot 12, 34 Smith Street', suburb: 'Box Hill' };
    expect(brochurePhotographsAreOfReportAddress('Lot 12, 36 Smith Street, Box Hill NSW', withNumber)).toBe(false);
    // A lot is never a street number: `12 Smith Street` is somebody else's house.
    expect(brochurePhotographsAreOfReportAddress('12 Smith Street, Box Hill NSW 2765', source)).toBe(false);
  });

  it('never matches a lot alone, a suburb alone, or a placeholder named after the file', () => {
    expect(brochurePhotographsAreOfReportAddress('Lot 12, Box Hill NSW 2765', source)).toBe(false);
    expect(brochurePhotographsAreOfReportAddress('Lot 12, Box Hill NSW 2765', { address: 'Lot 12', suburb: 'Box Hill' })).toBe(false);
    expect(brochurePhotographsAreOfReportAddress('Box Hill, NSW 2765', source)).toBe(false);
    expect(brochurePhotographsAreOfReportAddress('Property from brochure.pdf', source)).toBe(false);
    expect(brochurePhotographsAreOfReportAddress('Lot 12 Smith Street, Box Hill', { address: 'Lot 12 Smith Street', suburb: '' })).toBe(false);
    expect(brochurePhotographsAreOfReportAddress('', source)).toBe(false);
  });

  it('decides an established home\'s address exactly as the listing rule does', () => {
    const house = { address: '34 Smith St', suburb: 'Box Hill' };
    for (const report of ['34 Smith Street, Box Hill NSW 2765', '36 Smith Street, Box Hill NSW', '5/34 Smith Street, Box Hill']) {
      expect(brochurePhotographsAreOfReportAddress(report, house)).toBe(photographsAreOfReportAddress(report, house));
    }
    expect(brochurePhotographsAreOfReportAddress('34 Smith Street, Box Hill NSW 2765', house)).toBe(true);
  });

  it('takes the brochure\'s address only where it names a street line and a suburb', () => {
    expect(brochurePhotographSource({ address: ' Lot 12 Smith Street ', suburb: 'Box Hill' }))
      .toEqual({ address: 'Lot 12 Smith Street', suburb: 'Box Hill' });
    expect(brochurePhotographSource({ address: 'Lot 12 Smith Street', suburb: null })).toBeNull();
    expect(brochurePhotographSource({ address: null, suburb: 'Box Hill' })).toBeNull();
    expect(brochurePhotographSource(null)).toBeNull();
  });
});

/** A pdf.js text run: `x, y` where it starts, `size` its type, `width` its advance. */
const run = (str: string, x: number, y: number, width: number, size = 22, extra: Partial<PdfTextRun> = {}): PdfTextRun => ({
  str, transform: [size, 0, 0, size, x, y], width, height: str.trim() ? size : 0, hasEOL: false, ...extra,
});

describe('a page\'s words are read the way the page prints them', () => {
  it('reads the owner\'s brochure\'s address line as one line, not as letters', () => {
    // pdf.js's own runs for page 1 of the owner's example brochure, positions as it reported them.
    const runs = [
      run('Alarm System', 443.5, 111.9, 58.6, 10.6),
      run('', 27.7, 750.3, 0, 22, { hasEOL: true }),
      run('L', 27.7, 750.3, 10.5),
      run('ot', 38.2, 750.3, 18),
      run(' ', 56.2, 750.3, 4.3),
      run('1', 60.5, 750.3, 10.5),
      run('629', 71.1, 750.3, 31.6),
      run(' ', 102.7, 750.3, 5),
      run('Hornsea Street', 107.7, 750.3, 130.8, 22, { hasEOL: true }),
      run('Palomino Estate,', 27.7, 719.6, 150),
    ];
    const text = joinPageText(runs);
    expect(text).toBe('Alarm System Lot 1629 Hornsea Street Palomino Estate,');
    expect(lotsNamedIn(text)).toEqual(['1629']);
    // What joining every run with a space made of the same line.
    expect(lotsNamedIn(runs.map((r) => r.str).join(' '))).toEqual([]);
  });

  it('separates runs on different lines, or set clear of each other, even where pdf.js marks no line end', () => {
    expect(joinPageText([run('Internal Colour Legend', 56.7, 769, 318.1, 30), run('Colour legends are', 56.7, 64.7, 90, 6)]))
      .toBe('Internal Colour Legend Colour legends are');
    expect(joinPageText([run('$492,750', 210, 500, 40, 10), run('$395,800', 290, 500, 40, 10)])).toBe('$492,750 $395,800');
  });

  it('separates a run it cannot place, or one set at an angle, as it always did', () => {
    expect(joinPageText([{ str: 'Lot' }, { str: '12' }])).toBe('Lot 12');
    const rotated: PdfTextRun = { str: '12', transform: [0, 22, -22, 0, 60, 750], width: 20, height: 22 };
    expect(joinPageText([run('Lot', 27, 750, 33), rotated])).toBe('Lot 12');
    expect(joinPageText([])).toBe('');
  });
});

describe('which pages of the brochure are about this property', () => {
  const lot = brochurePropertyIdentity('Lot 12 Smith Street');
  const house = brochurePropertyIdentity('34 Smith St');

  it('reads the identifiers a street line carries', () => {
    expect(lot).toEqual({ lot: '12', number: null, street: ['smith', 'street'] });
    expect(house).toEqual({ lot: null, number: '34', street: ['smith', 'street'] });
    expect(brochurePropertyIdentity('Lot 12, 34 Smith Street')).toEqual({ lot: '12', number: '34', street: ['smith', 'street'] });
    expect(brochurePropertyIdentity(null)).toEqual({ lot: null, number: null, street: [] });
  });

  it('tells this property\'s page from a price list, another package and an inclusions page', () => {
    expect(readBrochurePage('Lot 12 Smith Street, Box Hill — The Aspen 25 — $749,900', lot)).toBe('this');
    expect(readBrochurePage('Lot 12 $749,900 · Lot 13 $761,000 · Lot 14 SOLD', lot)).toBe('mixed');
    expect(readBrochurePage('Lot 15 Jones Street — The Birch 28', lot)).toBe('other');
    expect(readBrochurePage('Standard inclusions: stone benchtops, ducted heating', lot)).toBe('unnamed');
    expect(readBrochurePage('', lot)).toBe('unnamed');
  });

  it('finds an established home by its number and street, however the street type is written', () => {
    expect(readBrochurePage('For sale — 34 SMITH ST., BOX HILL', house)).toBe('this');
    expect(readBrochurePage('34 Smith Street', house)).toBe('this');
    expect(readBrochurePage('134 Smith Street', house)).toBe('unnamed');
    expect(readBrochurePage('Smith Street, 34 minutes to the CBD', house)).toBe('unnamed');
  });

  it('reads a legal description as the same property, never as another one', () => {
    // An established home's brochure can carry `Lot 5 DP 12345`; with no lot of
    // its own to compare, a lot it names is not "another property".
    expect(readBrochurePage('34 Smith Street · Lot 5 DP 12345', house)).toBe('this');
    expect(readBrochurePage('Title: Lot 5 DP 12345', house)).toBe('unnamed');
  });
});

const candidate = (overrides: Partial<BrochureCandidate> & { key: string }): BrochureCandidate => ({
  width: 1400,
  height: 900,
  kind: 'photo',
  signature: '0123456789abcdef',
  pages: [1],
  shareByPage: { 1: 0.3 },
  tiled: false,
  ...overrides,
});

describe('the adviser is offered the brochure\'s photographs, and one is suggested', () => {
  it('suggests the largest photograph on a page naming the property, and offers the rest after it', () => {
    const offer = offerBrochurePhotographs([
      candidate({ key: 'interior', pages: [2], shareByPage: { 2: 0.45 } }),
      candidate({ key: 'facade', pages: [1], shareByPage: { 1: 0.5 } }),
      candidate({ key: 'plan', kind: 'floorplan', pages: [2], shareByPage: { 2: 0.9 } }),
    ], ['this', 'this']);
    expect(offer.lead).toBe('facade');
    expect(offer.offered.map((c) => c.key)).toEqual(['facade', 'interior']);
    // A plan is offered, but apart from the photographs: it is never a cover.
    expect(offer.plans.map((c) => c.key)).toEqual(['plan']);
    expect(offer.leftOut).toEqual({ notPhotographs: 0, furniture: 0, otherProperties: 0, unnamedPages: 0, overLimit: 0 });
    expect(offer.multiProperty).toBe(false);
    expect(offer.namesProperty).toBe(true);
  });

  it('offers nothing from a page that names no property: the owner\'s brochure, page by page', () => {
    // Lot 1629 Hornsea Street, Armstrong Creek: page 1 names the lot beside the
    // design's facade render; page 5 is a couple walking through another estate;
    // page 6 is four homes the builder built somewhere else.
    const offer = offerBrochurePhotographs([
      candidate({ key: 'facade-render', width: 1280, height: 720, pages: [1], shareByPage: { 1: 0.12 } }),
      candidate({ key: 'couple-walking', width: 2880, height: 1920, pages: [5], shareByPage: { 5: 0.4 } }),
      ...['ceilings', 'downlights', 'facades', 'driveway'].map((key, index) =>
        candidate({ key, width: 1096, height: 1128, pages: [6], shareByPage: { 6: 0.13 + index / 1000 } })),
    ], ['this', 'unnamed', 'unnamed', 'unnamed', 'unnamed', 'unnamed', 'unnamed', 'unnamed', 'unnamed']);
    expect(offer.offered.map((c) => c.key)).toEqual(['facade-render']);
    expect(offer.lead).toBe('facade-render');
    expect(offer.leftOut.unnamedPages).toBe(5);
  });

  it('judges the lead by its size on a page naming the property, not on any page', () => {
    const offer = offerBrochurePhotographs([
      candidate({ key: 'lifestyle', pages: [1, 2], shareByPage: { 1: 0.1, 2: 0.9 } }),
      candidate({ key: 'facade', pages: [1], shareByPage: { 1: 0.3 } }),
    ], ['this', 'unnamed']);
    expect(offer.lead).toBe('facade');
  });

  it('in a brochure for several lots, offers only what is drawn on a page naming this one', () => {
    const offer = offerBrochurePhotographs([
      candidate({ key: 'ours', pages: [1], shareByPage: { 1: 0.4 } }),
      candidate({ key: 'theirs', pages: [2], shareByPage: { 2: 0.6 } }),
      candidate({ key: 'estate', pages: [3], shareByPage: { 3: 0.7 } }),
      candidate({ key: 'masterplan-page', pages: [4], shareByPage: { 4: 0.5 } }),
    ], ['this', 'other', 'unnamed', 'mixed']);
    expect(offer.multiProperty).toBe(true);
    expect(offer.offered.map((c) => c.key)).toEqual(['ours']);
    expect(offer.leftOut).toMatchObject({ otherProperties: 2, unnamedPages: 1 });
    expect(offer.lead).toBe('ours');
  });

  it('offers a picture drawn on this property\'s page wherever else the brochure repeats it', () => {
    const offer = offerBrochurePhotographs([
      candidate({ key: 'facade', pages: [1, 4], shareByPage: { 1: 0.3, 4: 0.6 } }),
    ], ['this', 'unnamed', 'unnamed', 'unnamed']);
    expect(offer.offered.map((c) => c.key)).toEqual(['facade']);
  });

  it('offers nothing, and suggests nothing, where no page names the property', () => {
    const offer = offerBrochurePhotographs([
      candidate({ key: 'a', pages: [2], shareByPage: { 2: 0.4 } }),
      candidate({ key: 'b', pages: [1], shareByPage: { 1: 0.2 } }),
    ], ['unnamed', 'unnamed']);
    expect(offer.offered).toEqual([]);
    expect(offer.lead).toBeNull();
    expect(offer.namesProperty).toBe(false);
    expect(offer.leftOut.unnamedPages).toBe(2);
  });

  it('never offers furniture or anything that is not a photograph', () => {
    const offer = offerBrochurePhotographs([
      candidate({ key: 'wash', pages: [1, 2, 3], shareByPage: { 1: 0.9, 2: 0.9, 3: 0.9 } }),
      candidate({ key: 'tile', tiled: true }),
      candidate({ key: 'logo', kind: 'graphic' }),
      candidate({ key: 'unknown', kind: 'unknown' }),
    ], ['this', 'this', 'this']);
    expect(offer.offered).toEqual([]);
    expect(offer.lead).toBeNull();
    expect(offer.leftOut).toEqual({ notPhotographs: 2, furniture: 2, otherProperties: 0, unnamedPages: 0, overLimit: 0 });
  });

  it('offers a bounded number, and says how many it left out', () => {
    const many = Array.from({ length: MAX_BROCHURE_OFFER + 3 }, (_, index) =>
      candidate({ key: `p${index}`, pages: [index + 1], shareByPage: { [index + 1]: 0.3 } }));
    const offer = offerBrochurePhotographs(many, many.map(() => 'this'));
    expect(offer.offered).toHaveLength(MAX_BROCHURE_OFFER);
    expect(offer.leftOut.overLimit).toBe(3);
  });

  it('files the ticked photographs in the order offered, the first as the cover, no more than a report carries', () => {
    const offered = Array.from({ length: 9 }, (_, index) => candidate({ key: `p${index}` }));
    const ticked = new Set(['p8', 'p2', 'p0', 'p3', 'p4', 'p5', 'p6', 'p7']);
    const selection = brochureSelection(offered, ticked);
    expect(selection).toHaveLength(REPORT_PHOTOGRAPH_LIMIT);
    expect(selection.map((s) => s.key)).toEqual(['p0', 'p2', 'p3', 'p4', 'p5', 'p6']);
    expect(selection.map((s) => s.place)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(brochureSelection(offered, new Set())).toEqual([]);
  });

  it('says where a picture is in words a person uses', () => {
    expect(brochurePageLabel({ pages: [3] })).toBe('Page 3');
    expect(brochurePageLabel({ pages: [1, 4] })).toBe('Pages 1 and 4');
    expect(brochurePageLabel({ pages: [1, 2, 5] })).toBe('Pages 1, 2 and 5');
  });
});

describe('a floor plan is offered, filed and served apart from the photographs, and never cropped into a photo slot', () => {
  const plan = (key: string, page: number, share = 0.28) =>
    candidate({ key, kind: 'floorplan', width: 1199, height: 751, pages: [page], shareByPage: { [page]: share } });

  it('offers the plans on this property\'s pages, in the brochure\'s order, and none from anywhere else', () => {
    const offer = offerBrochurePhotographs([
      plan('ground', 1),
      plan('upper', 2, 0.4),
      plan('estate-masterplan', 3),
      plan('neighbour', 4),
      candidate({ key: 'facade', pages: [1], shareByPage: { 1: 0.13 } }),
    ], ['this', 'this', 'unnamed', 'other']);
    expect(offer.plans.map((c) => c.key)).toEqual(['ground', 'upper']);
    expect(offer.offered.map((c) => c.key)).toEqual(['facade']);
    // A plan is never the suggested cover, however large it is drawn.
    expect(offer.lead).toBe('facade');
    expect(offer.leftOut).toMatchObject({ unnamedPages: 1, otherProperties: 1 });
  });

  it('never offers a plan drawn on every page, and offers a bounded number', () => {
    const repeated = candidate({ key: 'banner-plan', kind: 'floorplan', pages: [1, 2, 3], shareByPage: { 1: 0.2, 2: 0.2, 3: 0.2 } });
    const many = Array.from({ length: MAX_BROCHURE_PLAN_OFFER + 2 }, (_, index) => plan(`p${index}`, 1, 0.1 + index / 100));
    const offer = offerBrochurePhotographs([repeated, ...many], ['this', 'this', 'this']);
    expect(offer.plans.map((c) => c.key)).not.toContain('banner-plan');
    expect(offer.plans).toHaveLength(MAX_BROCHURE_PLAN_OFFER);
    expect(offer.leftOut.overLimit).toBe(2);
  });

  it('files no more plans than a report carries, in the order offered', () => {
    const offered = [plan('a', 1), plan('b', 2), plan('c', 3)];
    expect(REPORT_FLOOR_PLAN_LIMIT).toBe(2);
    expect(brochurePlanSelection(offered, new Set(['c', 'a', 'b']))).toEqual([{ key: 'a', place: 0 }, { key: 'b', place: 1 }]);
  });

  it('sends the photographs first, cover first, then the plans, and counts the plans apart', async () => {
    const order: string[] = [];
    const planRequest = (place: number): BrochurePhotographRequest => ({ ...request(place), kind: 'floorplan' });
    const outcome = await fileBrochurePhotographs(
      async (req) => { order.push(`${req.kind ?? 'photo'}:${req.place}`); return { data: { success: true }, error: null }; },
      [planRequest(1), request(1), planRequest(0), request(0)],
      { delaysMs: [1, 1], sleep: async () => {} },
    );
    expect(order).toEqual(['photo:0', 'photo:1', 'floorplan:0', 'floorplan:1']);
    expect(outcome).toEqual({ filed: 2, filedPlans: 2, refused: {}, failed: 0 });
    // A photograph's request is exactly what it always was: no `kind`.
    expect('kind' in request(0)).toBe(false);
  });

  it('tells the adviser the plan went in, and reads as it always did where no plan was sent', () => {
    expect(describeBrochureFiling({ filed: 1, refused: {}, failed: 0 })?.title).toBe('Brochure photographs added');
    expect(describeBrochureFiling({ filed: 1, filedPlans: 1, refused: {}, failed: 0 })).toEqual({
      title: 'Brochure photographs and floor plan added',
      description: '1 photograph and the floor plan from the brochure will appear in the report.',
    });
    expect(describeBrochureFiling({ filed: 0, filedPlans: 1, refused: {}, failed: 0 })).toEqual({
      title: 'Brochure floor plan added',
      description: 'The floor plan from the brochure will appear in the report.',
    });
    expect(describeBrochureFiling({ filed: 0, filedPlans: 0, refused: { photo: 1 }, failed: 0 })).toEqual({
      title: 'Brochure pictures not added',
      description: 'None of the 1 picture could be used (it is not a floor plan). The report is made without them.',
    });
  });

  it('keeps a report\'s plans in their own subfolder, named and floored as its photographs are', () => {
    const report = '11111111-2222-4333-8444-555555555555';
    expect(FLOOR_PLAN_SUBFOLDER).toBe('plans');
    expect(floorPlanFolder(report)).toBe(`report-photographs/${report}/plans`);
    expect(floorPlanFolder('not-a-report')).toBeNull();
    const plans = capturedFloorPlansForReport([
      { name: '00-1199x751-0123456789abcdef-0123456789abcdef.png' },
      { name: '01-800x500-1123456789abcdef-1123456789abcdef.png' },
      { name: '01-2400x1600-2123456789abcdef-2123456789abcdef.png' },
      { name: '02-2400x1600-3123456789abcdef-3123456789abcdef.png' },
      { name: 'plans' },
    ]);
    // Place 1's second copy is below the print floor and does not print; the
    // third plan is one more than a report carries.
    expect(plans.map((p) => p.place)).toEqual([0, 1]);
    expect(plans.every((p) => Math.max(p.width, p.height) >= MIN_PRINT_LONG_EDGE_PX)).toBe(true);
  });

  it('takes a listing\'s plans only where the server read a plan, no other listing holds it, and it prints', () => {
    const row = (overrides: Partial<StoredListingPhotograph>): StoredListingPhotograph => ({
      listing_id: 'rec1',
      image_identity: overrides.image_identity ?? 'id',
      storage_path: `listings/rec1/${overrides.image_identity ?? 'id'}.png`,
      position: 0,
      status: 'stored',
      width: 1600,
      height: 1000,
      bytes: 200_000,
      checksum: overrides.image_identity ?? 'id',
      source_url: `https://img.example/${overrides.image_identity ?? 'id'}.png`,
      visual_kind: 'floorplan',
      visual_signature: null,
      ...overrides,
    });
    const rows = [
      row({ image_identity: 'photo', visual_kind: 'photo', position: 0 }),
      row({ image_identity: 'plan-b', position: 5 }),
      row({ image_identity: 'plan-a', position: 4 }),
      row({ image_identity: 'stock-plan', position: 6 }),
      row({ image_identity: 'thumb-plan', position: 7, width: 600, height: 400 }),
      row({ image_identity: 'unread', position: 8, visual_kind: null }),
    ];
    const reuse = new Map([['rec1:stock-plan', 3]]);
    expect(floorPlansForReport(rows, reuse).map((p) => p.storagePath)).toEqual([
      'listings/rec1/plan-a.png',
      'listings/rec1/plan-b.png',
    ]);
    // A reuse reading that could not be taken takes nothing, as for photographs.
    expect(floorPlansForReport(rows, null)).toEqual([]);
  });
});

const request = (place: number): BrochurePhotographRequest => ({
  op: 'capture_brochure_photograph',
  reportId: '00000000-0000-4000-8000-000000000001',
  documentSha256: DIGEST,
  source: { address: 'Lot 12 Smith Street', suburb: 'Box Hill' },
  place,
  image: 'AAAA',
});

describe('the chosen photographs are filed one at a time, the cover first, and filing never throws', () => {
  const noSleep = { delaysMs: [1, 1], sleep: async () => {} };

  it('files in place order whatever order it is handed, one request each', async () => {
    const seen: number[] = [];
    const outcome = await fileBrochurePhotographs(async (r) => { seen.push(r.place); return { error: null }; },
      [request(2), request(0), request(1)], noSleep);
    expect(seen).toEqual([0, 1, 2]);
    expect(outcome).toEqual({ filed: 3, refused: {}, failed: 0 });
  });

  it('tries again what a second try can cure, and never repeats a refusal', async () => {
    const answers: BrochureTransportAnswer[] = [
      { error: { status: 503 } },
      { error: null },
      { data: { reason: 'floorplan' }, error: { status: 422 } },
    ];
    const invoke = vi.fn(async () => answers.shift() ?? { error: null });
    const outcome = await fileBrochurePhotographs(invoke, [request(0), request(1)], noSleep);
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(outcome).toEqual({ filed: 1, refused: { floorplan: 1 }, failed: 0 });
  });

  it('gives up after the last delay, counts it as not sent, and survives a transport that throws', async () => {
    const invoke = vi.fn(async () => { throw new Error('offline'); });
    const outcome = await fileBrochurePhotographs(invoke, [request(0)], noSleep);
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(outcome).toEqual({ filed: 0, refused: {}, failed: 1 });
    expect(isRetryableBrochureFailure({ status: 429 })).toBe(true);
    expect(isRetryableBrochureFailure({ status: 409 })).toBe(false);
    expect(isRetryableBrochureFailure(null)).toBe(false);
  });

  it('tells the adviser what happened, in their words, once per reason', () => {
    expect(describeBrochureFiling({ filed: 0, refused: {}, failed: 0 })).toBeNull();
    expect(describeBrochureFiling({ filed: 2, refused: {}, failed: 0 })).toEqual({
      title: 'Brochure photographs added',
      description: '2 photographs from the brochure will appear in the report.',
    });
    const some = describeBrochureFiling({ filed: 1, refused: { floorplan: 2 }, failed: 0 });
    expect(some?.title).toBe('Some brochure photographs added');
    expect(some?.description).toBe('1 photograph will appear in the report; 2 photographs could not be used (it is a floor plan).');
    const none = describeBrochureFiling({ filed: 0, refused: { address_mismatch: 1 }, failed: 1 });
    expect(none?.title).toBe('Brochure photographs not added');
    expect(none?.description).toContain("the brochure's address is not the report's; the request did not go through");
    // No database or server vocabulary reaches the adviser.
    for (const message of [some, none]) expect(message?.description).not.toMatch(/[a-z]+_[a-z]+/);
  });
});

describe('the server writes down which brochure, whose address and who, before it files a photograph', () => {
  it('round-trips through its own JSON, lowercasing the digest', () => {
    const record = newBrochureRecord({
      documentSha256: DIGEST.toUpperCase(),
      source: { address: ' Lot 12 Smith Street ', suburb: 'Box Hill ' },
      requestedBy: 'user-1',
      now: Date.parse('2026-09-25T10:00:00Z'),
    });
    expect(record).toEqual({
      version: 1,
      documentSha256: DIGEST,
      source: { address: 'Lot 12 Smith Street', suburb: 'Box Hill' },
      requestedBy: 'user-1',
      requestedAt: '2026-09-25T10:00:00.000Z',
    });
    expect(parseBrochureRecord(JSON.parse(JSON.stringify(record)))).toEqual(record);
  });

  it('refuses anything that cannot say which brochure, whose address, who or when', () => {
    const good = newBrochureRecord({ documentSha256: DIGEST, source: { address: 'Lot 12 Smith Street', suburb: 'Box Hill' }, requestedBy: 'u', now: 0 });
    expect(parseBrochureRecord({ ...good, version: 2 })).toBeNull();
    expect(parseBrochureRecord({ ...good, documentSha256: 'abc' })).toBeNull();
    expect(parseBrochureRecord({ ...good, source: { address: 'Lot 12 Smith Street' } })).toBeNull();
    expect(parseBrochureRecord({ ...good, requestedBy: ' ' })).toBeNull();
    expect(parseBrochureRecord({ ...good, requestedAt: 'yesterday' })).toBeNull();
    expect(parseBrochureRecord(null)).toBeNull();
    expect(isDocumentDigest(DIGEST)).toBe(true);
    expect(isDocumentDigest(`${DIGEST}0`)).toBe(false);
    expect(BROCHURE_RECORD_NAME).toBe('brochure.json');
  });
});

describe('listing-images files a brochure photograph for the report\'s author, on its own judgement', () => {
  const source = readFileSync('supabase/functions/listing-images/index.ts', 'utf8');
  const fn = source.slice(source.indexOf('async function fileBrochurePhotograph('), source.indexOf('/* Handler'));
  const branch = source.slice(
    source.indexOf("if (op === 'capture_brochure_photograph') {"),
    source.indexOf('/* -- User-facing resolve'),
  );
  const capture = source.slice(source.indexOf('async function captureReportPhotographs('), source.indexOf('async function fileBrochurePhotograph('));

  it('exists, as a branch of its own before the user-facing resolve', () => {
    expect(fn.length).toBeGreaterThan(2_000);
    expect(branch.length).toBeGreaterThan(200);
    expect(source.indexOf("if (op === 'capture_brochure_photograph') {")).toBeLessThan(source.indexOf('/* -- User-facing resolve'));
  });

  it('authenticates, then asks for the REPORT permission, then meters, before it does anything', () => {
    const auth = branch.indexOf('await verifyAuth(');
    const permission = branch.indexOf('await requireModulePermission(');
    const actorQuota = branch.indexOf('await enforceActorQuota(');
    const ipQuota = branch.indexOf('await enforceIpQuota(');
    const work = branch.indexOf('await fileBrochurePhotograph(');
    expect(auth).toBeGreaterThan(-1);
    expect(permission).toBeGreaterThan(auth);
    expect(branch.slice(permission, actorQuota)).toMatch(/'reports',\s*'can_view'/);
    expect(Math.min(actorQuota, ipQuota)).toBeGreaterThan(permission);
    expect(work).toBeGreaterThan(Math.max(actorQuota, ipQuota));
    expect(branch).toContain('BROCHURE_SCOPE');
    // The caller is the verified session, never a field of the request.
    expect(branch).toContain('userId: auth.userId');
    expect(branch).not.toMatch(/userId:\s*body\./);
  });

  it('files only for the author of a report that is not derived, and never beside a listing capture', () => {
    expect(fn).toMatch(/select\('id, generated_by, parent_report_id, derived_from_report_id, property_address'\)/);
    expect(fn).toMatch(/if \(report\.parent_report_id \|\| report\.derived_from_report_id\) return \{ status: 409, reason: 'derived_report' \};/);
    expect(fn).toContain("if (report.generated_by !== args.userId) return { status: 403, reason: 'not_the_author' };");
    expect(fn).toContain("return { status: 409, reason: 'listing_capture', held: held.length };");
    // And the other way round: a capture never starts over a brochure's photographs.
    expect(capture).toContain("return { status: 409, reason: 'brochure_photographs', held: held.length };");
  });

  it('holds the report to the brochure\'s address before it writes anything, and again on every later photograph', () => {
    const first = fn.slice(fn.indexOf('} else {'));
    const checked = first.indexOf('if (!brochurePhotographsAreOfReportAddress(report.property_address, source)) {');
    const written = first.indexOf('.upload(`${folder}/${BROCHURE_RECORD_NAME}`');
    const image = fn.indexOf('.upload(`${target}/${name}`');
    expect(checked).toBeGreaterThan(-1);
    expect(first).toContain("return { status: 409, reason: 'address_mismatch' };");
    expect(written).toBeGreaterThan(checked);
    // No record, no photographs: a failed record write files nothing.
    expect(first).toContain("return { status: 503, reason: 'record_unwritable' };");
    expect(image).toBeGreaterThan(fn.indexOf("return { status: 503, reason: 'record_unwritable' };"));
    const later = fn.slice(0, fn.indexOf('} else {'));
    expect(later).toContain('if (!brochurePhotographsAreOfReportAddress(report.property_address, record.source)) {');
    expect(later).toContain("return { status: 409, reason: 'address_changed', held: held.length };");
    expect(later).toContain("if (record.documentSha256 !== documentSha256) return { status: 409, reason: 'different_document', held: held.length };");
    expect(later).toContain("if (record.requestedBy !== report.generated_by) return { status: 409, reason: 'record_mismatch', held: held.length };");
    expect(later).toContain("return { status: 503, reason: 'record_unreadable', held: held.length };");
  });

  it('keeps a photograph only on the server\'s own verdict, at print size, once, at its own place', () => {
    expect(fn).toMatch(/Math\.max\(size\.width, size\.height\) < MIN_PRINT_LONG_EDGE_PX/);
    expect(fn).toContain('await judgeForCapture(newAnalysisBudget(BROCHURE_BUDGET_MS), bytes)');
    // The server's verdict must name the kind the picture is filed as: a
    // photograph where one was sent, a plan where a plan was.
    expect(fn).toContain('if (analysis.kind !== kind) return { status: 422, reason: analysis.kind, held: held.length };');
    expect(fn).toMatch(/signatureDistance\(photo\.signature, analysis\.signature\)[\s\S]*SIGNATURE_MATCH_BITS/);
    expect(fn).toContain("if (held.some((photo) => photo.checksum === checksum)) return { status: 409, reason: 'duplicate', held: held.length };");
    expect(fn).toContain("if (atPlace) return { status: 409, reason: 'place_taken', held: held.length };");
    expect(fn).toContain("if (held.length >= limit) return { status: 409, reason: 'limit', held: held.length };");
    expect(fn).toContain("const limit = kind === 'floorplan' ? REPORT_FLOOR_PLAN_LIMIT : REPORT_PHOTOGRAPH_LIMIT;");
    expect(fn).toMatch(/captureObjectName\(\{\s*place,/);
    // The stored type comes from the bytes, never from the request.
    expect(fn).toContain('const contentType = `image/${size.format}`;');
    expect(fn).not.toContain('args.contentType');
  });

  it('refuses a payload it cannot bound before it decodes anything', () => {
    expect(fn).toContain('if (!isDocumentDigest(args.documentSha256))');
    expect(fn).toMatch(/place < 0 \|\| place >= limit/);
    expect(fn).toContain("if (!kind) return { status: 400, reason: 'invalid_kind' };");
    expect(fn).toMatch(/bytes\.length > BROCHURE_PHOTOGRAPH_MAX_BYTES/);
    expect(source).toMatch(/value\.length > Math\.ceil\(BROCHURE_PHOTOGRAPH_MAX_BYTES \/ 3\) \* 4 \+ 4/);
  });

  it('files a floor plan in its own subfolder, placed and counted among the plans alone', () => {
    expect(source).toMatch(/function brochureKindOf\(value: unknown\): BrochureKind \| null \{\s*if \(value === undefined \|\| value === null \|\| value === 'photo'\) return 'photo';\s*return value === 'floorplan' \? 'floorplan' : null;/);
    expect(fn).toContain("const target = kind === 'floorplan' ? floorPlanFolder(args.reportId) : folder;");
    expect(fn).toMatch(/if \(kind === 'floorplan'\) \{[\s\S]*?\.list\(target, \{ limit: 100 \}\)[\s\S]*?held = heldCapturedPhotographs\(plans\.data \?\? \[\]\);/);
    expect(fn).toContain('.upload(`${target}/${name}`');
    // The record, the address and the author checks run on the report's own
    // folder whatever is being filed: a plan is vouched for as a photograph is.
    expect(fn.indexOf('.list(folder, { limit: 100 })')).toBeLessThan(fn.indexOf("if (kind === 'floorplan') {"));
    expect(branch).toContain('kind: body.kind,');
  });

  it('files under the report and never in the marketplace\'s library, and fetches nothing', () => {
    expect(fn).toContain('const folder = captureFolder(args.reportId);');
    expect(fn).not.toContain(".from('listing_images')");
    expect(fn).not.toMatch(/(^|[^\w.])fetch\(/m);
    expect(fn).not.toContain('fetchImageBytes(');
  });
});

describe('the broker reads a brochure\'s photographs where it reads a capture\'s', () => {
  const broker = readFileSync('supabase/functions/get-investment-reports/index.ts', 'utf8');
  const fn = broker.slice(broker.indexOf('async function readCapturedPhotographs('), broker.indexOf('Deno.serve('));

  it('reads the brochure\'s record only where the folder holds no capture record, and serves nothing without one', () => {
    const capture = fn.indexOf('const record = await readCaptureRecord(');
    const brochure = fn.indexOf('const brochure = await readBrochureRecord(');
    expect(capture).toBeGreaterThan(-1);
    expect(brochure).toBeGreaterThan(capture);
    expect(fn).toContain('if (!brochure) return { photographs: [] };');
    const reader = fn.slice(fn.indexOf('async function readBrochureRecord('));
    expect(reader).toContain('if (!objects.some((object) => object?.name === BROCHURE_RECORD_NAME)) return null;');
    expect(reader).toContain('return parseBrochureRecord(JSON.parse(await stored.data.text()));');
  });

  it('holds the report as it reads NOW to the brochure\'s address, in the lot-aware form', () => {
    const check = fn.indexOf('if (!brochurePhotographsAreOfReportAddress(row?.property_address, brochure.source)) {');
    const chosen = fn.indexOf('capturedPhotographsForReport(listed.data ?? [])');
    expect(check).toBeGreaterThan(-1);
    expect(chosen).toBeGreaterThan(check);
  });

  it('tells a document there is nothing for it to finish', () => {
    expect(fn).toContain("state: record ? captureStateOf(record, Date.now()) : 'complete',");
  });

  it('serves the plans beside the photographs, vouched for by the same record and address', () => {
    const plans = fn.indexOf("const planListing = await supabase.storage.from('listing-images').list(planFolder");
    const check = fn.indexOf('if (!brochurePhotographsAreOfReportAddress(row?.property_address, brochure.source)) {');
    expect(check).toBeGreaterThan(-1);
    expect(plans).toBeGreaterThan(check);
    expect(fn).toContain('capturedFloorPlansForReport(planListing.data ?? [])');
    expect(fn).toContain('return { photographs: photographs ?? [], floorPlans: floorPlans ?? [], photographCapture };');
    expect(broker).toContain('floorPlansForReport(rows, shared)');
    expect(broker).toContain('...(reading ? { photographs: reading.photographs, floorPlans: reading.floorPlans ?? [] } : {}),');
  });
});

describe('the generator reads the brochure beside the parse and files the ticks once the report exists', () => {
  const generator = readFileSync('src/components/reports/InvestmentReportGenerator.tsx', 'utf8');
  const parse = generator.slice(generator.indexOf('const handleParsePdfOnly = async () => {'), generator.indexOf('const handleGenerateFromPdf = async () => {'));
  const generate = generator.slice(generator.indexOf('const handleGenerateFromPdf = async () => {'), generator.indexOf('const getQueryTypeIcon = () => {'));

  it('starts reading once the pages are rendered, and reads the pages for the property once the parse has named it', () => {
    const converted = parse.indexOf('await convertPdfToImages(pdfFile');
    const begun = parse.indexOf('brochurePhotographs.begin(pdfFile);');
    const parsed = parse.indexOf("await invokeSecureFunction('parse-property-pdf'");
    const settled = parse.indexOf('brochurePhotographs.settle({ address: extracted.extractedAddress, suburb: extracted.extractedSuburb });');
    for (const at of [converted, begun, parsed, settled]) expect(at).toBeGreaterThan(-1);
    expect(begun).toBeGreaterThan(converted);
    expect(parsed).toBeGreaterThan(begun);
    expect(settled).toBeGreaterThan(parsed);
    // A failed parse leaves no photographs behind it.
    expect(parse.slice(parse.indexOf('} catch (error) {'))).toContain('brochurePhotographs.reset();');
  });

  it('files the ticks once the report row exists and its generation has started, and holds the page until they land', () => {
    // Renegotiated after Codex's review of #2775: this used to assert the
    // filing was "never awaited", which was the defect — the report was
    // announced and the form cleared while the only copy of the pictures was
    // still in flight from this page.
    const insert = generate.indexOf("report_content: 'Generating report from PDF...',");
    const generation = generate.indexOf("invokeSecureFunction('generate-investment-report', {");
    const filing = generate.indexOf('const brochureFiling = brochurePhotographs.filingArgs();');
    const held = generate.indexOf('const held = await fileWhilePageHeld(');
    const announced = generate.indexOf('title: "Report Generation Started",');
    const cleared = generate.indexOf('brochurePhotographs.reset();', held);
    for (const at of [insert, generation, filing, held, announced, cleared]) expect(at).toBeGreaterThan(-1);
    // The generation never waits for the pictures: a document reads them when it is drawn.
    expect(generation).toBeGreaterThan(insert);
    expect(filing).toBeGreaterThan(generation);
    // The report is announced, and the form cleared, only after the held filing answers.
    expect(announced).toBeGreaterThan(held);
    expect(cleared).toBeGreaterThan(announced);
    expect(generate.slice(held, held + 400)).toMatch(/\(\) => fileChosenBrochurePhotographs\(\{\s*invoke: \(request\) => invokeSecureFunction\('listing-images', \{ \.\.\.request \}\),\s*reportId: pendingReport\.id,/);
    expect(generate).not.toMatch(/void fileChosenBrochurePhotographs/);
    expect(generate).toContain('{ onLateOutcome: reportBrochureFiling },');
    expect(generate).toContain("const message = outcome ? describeBrochureFiling(outcome) : BROCHURE_FILING_BROKE;");
    expect(generate).toContain("if (held.state === 'settled') reportBrochureFiling(held.outcome);");
    expect(generate).toContain('else toast(BROCHURE_FILING_STILL_RUNNING);');
  });

  it('forgets a brochure\'s photographs when the file changes, is removed, or the form is cleared', () => {
    expect(generator.match(/brochurePhotographs\.reset\(\);/g)?.length).toBeGreaterThanOrEqual(5);
    expect(generator).toContain('resetBrochurePhotographs();');
  });

  it('shows the picker only once the brochure has been parsed', () => {
    expect(generator).toMatch(/\{pdfParsedData && brochurePhotographs\.state && \(\s*<BrochurePhotographsPicker/);
  });
});

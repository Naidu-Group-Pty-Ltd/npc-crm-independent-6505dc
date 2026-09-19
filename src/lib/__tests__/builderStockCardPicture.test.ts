/**
 * Builder stock — how a photograph sits in a card, and the fact in its title.
 *
 * TWO DEFECTS, ONE MISTAKE. The card began as a 160px strip with
 * `object-cover`, which discarded 68% of a portrait render and kept a band of
 * sky — no house. The repair was to CONTAIN every picture in a 16:10 frame,
 * nothing cropped ever, and that bought the defect that replaced it: a grey
 * band above and below almost every card, reported as looking broken.
 *
 * Both treated the frame and the fit as one decision. MEASURED over the 94
 * properties live on 11 September 2026:
 *
 *     1.778   66 cards   the modal shape, by a factor of six
 *                        (64 exactly 16:9, 2 at 1.7780)
 *     1.600   11 cards
 *     1.258    7 cards
 *     1.400    3 cards
 *     1.019    3 cards
 *     1.416    2 cards
 *     1.717    2 cards
 *
 * The 16:10 frame had been fitted to a corpus of twenty-seven that a later
 * stock list replaced entirely — the lesson being that a frame fitted to one
 * upload is wrong for the next. 16:9 is not fitted: it is what the builders'
 * rendering software emits, and 70% of the live list matches it exactly.
 *
 * The fit then turns on WHICH WAY the crop would run. Taller than the frame
 * and covering takes sky and foreground planting; checked by eye against the
 * three worst live images, where a 43% crop removed nothing but sky and
 * shrubs. Wider than the frame and covering takes the sides, which is where a
 * house extends. Generous allowance one way, tight the other.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CARD_PICTURE_ASPECT, CARD_PICTURE_MAX_HORIZONTAL_CROP, CARD_PICTURE_MAX_VERTICAL_CROP,
  cardPictureFit, cardPictureGroundShare, cardPictureNeedsGround,
  describesConfigurationOnly, homeSizeDisplay, homeSizeLabel, sizeFromConfiguration,
  stockItemTitle,
} from '../builderStock';

/** Every shape live on the marketplace, with how many cards carry it. */
const LIVE_SHAPES: Array<{ w: number; h: number; cards: number }> = [
  { w: 1920, h: 1080, cards: 48 },
  { w: 1280, h: 720, cards: 16 },
  { w: 3556, h: 2000, cards: 2 },
  { w: 3000, h: 1875, cards: 6 },
  { w: 2000, h: 1250, cards: 3 },
  { w: 1000, h: 625, cards: 2 },
  { w: 1359, h: 1080, cards: 7 },
  { w: 1249, h: 892, cards: 3 },
  { w: 1078, h: 1058, cards: 3 },
  { w: 480, h: 339, cards: 2 },
  { w: 881, h: 513, cards: 2 },
];

describe('cardPictureFit — every live card fills its frame', () => {
  it('leaves not one of the 94 with a band', () => {
    let filling = 0;
    for (const shape of LIVE_SHAPES) {
      expect(cardPictureFit(shape.w, shape.h)).toBe('cover');
      filling += shape.cards;
    }
    expect(filling).toBe(94);
  });

  it('crops nothing at all from the sixty-four that are exactly 16:9', () => {
    const exact = LIVE_SHAPES.filter((s) => s.w / s.h === CARD_PICTURE_ASPECT);
    expect(exact.reduce((n, s) => n + s.cards, 0)).toBe(64);
    for (const s of exact) expect(cardPictureGroundShare(s.w, s.h)).toBe(0);
  });

  it('crops a hundredth of a percent from the pair that is 1.7780', () => {
    // 3556×2000 is 16:9 to the eye and not to the bit. It covers like the
    // rest; the point is that the fit is measured, not matched.
    const near = LIVE_SHAPES.find((s) => s.w === 3556)!;
    expect(near.w / near.h).not.toBe(CARD_PICTURE_ASPECT);
    expect(cardPictureGroundShare(near.w, near.h)).toBeLessThan(0.001);
    expect(cardPictureFit(near.w, near.h)).toBe('cover');
  });
});

describe('cardPictureFit — the crop axis is the rule', () => {
  /*
   * A picture taller than the frame loses sky and planting; one wider than it
   * loses the sides, where a house extends and where a brochure banner can put
   * the building. The allowance differs by an order of magnitude for that
   * reason alone.
   */
  it('is generous downward, where the crop takes sky and ground', () => {
    expect(cardPictureFit(1019, 1000)).toBe('cover');   // 42.7% of height
    expect(cardPictureFit(893, 1000)).toBe('cover');    // 49.8%, just inside
    expect(cardPictureFit(800, 1000)).toBe('contain');  // 55%, a real portrait
    expect(cardPictureFit(600, 1000)).toBe('contain');  // a brochure page
  });

  it('is tight sideways, where the crop takes the house', () => {
    // The edge sits at 16/9 ÷ 0.8 = 2.2222…
    expect(cardPictureFit(2054, 1000)).toBe('cover');   // 13.4% of width
    expect(cardPictureFit(2222, 1000)).toBe('cover');   // 19.99%, just inside
    expect(cardPictureFit(2223, 1000)).toBe('contain'); // 20.02%, just outside
    expect(cardPictureFit(2300, 1000)).toBe('contain'); // 22.7%
    expect(cardPictureFit(3584, 1000)).toBe('contain'); // 50.4%, a strip
  });

  it('allows far more vertically than horizontally, deliberately', () => {
    expect(CARD_PICTURE_MAX_VERTICAL_CROP)
      .toBeGreaterThan(CARD_PICTURE_MAX_HORIZONTAL_CROP);
  });

  it('contains a picture it could not measure, because that cannot cut a house', () => {
    for (const [w, h] of [[0, 0], [1600, 0], [0, 900], [-4, 3], [NaN, 10], [10, Infinity]]) {
      expect(cardPictureFit(w, h)).toBe('contain');
    }
  });
});

describe('cardPictureNeedsGround', () => {
  it('draws no ground behind a picture that fills the frame', () => {
    for (const shape of LIVE_SHAPES) {
      expect(cardPictureNeedsGround(shape.w, shape.h)).toBe(false);
    }
  });

  it('draws it behind the shapes that are contained', () => {
    expect(cardPictureNeedsGround(600, 1000)).toBe(true);
    expect(cardPictureNeedsGround(3584, 1000)).toBe(true);
  });

  it('draws none for a picture it could not measure', () => {
    // Contained, but there is no picture to blur — a blur of nothing is a
    // grey slab, which is the defect this whole change removes.
    expect(cardPictureNeedsGround(0, 0)).toBe(false);
    expect(cardPictureNeedsGround(NaN, NaN)).toBe(false);
  });
});

/*
 * THE TREATMENT MOVED, AND THAT IS WHAT THESE NOW PIN.
 *
 * Every assertion below used to read `BuilderStockTab.tsx`, because the
 * fit-and-ground logic lived inline in the Command Centre's marketplace card.
 * The Builder portal's Stock List needed to draw the same photograph the same
 * way, so it was EXTRACTED into `StockPicture` with the transport as a
 * parameter rather than copied — and the reason it was extracted is exactly
 * the reason these assertions follow it: two implementations of one treatment
 * is how the two portals come to draw the same house differently.
 *
 * So the rules are unchanged and asserted against the one module that
 * implements them, plus a new one: neither caller may re-implement any of it.
 */
describe('the frame the arithmetic assumes is the frame the picture draws', () => {
  const picture = () => readFileSync(
    join(process.cwd(), 'src/components/stock/StockPicture.tsx'), 'utf8',
  );
  /** Comments may NAME a rule; only code may break it. */
  const stripComments = (source: string) => source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('pins CARD_PICTURE_ASPECT to the class StockPicture renders', () => {
    const source = picture();
    const classes = source.match(/aspect-\[(\d+)\/(\d+)\]/g) ?? [];
    expect(classes.length).toBeGreaterThan(0);
    for (const drawn of classes) {
      const [, w, h] = /aspect-\[(\d+)\/(\d+)\]/.exec(drawn)!;
      expect(Number(w) / Number(h)).toBeCloseTo(CARD_PICTURE_ASPECT, 6);
    }
  });

  it('lets the measured fit decide, never a hardcoded object-fit', () => {
    const source = picture();
    // The photograph's fit comes from `cardPictureFit`; only the decorative
    // ground is allowed a fixed `object-cover`, because it must always fill.
    expect(source).toContain("fit === 'cover' ? 'object-cover' : 'object-contain'");
    expect(source).toContain('cardPictureFit(drawn.naturalWidth, drawn.naturalHeight)');
  });

  it('mounts the ground only where the picture it belongs to is mounted', () => {
    const source = picture();
    /*
     * The rule used to be checked by counting one inline guard expression
     * TWICE — once on the ground, once on the picture — which is the shape
     * that let them drift in the first place. It is one named reading now,
     * and the ground is gated on nothing else: `contained` can only be true
     * where the picture is already drawn, so a blur of nothing (the grey slab
     * this whole treatment exists to remove) is unreachable rather than
     * merely absent.
     */
    expect(source).toContain(
      "const contained = Boolean(signedUrl) && !broken && fit === 'contain';",
    );
    expect(source).toContain('{contained ? (');
    /*
     * And the ground is a `filter`, never a `backdrop-filter`: `glass.css`
     * forbids one on anything that repeats, and a sheet of plates repeats.
     * Judged on the CODE, because the module's own prose states the rule in
     * those words — the trap this repo has hit before, where an assertion
     * matches the comment explaining it.
     */
    expect(stripComments(source)).not.toMatch(/backdrop-(filter|blur)/);
  });

  it('is the only implementation — the caller never re-derives the fit', () => {
    /* The Builder Portal's own Stock List was the second caller until the
       portal moved to the Builders Network (extraction Phase 7); the
       marketplace tab is the surviving surface, and the rule is the same —
       one implementation, so a second surface could not draw the same
       photograph differently. */
    for (const caller of [
      'src/components/listings/BuilderStockTab.tsx',
    ]) {
      const source = readFileSync(join(process.cwd(), caller), 'utf8');
      expect(source).toContain('<StockPicture');
      // Comments may NAME the rule; no call site may execute it.
      const code = stripComments(source);
      expect(code).not.toContain('cardPictureFit(');
      expect(code).not.toContain("fit === 'cover' ? 'object-cover' : 'object-contain'");
      expect(code).not.toMatch(/scale-125[^"'`]*blur-3xl/);
    }
  });
});

describe('describesConfigurationOnly', () => {
  it('recognises a list’s own disambiguator as data rather than a name', () => {
    expect(describesConfigurationOnly('3 Bed · 140 m²')).toBe(true);
    expect(describesConfigurationOnly('4 Bed · 154 m²')).toBe(true);
    expect(describesConfigurationOnly('4 bed, 2 bath, 2 car')).toBe(true);
    expect(describesConfigurationOnly('3 bedrooms - 2 bathrooms')).toBe(true);
    expect(describesConfigurationOnly('220 sqm')).toBe(true);
    expect(describesConfigurationOnly('154m2 / 2 car spaces')).toBe(true);
  });

  it('treats one unrecognised word as a NAME, because losing a real name is worse', () => {
    expect(describesConfigurationOnly('Ilya 15')).toBe(false);
    expect(describesConfigurationOnly('Aspire 22 · 4 Bed')).toBe(false);
    expect(describesConfigurationOnly('Facade B')).toBe(false);
    expect(describesConfigurationOnly('Sanctuary 28 MkII')).toBe(false);
    // A bare number names nothing measurable either — not configuration.
    expect(describesConfigurationOnly('15')).toBe(false);
    expect(describesConfigurationOnly('')).toBe(false);
    expect(describesConfigurationOnly('   ')).toBe(false);
  });

  it('does not mistake a word that merely starts with a token', () => {
    expect(describesConfigurationOnly('2 Bedrock')).toBe(false);
    expect(describesConfigurationOnly('4 Carlisle')).toBe(false);
  });
});

describe('sizeFromConfiguration / homeSizeLabel', () => {
  it('reads the house size a configuration annotation states', () => {
    expect(sizeFromConfiguration('3 Bed · 140 m²')).toBe(140);
    expect(sizeFromConfiguration('4 Bed · 154m2')).toBe(154);
    expect(sizeFromConfiguration('220 sqm')).toBe(220);
    expect(sizeFromConfiguration('4 Bed · 2 Bath')).toBeNull();
  });

  it('labels a size and refuses anything that is not one', () => {
    expect(homeSizeLabel(154)).toBe('154 m² home');
    expect(homeSizeLabel(null)).toBeNull();
    expect(homeSizeLabel(undefined)).toBeNull();
    expect(homeSizeLabel(0)).toBeNull();
    expect(homeSizeLabel(-12)).toBeNull();
  });
});

describe('homeSizeDisplay — rounded to show, never to store', () => {
  /*
   * Builders quote a plan to the centimetre, so two decimals beside a whole
   * `563 m² land` is noise on a card with one line for both. The rounding is
   * a property of the DISPLAY: nothing here writes, and `building_size_sqm`
   * keeps every digit for the contract, the report and the export.
   */
  it('rounds the seven live sizes that carry decimals', () => {
    const live: Array<[number, number]> = [
      [179.82, 180], [190.38, 190], [174.65, 175], [173.84, 174],
      [168.1, 168], [167.3, 167], [161.54, 162], [172.84, 173],
      [121.84, 122], [139.52, 140], [175.28, 175],
    ];
    for (const [stored, shown] of live) {
      expect(homeSizeDisplay(stored)).toBe(shown);
      expect(homeSizeLabel(stored)).toBe(`${shown} m² home`);
    }
  });

  it('leaves a whole size exactly as it is', () => {
    for (const whole of [140, 154, 141, 178, 184, 207, 232, 235, 243, 295]) {
      expect(homeSizeDisplay(whole)).toBe(whole);
    }
  });

  it('rounds half away from zero, as a reader would', () => {
    expect(homeSizeDisplay(140.5)).toBe(141);
    expect(homeSizeDisplay(140.49)).toBe(140);
  });

  it('refuses anything that is not a size', () => {
    expect(homeSizeDisplay(null)).toBeNull();
    expect(homeSizeDisplay(undefined)).toBeNull();
    expect(homeSizeDisplay(0)).toBeNull();
    expect(homeSizeDisplay(-12)).toBeNull();
    expect(homeSizeDisplay(NaN)).toBeNull();
    expect(homeSizeDisplay(Infinity)).toBeNull();
  });

  it('says nothing rather than that a house has no floor area', () => {
    // 0.4 is a bad record; `0 m² home` on a card would be a claim about a
    // house, which is worse than an absent line.
    expect(homeSizeDisplay(0.4)).toBeNull();
    expect(homeSizeLabel(0.4)).toBeNull();
  });

  it('is the only reading the stats row takes — never the raw column', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/listings/BuilderStockTab.tsx'), 'utf8',
    );
    expect(source).toContain('homeSizeDisplay(item.building_size_sqm)');
    // Rendering the column directly is what printed `179.82 m² home`.
    expect(source).not.toMatch(/\{item\.building_size_sqm\}/);
  });
});

/** The six cards in the reported screenshot, as the list actually holds them. */
function item(over: Partial<Parameters<typeof stockItemTitle>[0]>) {
  return {
    unit_number: null, lot_number: null, address_line: null,
    development_name: null, project_name: null, external_reference: null,
    building_size_sqm: null, house_design: null,
    ...over,
  } as Parameters<typeof stockItemTitle>[0];
}

describe('stockItemTitle — several houses on one lot', () => {
  /*
   * MEASURED, 11 SEPTEMBER 2026: 95 live packages across 75 lots. Fifteen
   * lots carry more than one, so 35 cards (37%) shared the lot, the estate,
   * the suburb, the land size and usually the bed count with a sibling and
   * were drawn identically. The design separates all 35, and there is no lot
   * where it would not.
   *
   * It reaches the card through `STOCK_ITEM_SELECT`, not the address line:
   * a spreadsheet gives the design its own column and leaves `address_line`
   * null entirely, which is why reading the line alone fixed none of these.
   */
  const lot1730 = (design: string) => item({
    lot_number: '1730', development_name: 'Austin Estate', house_design: design,
  });

  it('names the three packages on Austin Estate lot 1730', () => {
    expect(stockItemTitle(lot1730('Vanta 23'))).toBe('Lot 1730, Austin Estate · Vanta 23');
    expect(stockItemTitle(lot1730('Vanta 20'))).toBe('Lot 1730, Austin Estate · Vanta 20');
    expect(stockItemTitle(lot1730('Cura 20B'))).toBe('Lot 1730, Austin Estate · Cura 20B');
    // The point of the exercise: no two of them read alike.
    const titles = ['Vanta 23', 'Vanta 20', 'Cura 20B'].map((d) => stockItemTitle(lot1730(d)));
    expect(new Set(titles).size).toBe(3);
  });

  it('names the two packages on Wollert Rise lot 1037', () => {
    const at1037 = (design: string) => item({
      lot_number: '1037', development_name: 'Wollert Rise', house_design: design,
    });
    expect(stockItemTitle(at1037('Nex 20'))).toBe('Lot 1037, Wollert Rise · Nex 20');
    expect(stockItemTitle(at1037('Vanta 20'))).toBe('Lot 1037, Wollert Rise · Vanta 20');
  });

  it('takes the record’s own field over the address line', () => {
    // Both present and disagreeing: the column is the record, the bracket is
    // a parse of prose. A list that states it twice states it once properly.
    expect(stockItemTitle(item({
      address_line: 'Lot 22 - Aria Estate, Tarneit VIC 3029 [Ilya 15]',
      house_design: 'Ilya 15 MkII',
    }))).toBe('Lot 22, Aria Estate · Ilya 15 MkII');
  });

  it('still reads the address line where the record states no design', () => {
    expect(stockItemTitle(item({
      address_line: 'Lot 22 - Aria Estate, Tarneit VIC 3029 [Ilya 15]',
    }))).toBe('Lot 22, Aria Estate · Ilya 15');
  });

  it('treats a blank or whitespace design as not stated', () => {
    expect(stockItemTitle(item({
      lot_number: '9', development_name: 'Some Estate', house_design: '   ',
    }))).toBe('Lot 9, Some Estate');
    expect(stockItemTitle(item({
      lot_number: '9', development_name: 'Some Estate', house_design: null,
    }))).toBe('Lot 9, Some Estate');
  });

  it('never says the design twice', () => {
    // Where the body already names it, the suffix is dropped rather than
    // echoed — the same rule the address-line annotation has always had.
    expect(stockItemTitle(item({
      lot_number: '4', development_name: 'Vanta Park', house_design: 'Vanta Park',
    }))).toBe('Lot 4, Vanta Park');
  });

  /*
   * THE FIFTEEN LOTS, AS PRODUCTION HELD THEM ON 11 SEPTEMBER 2026.
   *
   * Every one of the 95 live rows has a NULL `address_line` — a spreadsheet
   * gives the lot, the estate and the design their own columns — so the
   * address-line annotation could not have separated a single one of these.
   * 35 cards across these 15 lots were one card drawn two or three times.
   */
  const MULTI_PACKAGE_LOTS: Array<[string, string, string[]]> = [
    ['Austin Estate', '1730', ['Vanta 20', 'Vanta 23', 'Cura 20B']],
    ['Five Farms', '1002', ['VG18E', 'Enzo 10.5']],
    ['Harlow', '801', ['Cura 20B', 'Nex 20', 'Elara 18']],
    ['Harlow', '805', ['Elara 18', 'Nex 20']],
    ['Harlow', '809', ['Elara 18', 'VG18', 'Nex 20']],
    ['Harlow', '810', ['VG18', 'Nex 20', 'Elara 18']],
    ['Lumina Estate', '55', ['Enzo 10.5', 'VGU19']],
    ['Lumina Estate', '56', ['Enzo 10.5', 'VGU19']],
    ['Lumina Estate', '57', ['VGU19', 'Enzo 10.5']],
    ['Lumina Estate', '58', ['Enzo 10.5', 'VGU19']],
    ['Oaklands Estate', '117', ['Nex 20', 'Cura 20B', 'Elara 18']],
    ['Palomino', '116', ['Nex 20', 'Vanta 23']],
    ['Seventh Bend', '2031', ['Vanta 23', 'Cura 20B']],
    ['Watsons Reach', '324', ['Enzo 10.5', 'Nex 20']],
    ['Wollert Rise', '1037', ['Vanta 20', 'Nex 20']],
  ];

  it('gives all 35 siblings a title of their own', () => {
    let cards = 0;
    for (const [development_name, lot_number, designs] of MULTI_PACKAGE_LOTS) {
      const titles = designs.map((house_design) =>
        stockItemTitle(item({ development_name, lot_number, house_design })));
      cards += titles.length;
      expect(new Set(titles).size).toBe(designs.length);
      for (const title of titles) expect(title).toMatch(/^Lot \d+, .+ · .+$/);
    }
    expect(MULTI_PACKAGE_LOTS.length).toBe(15);
    expect(cards).toBe(35);
  });

  it('reads every design the live list carries as a NAME, not as data', () => {
    // A design misread as configuration would be replaced by a house size —
    // and these rows have none, so it would vanish and the siblings collapse
    // back into one card. `Enzo 10.5` and `Form 19 B` are the near misses.
    const LIVE_DESIGNS = [
      'Enzo 10.5', 'Enzo 8.5', 'Vanta 20', 'Vanta 23', 'Cura 20B', 'Elara 18',
      'VG-U-19', 'VG18E', 'VG18', 'VGU19', 'Nex 20', 'Form 19 B', 'Pico 8',
      'LX -M 18', 'LX -M 19', 'LX 18E', 'LX M18', 'LX U19', 'Domain 17',
      'Neo 13', 'Neo 15', 'Urban 19', 'Metro 19',
    ];
    for (const design of LIVE_DESIGNS) {
      expect(describesConfigurationOnly(design)).toBe(false);
      expect(stockItemTitle(item({
        lot_number: '1', development_name: 'E', house_design: design,
      }))).toBe(`Lot 1, E · ${design}`);
    }
  });

  it('restates a design field that is really configuration data', () => {
    // One rule for both routes: a "design" of `3 Bed · 140 m²` names nothing.
    expect(stockItemTitle(item({
      lot_number: '7', development_name: 'Some Estate',
      house_design: '3 Bed · 140 m²', building_size_sqm: 140,
    }))).toBe('Lot 7, Some Estate · 140 m² home');
  });
});

describe('stockItemTitle — the reported cards', () => {
  it('tells two packages on one lot apart by the house, labelled', () => {
    expect(stockItemTitle(item({
      address_line: 'Lot 60941 - Cloverton Estate, Kalkallo VIC 3064 [4 Bed · 154 m²]',
      building_size_sqm: 154,
    }))).toBe('Lot 60941, Cloverton Estate · 154 m² home');

    expect(stockItemTitle(item({
      address_line: 'Lot 60941 - Cloverton Estate, Kalkallo VIC 3064 [3 Bed · 140 m²]',
      building_size_sqm: 140,
    }))).toBe('Lot 60941, Cloverton Estate · 140 m² home');
  });

  it('leaves the cards that were already right exactly as they were', () => {
    expect(stockItemTitle(item({
      address_line: 'Lot 60416 Russula St, Beveridge VIC 3753 (141 m2)',
      building_size_sqm: 141,
    }))).toBe('Lot 60416, Russula Street');

    expect(stockItemTitle(item({
      address_line: 'Lot 843 - Verve Estate, Clyde VIC 3978', lot_number: '843',
    }))).toBe('Lot 843, Verve Estate');
  });

  it('keeps a real design name, which is the better differentiator', () => {
    expect(stockItemTitle(item({
      address_line: 'Lot 22 - Aria Estate, Tarneit VIC 3029 [Ilya 15]',
      building_size_sqm: 141,
    }))).toBe('Lot 22, Aria Estate · Ilya 15');
  });

  it('falls back to the size the annotation states when the column has none', () => {
    expect(stockItemTitle(item({
      address_line: 'Lot 7 - Some Estate, Clyde VIC 3978 [3 Bed · 140 m²]',
    }))).toBe('Lot 7, Some Estate · 140 m² home');
  });

  it('drops the suffix entirely rather than print a bed count the card draws', () => {
    expect(stockItemTitle(item({
      address_line: 'Lot 9 - Some Estate, Clyde VIC 3978 [4 Bed · 2 Bath]',
    }))).toBe('Lot 9, Some Estate');
  });
});

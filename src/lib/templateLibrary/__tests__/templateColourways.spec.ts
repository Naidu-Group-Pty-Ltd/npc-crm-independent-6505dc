/**
 * The colourway layer.
 *
 * The first block of tests is a transcription check and nothing else: the ten
 * Private Banking colourways are design decisions taken in Claude Design, and
 * the only thing that makes them trustworthy in this repository is that they
 * are byte-identical to the approved source. A contrast "improvement" to an
 * approved accent is a design change made by an engineer, and this is what
 * turns that into a failing test rather than into a slightly different report.
 *
 * The rest tests the DERIVATIONS — the roles the six approved values do not
 * cover — because those are this module's own work and can be wrong.
 */
import { describe, it, expect } from 'vitest';
import {
  BODY_INK_LIFT,
  COLOURWAYS_BY_FAMILY,
  PRIVATE_BANKING_COLOURWAYS,
  SEMANTIC_COLOURS,
  applyColourwayToSchema,
  bodyInkFor,
  colourwayColors,
  colourwayFingerprint,
  colourwayTokenOverride,
  colourwaysForFamily,
  contrastRatio,
  PRINT_SMALL_TYPE_CONTRAST,
  toPrintContrast,
  defaultColourwayFor,
  findColourway,
  hexToHsl,
  hslToHex,
  resolveColourway,
  shiftLightness,
} from '../colourways';

/**
 * `COLOURWAYS.pb` from `Template Catalogue.dc.html`, transcribed independently
 * of the module under test.
 *
 * Field order is the catalogue's own `CW_KEYS`:
 *   ['colourway','paper','ink','accent','rule','muted','ground']
 */
const APPROVED_SOURCE: ReadonlyArray<readonly [string, string, string, string, string, string, string]> = [
  ['Gold on Obsidian', '#FAF7EF', '#251F18', '#8E6C15', '#DDD1C0', '#6E6253', 'light'],
  ['Oxblood', '#FAF7EF', '#241819', '#7B2230', '#DED0CE', '#6E5A5C', 'light'],
  ['Verde', '#F7F6EF', '#1C241D', '#2F5D45', '#D5DCD3', '#64705F', 'light'],
  ['Navy Signet', '#F8F8F4', '#1B2130', '#22406E', '#D8DCE2', '#636A76', 'light'],
  ['Slate Bronze', '#F6F5F2', '#23211E', '#8A6A3A', '#DBD8D1', '#6B675F', 'light'],
  ['Platinum', '#F7F7F5', '#1E1E1C', '#4A4A46', '#DCDCD8', '#6A6A66', 'light'],
  ['Obsidian Reverse', '#1E1A15', '#F2EBDE', '#D9A520', '#3A332A', '#A2957F', 'dark'],
  ['Oxblood Night', '#1C1416', '#F0E6E4', '#C0565F', '#332628', '#A2908E', 'dark'],
  ['Deep Verde', '#141A16', '#E8EFE8', '#6FA98A', '#26302A', '#92A196', 'dark'],
  ['Midnight Navy', '#131720', '#E9EDF4', '#7FA3D8', '#262C38', '#93A0B2', 'dark'],
];

describe('approved source values', () => {
  it('ships exactly ten Private Banking colourways', () => {
    expect(PRIVATE_BANKING_COLOURWAYS).toHaveLength(10);
  });

  it('matches the approved catalogue, value for value and in order', () => {
    expect(PRIVATE_BANKING_COLOURWAYS.map(colourwayFingerprint))
      .toEqual(APPROVED_SOURCE.map((row) => row.join('|')));
  });

  it('is six light grounds and four dark, as the catalogue states', () => {
    const light = PRIVATE_BANKING_COLOURWAYS.filter((c) => c.ground === 'light');
    const dark = PRIVATE_BANKING_COLOURWAYS.filter((c) => c.ground === 'dark');
    expect(light).toHaveLength(6);
    expect(dark).toHaveLength(4);
  });

  it('defaults to Gold on Obsidian', () => {
    // The catalogue derives the default rather than storing it: index 0 unless
    // its ground disagrees with the variant's declared mode. Every Private
    // Banking variant declares light and index 0 is light.
    expect(defaultColourwayFor('private_banking')?.name).toBe('Gold on Obsidian');
  });

  it('classifies Gold on Obsidian as a LIGHT ground', () => {
    // The name describes the cover field, not the body ground. Getting this
    // backwards would put the flagship template in the wrong filter bucket.
    expect(findColourway('private_banking', 'pb-gold-on-obsidian')?.ground).toBe('light');
    expect(findColourway('private_banking', 'pb-obsidian-reverse')?.ground).toBe('dark');
  });

  it('has unique ids', () => {
    const ids = PRIVATE_BANKING_COLOURWAYS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('colourway lookup is scoped to its family', () => {
  it('finds a colourway inside its own family', () => {
    expect(findColourway('private_banking', 'pb-verde')?.name).toBe('Verde');
  });

  it('refuses a colourway curated by a different family', () => {
    // A colourway id is only meaningful inside the family that curated it. A
    // global lookup would let a request paint a Private Banking master in a
    // palette no designer ever paired it with — and now that all ten families
    // ship, that is a hundred ids that must not be interchangeable.
    expect(colourwaysForFamily('luxury_editorial')).toHaveLength(10);
    expect(findColourway('luxury_editorial', 'pb-verde')).toBeNull();
    expect(findColourway('private_banking', 'le-ivory-and-gold')).toBeNull();
    expect(findColourway('luxury_editorial', 'le-ivory-and-gold')?.name).toBe('Ivory and Gold');
  });

  it('refuses an unregistered family outright', () => {
    expect(colourwaysForFamily('not_a_family')).toHaveLength(0);
    expect(findColourway('not_a_family', 'pb-verde')).toBeNull();
  });

  it('returns null rather than a default for an unknown id', () => {
    expect(findColourway('private_banking', 'pb-not-a-colourway')).toBeNull();
    expect(findColourway('private_banking', null)).toBeNull();
  });
});

describe('colour maths', () => {
  it('round-trips hex through HSL', () => {
    for (const c of PRIVATE_BANKING_COLOURWAYS) {
      expect(hslToHex(hexToHsl(c.paper))).toBe(c.paper.toUpperCase());
      expect(hslToHex(hexToHsl(c.accent))).toBe(c.accent.toUpperCase());
    }
  });

  it('clamps rather than wrapping at the ends of the lightness scale', () => {
    expect(shiftLightness('#000000', -20)).toBe('#000000');
    expect(shiftLightness('#FFFFFF', 20)).toBe('#FFFFFF');
  });
});

describe('body ink derivation', () => {
  it('reproduces the archetype pair the rule was measured from', () => {
    // The approved Private Banking archetype sets `--field: #251F18` and
    // `--ink: #312A21` — the NPC design system's `--aurixa-obsidian` and
    // `--foreground`, four points of lightness apart. If this drifts, body copy
    // on every Private Banking page is the wrong weight of black.
    const gold = PRIVATE_BANKING_COLOURWAYS[0];
    expect(gold.ink).toBe('#251F18');
    const derived = hexToHsl(bodyInkFor(gold));
    const archetype = hexToHsl('#312A21');
    // Tolerances are set by 8-bit quantisation, not by looseness about the
    // rule. At 12–16% lightness one step of 1/255 moves the computed hue by
    // more than a degree, so an exact match is not a thing a hex colour can be.
    expect(derived.l).toBeCloseTo(archetype.l, 0);
    expect(Math.abs(derived.h - archetype.h)).toBeLessThan(3);
  });

  it('lifts by exactly the documented delta on a light ground', () => {
    for (const c of PRIVATE_BANKING_COLOURWAYS.filter((x) => x.ground === 'light')) {
      const lifted = hexToHsl(bodyInkFor(c)).l - hexToHsl(c.ink).l;
      // Within half a percentage point of the documented lift; the remainder is
      // the round trip through 8-bit RGB.
      expect(Math.abs(lifted - BODY_INK_LIFT), `${c.name} lift`).toBeLessThan(0.5);
    }
  });

  it('leaves a dark ground alone', () => {
    // On a dark ground the colourway's `ink` IS the light type colour. Lifting
    // it further would wash body copy out.
    for (const c of PRIVATE_BANKING_COLOURWAYS.filter((x) => x.ground === 'dark')) {
      expect(bodyInkFor(c)).toBe(c.ink);
    }
  });
});

describe('resolved roles', () => {
  it('puts the cover field and its type on opposite sides of the ground', () => {
    const light = findColourway('private_banking', 'pb-gold-on-obsidian')!;
    const dark = findColourway('private_banking', 'pb-obsidian-reverse')!;

    // Light: the cover is the obsidian ink, type on it is the ivory paper.
    expect(resolveColourway(light).bg).toBe(light.ink);
    expect(resolveColourway(light).text).toBe(light.paper);

    // Dark: the page is already the field, so the roles invert.
    expect(resolveColourway(dark).bg).toBe(dark.paper);
    expect(resolveColourway(dark).text).toBe(dark.ink);
  });

  it('keeps body copy legible on paper in every colourway', () => {
    for (const c of PRIVATE_BANKING_COLOURWAYS) {
      const r = resolveColourway(c);
      // WCAG AA for body text. These are printed client documents, so this is a
      // floor rather than a target.
      expect(contrastRatio(r.ink, r.surface), `${c.name} body on paper`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps type on the cover field legible in every colourway', () => {
    for (const c of PRIVATE_BANKING_COLOURWAYS) {
      const r = resolveColourway(c);
      expect(contrastRatio(r.text, r.bg), `${c.name} cover type`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('picks type on an accent fill by measurement, not by assumption', () => {
    for (const c of PRIVATE_BANKING_COLOURWAYS) {
      const r = resolveColourway(c);
      // The accent runs from #22406E (Navy Signet) to #D9A520 (Obsidian
      // Reverse). A fixed choice of white or black is illegible at one end.
      expect(contrastRatio(r.onPrimary, r.primary), `${c.name} on accent`).toBeGreaterThanOrEqual(3);
      expect([c.paper, c.ink]).toContain(r.onPrimary);
    }
  });

  it('separates the panel fill from the page it sits on', () => {
    for (const c of PRIVATE_BANKING_COLOURWAYS) {
      const r = resolveColourway(c);
      expect(r.panel).not.toBe(r.surface);
      // …but not so far that a table stripe reads as a filled block.
      expect(contrastRatio(r.panel, r.surface), `${c.name} panel`).toBeLessThan(1.6);
    }
  });

  it('holds the semantic colours fixed against the palette', () => {
    // Category B in the NPC design system: the colour of a loss is not a
    // branding decision, and must never follow a tenant brand or a colourway.
    const light = PRIVATE_BANKING_COLOURWAYS.filter((c) => c.ground === 'light');
    for (const c of light) {
      const r = resolveColourway(c);
      expect(r.negative).toBe(SEMANTIC_COLOURS.light.negative);
      expect(r.positive).toBe(SEMANTIC_COLOURS.light.positive);
    }
    // Dark grounds take the lifted forms — the same hues, legible on obsidian.
    for (const c of PRIVATE_BANKING_COLOURWAYS.filter((x) => x.ground === 'dark')) {
      const r = resolveColourway(c);
      expect(r.negative).toBe(SEMANTIC_COLOURS.dark.negative);
      expect(contrastRatio(r.negative, r.surface), `${c.name} negative`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('fills every role a block can address', () => {
    const roles = [
      'primary', 'bg', 'surface', 'panel', 'text', 'ink', 'muted',
      'onPrimary', 'line', 'positive', 'caution', 'negative', 'info',
    ];
    for (const c of PRIVATE_BANKING_COLOURWAYS) {
      const colors = colourwayColors(c);
      for (const role of roles) {
        expect(colors[role], `${c.name}.${role}`).toMatch(/^#[0-9A-F]{6}$/i);
      }
    }
  });
});

/**
 * The small-type inks.
 *
 * REPORT_RULES §2 sets 7:1 for everything below 14pt and forbids "a chromatic
 * accent at full saturation" below 10pt — and the shell sets running heads and
 * folios at 5.9–6.2pt and eyebrows at 5.8–6.8pt. Measured against that floor,
 * the approved `muted` clears it in 0 of 100 colourways and the approved
 * `accent` in 40 of 100.
 *
 * The approved values are not the thing to change: they are design decisions
 * taken in Claude Design and the block above exists to keep them byte-identical.
 * So the small sizes get a DERIVED ink, which is what §2 asks for in as many
 * words — "derive it, don't hardcode a second gold".
 */
describe('small-type inks are derived, not approved', () => {
  const all = Object.entries(COLOURWAYS_BY_FAMILY)
    .flatMap(([key, set]) => set.map((c) => [`${key} / ${c.name}`, c] as const));

  it.each(all)('%s reaches the small-type floor', (_label, colourway) => {
    const r = resolveColourway(colourway);
    expect(contrastRatio(r.mutedInk, r.surface)).toBeGreaterThanOrEqual(PRINT_SMALL_TYPE_CONTRAST);
    expect(contrastRatio(r.accentInk, r.surface)).toBeGreaterThanOrEqual(PRINT_SMALL_TYPE_CONTRAST);
  });

  it.each(all)('%s moves lightness only', (_label, colourway) => {
    const r = resolveColourway(colourway);
    for (const [src, out] of [[r.muted, r.mutedInk], [r.primary, r.accentInk]] as const) {
      const a = hexToHsl(src);
      const b = hexToHsl(out);
      // Hue is meaningless below ~20% saturation and 8-bit rounding swings it
      // freely there, so the assertion is scoped to the colours where a hue
      // shift would actually be a change of colour. Measured max: 0.7°.
      if (a.s >= 20) {
        const drift = Math.min(Math.abs(a.h - b.h), 360 - Math.abs(a.h - b.h));
        expect(drift, `${src} -> ${out} hue`).toBeLessThanOrEqual(1);
        expect(Math.abs(a.s - b.s), `${src} -> ${out} saturation`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('leaves the approved value untouched when it already clears the floor', () => {
    // Not hypothetical: 40 of the 100 accents already pass, and for those the
    // derived ink must be the approved hex itself rather than a re-rounded
    // near-miss.
    const passthrough = '#000000';
    expect(toPrintContrast(passthrough, '#FFFFFF', PRINT_SMALL_TYPE_CONTRAST)).toBe(passthrough);

    let untouched = 0;
    for (const [, colourway] of all) {
      const r = resolveColourway(colourway);
      if (contrastRatio(r.primary, r.surface) >= PRINT_SMALL_TYPE_CONTRAST) {
        expect(r.accentInk).toBe(r.primary);
        untouched += 1;
      }
    }
    expect(untouched).toBeGreaterThan(0);
  });

  it('never has to fall all the way to black or white', () => {
    // If a derivation bottoms out, the hue is gone and the page has a black
    // eyebrow where a gold one was designed. No approved colourway does this,
    // and this is what says so.
    for (const [label, colourway] of all) {
      const r = resolveColourway(colourway);
      expect([r.mutedInk, r.accentInk], label).not.toContain('#000000');
      expect([r.mutedInk, r.accentInk], label).not.toContain('#FFFFFF');
    }
  });

  it('carries every derived ink into the token map the templates bind', () => {
    const colours = colourwayColors(PRIVATE_BANKING_COLOURWAYS[0]);
    expect(colours.mutedInk).toBeTruthy();
    expect(colours.mutedOnField).toBeTruthy();
    expect(colours.accentInk).toBeTruthy();
    expect(colours.accentOnField).toBeTruthy();
  });

  /**
   * The cover eyebrow was being printed in the colour of the ground under it.
   *
   * Six approved colourways are deliberately monochrome and set `accent` to the
   * same hex as `ink`. On a light-ground colourway the cover field IS the ink,
   * so on any family whose cover uses that field the eyebrow — the brand's own
   * strongest marker — came out at 1.00:1. Nobody saw it because no investment
   * report has ever rendered through this system.
   */
  it.each(all)('%s keeps the cover eyebrow off its own ground', (_label, colourway) => {
    const r = resolveColourway(colourway);
    expect(contrastRatio(r.accentOnField, r.bg)).toBeGreaterThanOrEqual(PRINT_SMALL_TYPE_CONTRAST);
  });

  /**
   * The cover's quiet type is not the hairline colour.
   *
   * The shell had no muted role for the field, so the standfirst, the locations
   * line, the KPI labels, the tagline and the cover marker all fell back to
   * `token:line`. A rule is drawn to be quiet against the page and type has to
   * be read: as type on the field, `line` is below 4.5:1 in 42 of the 100
   * colourways and bottoms out at 1.20:1 on the dark grounds, where the field
   * IS the dark paper and the rule is a hairline drawn to disappear into it.
   */
  it.each(all)('%s sets cover muted type above the hairline', (_label, colourway) => {
    const r = resolveColourway(colourway);
    expect(contrastRatio(r.mutedOnField, r.bg)).toBeGreaterThanOrEqual(PRINT_SMALL_TYPE_CONTRAST);
    // Where the hairline actually failed as type, the replacement must be
    // better. It is not universally brighter and should not be: on a
    // light-ground colourway the rule is a pale beige that reads at 10.8:1 on
    // obsidian, which is primary-text contrast for what the shell calls the
    // MUTED role. Deriving from `muted` makes it quiet on purpose and legible
    // by construction, instead of loud by accident on half the palettes and
    // invisible on the other half.
    if (contrastRatio(r.line, r.bg) < PRINT_SMALL_TYPE_CONTRAST) {
      expect(contrastRatio(r.mutedOnField, r.bg))
        .toBeGreaterThan(contrastRatio(r.line, r.bg));
    }
  });

  it('names the monochrome colourways this was found on', () => {
    // Regression anchor: if a future catalogue stops shipping an accent equal
    // to its ink, this is the test that says the hazard is gone rather than
    // leaving a derivation nobody can explain.
    const monochrome = all.filter(([, c]) => {
      const r = resolveColourway(c);
      return contrastRatio(r.primary, r.bg) < 1.05;
    });
    expect(monochrome.length).toBeGreaterThan(0);
    for (const [label, c] of monochrome) {
      const r = resolveColourway(c);
      // The approved value is untouched…
      expect(r.primary, label).toBe(c.accent);
      // …and the derived one is visible.
      expect(contrastRatio(r.accentOnField, r.bg), label).toBeGreaterThanOrEqual(PRINT_SMALL_TYPE_CONTRAST);
    }
  });
});

describe('the derivations hold for all one hundred approved colourways', () => {
  const all = Object.entries(COLOURWAYS_BY_FAMILY)
    .flatMap(([key, set]) => set.map((c) => [`${key} / ${c.name}`, c] as const));

  it('covers ten families', () => {
    expect(Object.keys(COLOURWAYS_BY_FAMILY)).toHaveLength(10);
    expect(all).toHaveLength(100);
  });

  it.each(all)('%s', (_label, colourway) => {
    const r = resolveColourway(colourway);

    // Body copy on paper, at the WCAG AA floor. These are printed client
    // documents, so this is a floor rather than a target — and it is the one
    // derivation that would be invisible on a bright screen and unreadable in
    // an office.
    expect(contrastRatio(r.ink, r.surface)).toBeGreaterThanOrEqual(4.5);
    // Type on the cover field.
    expect(contrastRatio(r.text, r.bg)).toBeGreaterThanOrEqual(4.5);
    // Type on an accent fill. The accents run from #22406E to #F5F5F5 across
    // the catalogue, so a fixed black or white is illegible at one end.
    expect(contrastRatio(r.onPrimary, r.primary)).toBeGreaterThanOrEqual(3);
    // Muted labels stay readable rather than becoming decoration.
    expect(contrastRatio(r.muted, r.surface)).toBeGreaterThanOrEqual(3);
    // A panel is separated from the page but is not a block of colour.
    expect(r.panel).not.toBe(r.surface);
    expect(contrastRatio(r.panel, r.surface)).toBeLessThan(1.6);
    // Negative figures must survive the ground they print on — this is the
    // sign on a cash-flow line, the most-read thing on the page.
    expect(contrastRatio(r.negative, r.surface)).toBeGreaterThanOrEqual(4);
  });

  it('keeps semantic colours off the palette in every family', () => {
    for (const [, colourway] of all) {
      const r = resolveColourway(colourway);
      const fixed = colourway.ground === 'dark' ? SEMANTIC_COLOURS.dark : SEMANTIC_COLOURS.light;
      expect(r.positive).toBe(fixed.positive);
      expect(r.caution).toBe(fixed.caution);
      expect(r.negative).toBe(fixed.negative);
      expect(r.info).toBe(fixed.info);
    }
  });

  it('inverts field and paper consistently across grounds', () => {
    for (const [label, colourway] of all) {
      const r = resolveColourway(colourway);
      if (colourway.ground === 'light') {
        expect(r.bg, label).toBe(colourway.ink);
        expect(r.text, label).toBe(colourway.paper);
      } else {
        expect(r.bg, label).toBe(colourway.paper);
        expect(r.text, label).toBe(colourway.ink);
      }
    }
  });
});

describe('applying a colourway', () => {
  const schema = {
    version: 1,
    name: 'Chancery',
    tokens: { colors: { primary: '#000000', custom: '#123456' }, fonts: { body: 'Inter' } },
    pages: [{ id: 'p1', blocks: [] }],
  };

  it('replaces the colour roles and leaves everything else alone', () => {
    const cw = findColourway('private_banking', 'pb-midnight-navy')!;
    const next = applyColourwayToSchema(schema, cw) as any;
    expect(next.tokens.colors.primary).toBe(cw.accent);
    expect(next.tokens.fonts.body).toBe('Inter');
    expect(next.pages).toEqual(schema.pages);
    expect(next.name).toBe('Chancery');
  });

  it('keeps colour keys the colourway does not define', () => {
    const cw = findColourway('private_banking', 'pb-verde')!;
    const next = applyColourwayToSchema(schema, cw) as any;
    expect(next.tokens.colors.custom).toBe('#123456');
  });

  it('never mutates the entry it was given', () => {
    // The caller's copy is the published library entry. Mutating it would let
    // one preview change what the next reader sees.
    const cw = findColourway('private_banking', 'pb-oxblood')!;
    const before = JSON.stringify(schema);
    applyColourwayToSchema(schema, cw);
    expect(JSON.stringify(schema)).toBe(before);
  });

  it('passes a non-object schema through untouched', () => {
    const cw = PRIVATE_BANKING_COLOURWAYS[0];
    expect(applyColourwayToSchema(null, cw)).toBeNull();
    expect(applyColourwayToSchema('nope', cw)).toBe('nope');
  });

  it('produces a token override the renderer can merge', () => {
    const cw = findColourway('private_banking', 'pb-platinum')!;
    const override = colourwayTokenOverride(cw);
    expect(Object.keys(override)).toEqual(['colors']);
    expect(override.colors.primary).toBe(cw.accent);
  });
});

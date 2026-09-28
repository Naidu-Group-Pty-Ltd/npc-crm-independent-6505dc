/**
 * The report's lead photograph on the covers the catalogue drew without one.
 *
 * Five of the fifty Investment masters were designed around photographs. The
 * other forty-five had nowhere to put one. Since seed v21 the field and banded
 * covers carry it; since seed v24 it is shown WHOLE (`withCoverPhotograph`):
 *   - a PLATE, `contain`, in the empty field between the head and the title,
 *     laid out once per title depth and chosen by the address's length, so it
 *     always stops short of a title that grows upward;
 *   - past the deepest plate — an address long enough to need the room — the
 *     v21 LAYER under the type: behind the whole sheet on a field cover, inside
 *     the band on a banded one, under two passes of the field's own scrim;
 *   - a PAPER cover is left as drawn.
 *
 * The v21 cover cropped every photograph: a 4:3 listing photograph set `cover`
 * into the 595×176pt band keeps about 40% of its height. The owner's read of a
 * real report (37 Bolin Street, 27 Sep 2026) was that it "has been cut halfway".
 *
 * Promises pinned here, because breaking any one would be seen by a client:
 *   - Without a photograph, a cover draws exactly what it drew before.
 *   - Beside a photograph, nothing on the cover moves.
 *   - For every address length exactly ONE of the photograph's forms draws.
 * Whether a plate ever meets the title is a question about set type, and is
 * answered in Chromium by `npm run templates:compass:cover-qa`.
 */
import { describe, expect, it } from 'vitest';
import { renderTemplateToHtml } from '@/lib/reportTemplate/htmlRenderer';
import { INVESTMENT_COMPASS_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/templates';
import { COVER_BAND_HEIGHT, PAGE } from '../../../../scripts/template-library/investmentCompass/blocks';
import { evalConditional } from '@/lib/reportTemplate/bindingResolver';
import { familyByKey, resolveManifest } from '../../../../scripts/template-library/investmentCompass/family';
import { coverPlan, imageSlotPlan } from '../../../../scripts/template-library/investmentCompass/resolvers';
import { SAMPLE_REPORT_DATA } from '../sampleReportData';

interface SchemaBlock { id: string; type: string; name?: string; conditional?: string; props: Record<string, unknown> }
interface Master {
  name: string;
  schema: { pages: Array<{ blocks: SchemaBlock[] }> };
  designMeta: { familyKey: string; templateCode: string };
}

const MASTERS = INVESTMENT_COMPASS_TEMPLATES as unknown as Master[];
const LEAD_PHOTOGRAPH = 'property && property.images && property.images[0]';

/** How the catalogue drew a master's cover: its ground, and whether it was photographic already. */
function coverOf(master: Master) {
  const family = familyByKey(master.designMeta.familyKey)!;
  const variant = family.variants.find((v) => v.code === master.designMeta.templateCode)!;
  const manifest = resolveManifest(family, variant);
  const slots = imageSlotPlan(manifest.image_slots);
  return {
    ground: coverPlan(manifest.cover_overlay).ground,
    designedWithPhotographs: slots.coverHero || slots.plates.length > 0,
  };
}

const bindsLeadPhotograph = (b: SchemaBlock) => (b.conditional ?? '').startsWith(LEAD_PHOTOGRAPH);
const PLATE = 'Cover photograph — the lead photograph, shown whole';
const isPlate = (b: SchemaBlock) => b.name === PLATE;
const isLayer = (b: SchemaBlock) => bindsLeadPhotograph(b) && !isPlate(b);
const coverBlocks = (master: Master) => master.schema.pages[0].blocks;
const withoutPhotograph = (() => {
  const property = { ...(SAMPLE_REPORT_DATA as { property: Record<string, unknown> }).property };
  delete property.images;
  return { ...SAMPLE_REPORT_DATA, property };
})();

/** Every absolutely positioned box on the rendered cover, in document order. */
function coverPositions(schema: unknown, data: Record<string, unknown>): string[] {
  const html = renderTemplateToHtml(schema as never, { data }).html;
  const start = html.indexOf('class="tpl-page tpl-page-0"');
  const end = html.indexOf('class="tpl-page tpl-page-1"', start + 1);
  return [...html.slice(start, end).matchAll(/position:absolute;left:([\d.]+)pt;(top|bottom):([\d.]+)pt;/g)]
    .map((m) => `${m[2]}:${m[3]}@${m[1]}`);
}

const FIELD = MASTERS.filter((m) => !coverOf(m).designedWithPhotographs && coverOf(m).ground === 'field');
const BANDED = MASTERS.filter((m) => !coverOf(m).designedWithPhotographs && coverOf(m).ground === 'band');
const PAPER = MASTERS.filter((m) => !coverOf(m).designedWithPhotographs && coverOf(m).ground === 'paper');
const PHOTOGRAPHIC = MASTERS.filter((m) => coverOf(m).designedWithPhotographs);

describe('which covers carry the lead photograph', () => {
  it('the forty-five covers drawn without photographs split 16 field, 18 banded and 11 paper', () => {
    expect(FIELD).toHaveLength(16);
    expect(BANDED).toHaveLength(18);
    expect(PAPER).toHaveLength(11);
    expect(PHOTOGRAPHIC).toHaveLength(5);
  });

  it('every field and banded cover carries the three-block layer and at least one plate; the paper covers carry none', () => {
    for (const m of [...FIELD, ...BANDED]) {
      expect(coverBlocks(m).filter(isLayer), m.name).toHaveLength(3);
      expect(coverBlocks(m).filter(isPlate).length, m.name).toBeGreaterThanOrEqual(1);
    }
    for (const m of PAPER) {
      expect(JSON.stringify(coverBlocks(m)), m.name).not.toContain('property.images');
    }
  });

  it('the five masters designed around photographs gain nothing', () => {
    for (const m of PHOTOGRAPHIC) {
      expect(coverBlocks(m).some((b) => b.name === 'Band scrim'), m.name).toBe(false);
      expect(coverBlocks(m).some(isPlate), m.name).toBe(false);
      // Atelier, Atelier Plate and Grand Folio already carry exactly one cover
      // photograph; Frontispiece and Elevation carry plates and no cover one.
      const expected = ['le-01', 'le-02', 'le-03'].includes(m.designMeta.templateCode) ? 2 : 0;
      expect(coverBlocks(m).filter(bindsLeadPhotograph), m.name).toHaveLength(expected);
    }
  });
});

describe('the plate — the photograph shown whole', () => {
  it('is contained, never cropped, and says it is a layer so nothing closes up into it', () => {
    for (const m of [...FIELD, ...BANDED]) {
      for (const plate of coverBlocks(m).filter(isPlate)) {
        expect(plate.type, m.name).toBe('image');
        expect(plate.props, m.name).toMatchObject({
          src: '{{property.images.0}}', fit: 'contain', placeholder: false, layer: true,
          alt: 'Photograph of the property',
        });
      }
    }
  });

  it('sits inside the margins, below the head, and nothing is drawn over it', () => {
    for (const m of [...FIELD, ...BANDED]) {
      const blocks = coverBlocks(m);
      const title = blocks.find((b) => b.name === 'Cover title')!;
      const locations = blocks.find((b) => b.name === 'Locations')!;
      for (const plate of blocks.filter(isPlate)) {
        const { x, y, width, height } = plate.props as Record<string, number>;
        expect(x, m.name).toBe(locations.props.x);
        expect(width, m.name).toBe(locations.props.width);
        if (coverOf(m).ground === 'band') expect(y, m.name).toBeGreaterThan(COVER_BAND_HEIGHT);
        expect(height, m.name).toBeGreaterThanOrEqual(130);
        // Above the title's foot, with at least one line of the title and its eyebrow between.
        expect(y + height, m.name).toBeLessThan(Number(title.props.anchorBottom) - Number(title.props.headingSize));
        // Painted last: no block after it on the cover.
        expect(blocks.indexOf(plate), m.name).toBeGreaterThanOrEqual(blocks.length - blocks.filter(isPlate).length);
      }
      // The deeper the title, the shallower the plate — each copy is laid out for one depth.
      const heights = blocks.filter(isPlate).map((b) => Number(b.props.height));
      expect([...heights].sort((p, q) => q - p), m.name).toEqual(heights);
    }
  });

  it('for every address length, exactly one form of the photograph draws', () => {
    for (const m of [...FIELD, ...BANDED]) {
      const blocks = coverBlocks(m);
      const plates = blocks.filter(isPlate);
      const layerImage = blocks.find((b) => isLayer(b) && b.type === 'image')!;
      for (let length = 1; length <= 120; length += 1) {
        const data = { property: { address: 'x'.repeat(length), images: ['lead.jpg'] } };
        const drawnPlates = plates.filter((b) => evalConditional(b.conditional!, { data } as never));
        const layerDraws = evalConditional(layerImage.conditional!, { data } as never);
        expect(drawnPlates.length + (layerDraws ? 1 : 0), `${m.name} at ${length} characters`).toBe(1);
      }
      // And nothing at all without a photograph.
      const none = { property: { address: 'x'.repeat(30) } };
      expect(blocks.filter(bindsLeadPhotograph).some((b) => evalConditional(b.conditional!, { data: none } as never)), m.name).toBe(false);
    }
  });
});

describe('where the layer sits, for an address no plate leaves room for', () => {
  it('on a field cover: under everything, the whole sheet, beneath two passes of the field\'s own scrim', () => {
    for (const m of FIELD) {
      const [image, scrim, second] = coverBlocks(m);
      expect(image.type, m.name).toBe('image');
      expect(image.props).toMatchObject({
        src: '{{property.images.0}}', fit: 'cover', placeholder: false,
        x: 0, y: 0, width: PAGE.width, height: PAGE.height,
      });
      expect(scrim).toMatchObject({ type: 'hero', name: 'Cover scrim' });
      expect(second).toMatchObject({ type: 'hero', name: 'Cover scrim, second pass' });
      // The field's own colour at the hero's tint, never a literal colour, and never opaque.
      for (const pass of [scrim, second]) {
        expect(pass.props).toMatchObject({ tint: 'token:bg', x: 0, y: 0, width: PAGE.width, height: PAGE.height });
        expect(pass.props.bg).toBeUndefined();
        expect(isLayer(pass)).toBe(true);
      }
    }
  });

  it('on a banded cover: inside the band, above its colour and beneath its type', () => {
    for (const m of BANDED) {
      const blocks = coverBlocks(m);
      const band = blocks.findIndex((b) => b.name === 'Cover band');
      expect(band, m.name).toBeGreaterThanOrEqual(0);
      expect(blocks[band].props.height).toBe(COVER_BAND_HEIGHT);
      const [image, scrim, second] = [blocks[band + 1], blocks[band + 2], blocks[band + 3]];
      expect(image.props).toMatchObject({
        src: '{{property.images.0}}', fit: 'cover', placeholder: false,
        x: 0, y: 0, width: PAGE.width, height: COVER_BAND_HEIGHT,
      });
      expect(scrim).toMatchObject({ type: 'hero', name: 'Band scrim' });
      expect(second).toMatchObject({ type: 'hero', name: 'Band scrim, second pass' });
      for (const pass of [scrim, second]) {
        expect(pass.props).toMatchObject({ tint: 'token:bg', x: 0, y: 0, width: PAGE.width, height: COVER_BAND_HEIGHT });
        expect(pass.props.bg).toBeUndefined();
      }
      expect([image, scrim, second].every(isLayer)).toBe(true);
      expect(blocks.slice(0, band).filter(bindsLeadPhotograph)).toEqual([]);
    }
  });
});

describe('PRESERVATION — a report without a photograph draws exactly the cover it drew before', () => {
  for (const m of [...FIELD, ...BANDED]) {
    it(`${m.designMeta.templateCode} ${m.name}`, () => {
      const stripped = {
        ...m.schema,
        pages: m.schema.pages.map((p, i) => (i === 0
          ? { ...p, blocks: p.blocks.filter((b) => !bindsLeadPhotograph(b)) }
          : p)),
      };
      const html = (schema: unknown) => renderTemplateToHtml(schema as never, { data: withoutPhotograph }).html;
      expect(html(m.schema)).toBe(html(stripped));
    });
  }
});

describe('beside a photograph, nothing on the cover moves', () => {
  for (const m of [...FIELD, ...BANDED]) {
    it(`${m.designMeta.templateCode} ${m.name}`, () => {
      const blocks = coverBlocks(m);
      const address = String((SAMPLE_REPORT_DATA as { property: { address: string } }).property.address);
      const data = { property: { address, images: ['x'] } };
      const plateDraws = blocks.filter(isPlate).some((b) => evalConditional(b.conditional!, { data } as never));
      const withPhotograph = coverPositions(m.schema, SAMPLE_REPORT_DATA);
      const without = coverPositions(m.schema, withoutPhotograph);
      if (plateDraws) {
        // One plate, painted last; every other box stands exactly where it stands without it.
        expect(withPhotograph.length - without.length).toBe(1);
        expect(withPhotograph.slice(0, -1)).toEqual(without);
      } else {
        // The layer: three boxes at the head of the sheet.
        expect(withPhotograph.length - without.length).toBe(3);
        const photographAt = coverOf(m).ground === 'field' ? 0 : 1;
        expect(withPhotograph.slice(photographAt, photographAt + 3)).toEqual(['top:0@0', 'top:0@0', 'top:0@0']);
        expect([...withPhotograph.slice(0, photographAt), ...withPhotograph.slice(photographAt + 3)]).toEqual(without);
      }
    });
  }

  it('a plate that is not chosen leaves the cover exactly as a cover without a photograph', () => {
    // The defect `layer: true` exists for: a dropped plate read as a hole lifted
    // the title and the fact band up the sheet by its height.
    for (const m of [...FIELD, ...BANDED]) {
      // Longer than any plate on any cover is laid out for, so every plate is dropped.
      const longAddress = 'Apartment 1204A, Waterline Residences, 145-149 Marine Parade, Kingscliff, NSW 2487, '.repeat(3);
      expect(coverBlocks(m).filter(isPlate).some((b) => evalConditional(b.conditional!, {
        data: { property: { address: longAddress, images: ['x'] } },
      } as never)), m.name).toBe(false);
      const withLong = (images: boolean) => {
        const property = { ...(SAMPLE_REPORT_DATA as { property: Record<string, unknown> }).property, address: longAddress };
        if (!images) delete property.images;
        return { ...SAMPLE_REPORT_DATA, property };
      };
      const html = (d: Record<string, unknown>) => renderTemplateToHtml(m.schema as never, { data: d }).html;
      const stripped = {
        ...m.schema,
        pages: m.schema.pages.map((p, i) => (i === 0 ? { ...p, blocks: p.blocks.filter((b) => !isPlate(b)) } : p)),
      };
      expect(html(withLong(true)), m.name).toBe(renderTemplateToHtml(stripped as never, { data: withLong(true) }).html);
    }
  });

  it('the photograph reaches the page it is bound on', () => {
    const [lead] = (SAMPLE_REPORT_DATA as { property: { images: string[] } }).property.images;
    for (const m of [...FIELD, ...BANDED]) {
      const html = renderTemplateToHtml(m.schema as never, { data: SAMPLE_REPORT_DATA }).html;
      const start = html.indexOf('class="tpl-page tpl-page-0"');
      const end = html.indexOf('class="tpl-page tpl-page-1"', start + 1);
      expect(html.slice(start, end), m.name).toContain(lead);
    }
  });
});

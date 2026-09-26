import { describe, expect, it, vi } from 'vitest';
import {
  balanceLines,
  fitIssuerName,
  isTemplateCoverOwner,
  standardCoverFor,
  standardDocumentMetadata,
} from '../standardCover.pure';
import { ISSUER_COVER_SIZE, issuerCoverLayout, issuerMarkSize } from '../investmentPdfCover';
import {
  loadStandardPresentationBrand,
  PLATFORM_COVER_MARK,
  type StandardPresentationBrandDeps,
} from '../standardPresentationBrand';
import { PLATFORM_ISSUER_NAME } from '@/lib/reports/issuerIdentity.pure';
import { resolveBrandFamily } from '@/lib/reportDesign/brandFamily.pure';

/**
 * Whose cover the standard presentation opens on.
 *
 * The template's first page is NPC's artwork. It opens NPC's document on NPC's
 * deployment and no other; every other document opens on a cover drawn for
 * the issuer its own settings resolve to.
 */
const workspace = (name: string) => ({ name, kind: 'workspace' as const });
const platform = { name: PLATFORM_ISSUER_NAME, kind: 'platform' as const };

describe('which cover', () => {
  it("keeps the artwork for NPC's own document on NPC's own deployment", () => {
    for (const name of [
      'Naidu Property Consulting Services',
      'NAIDU PROPERTY CONSULTING SERVICES PTY LTD',
      'Naidu Property Consulting',
      'NPC Services',
    ]) {
      expect(standardCoverFor(workspace(name), { prime: true })).toBe('template');
    }
  });

  it("never draws NPC's artwork on a clone, whatever name its rows carry", () => {
    expect(standardCoverFor(workspace('Naidu Property Consulting Services'), { prime: false })).toBe('issuer');
    expect(standardCoverFor(platform, { prime: false })).toBe('issuer');
  });

  it('follows the prime when it issues under anybody else', () => {
    expect(standardCoverFor(workspace('Harbour & Vine Property Advisory'), { prime: true })).toBe('issuer');
    expect(standardCoverFor(platform, { prime: true })).toBe('issuer');
  });

  it('reads a name by its words, not its punctuation or its legal form', () => {
    expect(isTemplateCoverOwner('  naidu   property consulting services. ')).toBe(true);
    expect(isTemplateCoverOwner('Naidu Property Consulting Services Limited')).toBe(true);
    expect(isTemplateCoverOwner('Naidu Property Consulting Services Group')).toBe(false);
    expect(isTemplateCoverOwner(null)).toBe(false);
  });

  it("says in the file who made it: NPC's words under its artwork, the issuer under its own cover", () => {
    expect(standardDocumentMetadata('template', workspace('Naidu Property Consulting Services'))).toEqual({
      author: 'NPC Services', creator: 'NPC Command Centre', producer: 'NPC Command Centre',
    });
    expect(standardDocumentMetadata('issuer', workspace('Coastline Realty'))).toEqual({
      author: 'Coastline Realty', creator: 'Coastline Realty', producer: 'Coastline Realty',
    });
    expect(standardDocumentMetadata('issuer', platform).author).toBe(PLATFORM_ISSUER_NAME);
  });
});

describe('the issuer, read from the deployment', () => {
  const deps = (over: Partial<StandardPresentationBrandDeps> = {}): StandardPresentationBrandDeps => ({
    loadOrganisation: vi.fn(async () => null),
    loadBrandMarks: vi.fn(async () => ({})),
    loadBrandColour: vi.fn(async () => null),
    prime: () => false,
    picture: vi.fn(async () => ({ bytes: new Uint8Array([1]), format: 'png' as const })),
    staticPicture: vi.fn(async () => ({ bytes: new Uint8Array([2]), format: 'png' as const })),
    ...over,
  });

  it('takes the report contact first, then the Branding page, then the platform — the resolver every surface uses', async () => {
    const organisation = async () => ({ company_name: 'Coastline Realty' });
    expect((await loadStandardPresentationBrand('Harbour & Vine', deps({ loadOrganisation: organisation }))).issuer)
      .toEqual(workspace('Harbour & Vine'));
    expect((await loadStandardPresentationBrand('', deps({ loadOrganisation: organisation }))).issuer)
      .toEqual(workspace('Coastline Realty'));
    expect((await loadStandardPresentationBrand('', deps())).issuer).toEqual(platform);
  });

  it("uses the knockout mark for the dark cover, and the platform's emblem for the platform", async () => {
    const withMarks = deps({ loadBrandMarks: vi.fn(async () => ({ mark: 'data:image/png;base64,AA==', markMono: 'data:image/png;base64,QQ==' })) });
    await loadStandardPresentationBrand('Coastline Realty', withMarks);
    expect(withMarks.picture).toHaveBeenCalledWith('data:image/png;base64,QQ==');

    const unbranded = deps();
    const brand = await loadStandardPresentationBrand('', unbranded);
    expect(unbranded.staticPicture).toHaveBeenCalledWith(PLATFORM_COVER_MARK);
    expect(unbranded.loadBrandMarks).not.toHaveBeenCalled();
    expect(brand.mark).not.toBeNull();
  });

  it("reads no marks at all for NPC's artwork cover", async () => {
    const npc = deps({ prime: () => true });
    const brand = await loadStandardPresentationBrand('Naidu Property Consulting Services', npc);
    expect(brand.cover).toBe('template');
    expect(npc.loadBrandMarks).not.toHaveBeenCalled();
    expect(brand.mark).toBeNull();
  });

  it('never throws: an unreadable setting resolves as an unset one, an unreadable mark is no mark', async () => {
    const broken = deps({
      loadOrganisation: async () => { throw new Error('offline'); },
      loadBrandMarks: async () => { throw new Error('offline'); },
      loadBrandColour: async () => { throw new Error('offline'); },
      prime: () => { throw new Error('unparseable'); },
    });
    const brand = await loadStandardPresentationBrand('Harbour & Vine', broken);
    expect(brand).toEqual({
      issuer: workspace('Harbour & Vine'),
      deployment: { prime: false },
      cover: 'issuer',
      mark: null,
      family: resolveBrandFamily(null),
    });
  });

  it("draws an issuer's pages in its brand colour's family, and a platform document in the platform's", async () => {
    const coloured = deps({ loadBrandColour: vi.fn(async () => '#1E3A8A') });
    const tenant = await loadStandardPresentationBrand('Coastline Realty', coloured);
    expect(tenant.family).toEqual(resolveBrandFamily('#1E3A8A'));
    expect(tenant.family?.source).toBe('tenant');

    // No colour on the Branding page: the platform's family under the tenant's own name.
    expect((await loadStandardPresentationBrand('Coastline Realty', deps())).family).toEqual(resolveBrandFamily(null));

    // No name at all: the platform issues, in the platform's colours, whatever colour a row holds.
    const unnamed = await loadStandardPresentationBrand('', deps({ loadBrandColour: vi.fn(async () => '#C62828') }));
    expect(unnamed.issuer).toEqual(platform);
    expect(unnamed.family).toEqual(resolveBrandFamily(null));
  });

  it("keeps the house colours for NPC's own document: no family is resolved and no colour is read", async () => {
    const npc = deps({ prime: () => true, loadBrandColour: vi.fn(async () => '#1E3A8A') });
    const brand = await loadStandardPresentationBrand('Naidu Property Consulting Services', npc);
    expect(brand.family).toBeNull();
    expect(npc.loadBrandColour).not.toHaveBeenCalled();
    expect(brand.deployment).toEqual({ prime: true });
  });

  it("never issues a clone's document under the house's name, whatever its rows say", async () => {
    const seeded = deps({ loadOrganisation: async () => ({ company_name: 'Coastline Realty' }) });
    expect((await loadStandardPresentationBrand('Naidu Property Consulting Services', seeded)).issuer)
      .toEqual(workspace('Coastline Realty'));
    expect((await loadStandardPresentationBrand('NPC Services Pty Ltd', deps())).issuer).toEqual(platform);
    // The prime reads every name as it always did.
    expect((await loadStandardPresentationBrand('Naidu Property Consulting Services', deps({ prime: () => true }))).issuer)
      .toEqual(workspace('Naidu Property Consulting Services'));
  });
});

describe("the issuer's name, set as a lockup", () => {
  // Times-Roman capitals average a little over 0.7 em; exact enough to hold the rules.
  const measure = (text: string, size: number) => text.length * size * 0.72;
  const MEASURE = 455.5;
  const widest = (lines: string[], size: number, tracking: number) =>
    Math.max(...lines.map((line) => measure(line, size) + tracking * (line.length - 1)));

  it('sets a short name on one line at a display size', () => {
    const setting = fitIssuerName('Coastline Realty', measure, MEASURE)!;
    expect(setting.lines).toEqual(['COASTLINE REALTY']);
    expect(setting.size).toBe(30);
  });

  it('breaks a long name into two lines, where the longer line is shortest', () => {
    const setting = fitIssuerName('Naidu Property Consulting Services', measure, MEASURE)!;
    expect(setting.lines).toEqual(['NAIDU PROPERTY', 'CONSULTING SERVICES']);
    expect(widest(setting.lines, setting.size, setting.tracking)).toBeLessThanOrEqual(MEASURE);
  });

  it('never breaks a word, never overruns the measure, and marks a name it had to shorten', () => {
    const absurd = Array.from({ length: 24 }, (_, i) => `Partner${i}`).join(' ');
    const setting = fitIssuerName(absurd, measure, MEASURE)!;
    expect(setting.lines.length).toBeLessThanOrEqual(3);
    expect(setting.size).toBe(16);
    expect(setting.lines[2].endsWith('...')).toBe(true);
    expect(widest(setting.lines, setting.size, setting.tracking)).toBeLessThanOrEqual(MEASURE);
    const words = absurd.toUpperCase().split(' ');
    for (const word of setting.lines.join(' ').replace(/\.\.\.$/, '').split(' ')) expect(words).toContain(word);
  });

  it('answers nothing for no name', () => {
    expect(fitIssuerName('   ', measure, MEASURE)).toBeNull();
  });

  it('never leaves one word stranded on the last line of a sentence', () => {
    const perChar = (line: string) => line.length * 5;
    const sentence = 'What the property is, what it costs to hold, and what the assessment concluded.';
    const lines = balanceLines(sentence, perChar, 330);
    expect(lines).toHaveLength(2);
    expect(lines.join(' ')).toBe(sentence);
    expect(Math.abs(lines[0].length - lines[1].length)).toBeLessThan(12);
    expect(balanceLines('Short line.', perChar, 330)).toEqual(['Short line.']);
    expect(balanceLines('', perChar, 330)).toEqual([]);
  });
});

describe("the issuer's cover, laid out", () => {
  const H = ISSUER_COVER_SIZE.height;
  const DIVIDER = H - 560.5;
  const BAND_TOP = H - 590;

  it("puts the divider and the photograph band exactly where the artwork cover has them", () => {
    const layout = issuerCoverLayout({ mark: null, name: { lines: 1, size: 30 } });
    expect(layout.divider.y).toBeCloseTo(DIVIDER, 6);
    expect(layout.band.y + layout.band.height).toBeCloseTo(BAND_TOP, 6);
    expect(layout.addressMiddle).toBeCloseTo((DIVIDER + BAND_TOP) / 2, 6);
    expect(layout.band.y).toBe(layout.frame.y);
  });

  it('keeps the tallest lockup — a mark and three lines of name — clear of the divider and the page top', () => {
    const mark = issuerMarkSize({ width: 600, height: 400 });
    const layout = issuerCoverLayout({ mark, name: { lines: 3, size: 16 } });
    expect(layout.mark!.y + layout.mark!.height).toBeLessThan(layout.frame.y + layout.frame.height - 40);
    const baselines = layout.nameBaselines;
    expect(baselines).toHaveLength(3);
    expect(layout.mark!.y).toBeGreaterThan(baselines[0] + 16);
    expect(baselines[2]).toBeGreaterThan(layout.rule.y);
    expect(layout.rule.y).toBeGreaterThan(layout.titleBaseline);
    expect(layout.titleBaseline).toBeGreaterThan(layout.divider.y + 12);
  });

  it('prints a mark no larger than its box, and never softer than 150dpi', () => {
    expect(issuerMarkSize({ width: 2000, height: 500 })).toEqual({ width: 220, height: 55 });
    const small = issuerMarkSize({ width: 96, height: 96 });
    expect(small.width).toBeCloseTo(96 * (72 / 150), 6);
  });
});

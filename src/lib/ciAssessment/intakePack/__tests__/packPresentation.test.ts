/**
 * The intake pack as a deployment hands it over (`packPresentation.ts`).
 *
 * Run over the approved files themselves — the same bytes `sourceDocuments.ts`
 * serves and `sourceDocuments.test.ts` pins — so every claim below is about
 * the document a client receives, not about a fixture. The claims:
 *
 *  - **the prime with no design is not touched at all** — nothing is read,
 *    nothing is re-zipped, and the approved file goes out as it always did;
 *  - **a clone's pack never names the house**, anywhere in the file, and says
 *    the clone's business where the house was — or the pack's OWN placeholder
 *    for that place where the clone names nobody, never the platform;
 *  - **a design moves the three brand colours and nothing else** — the cream
 *    "yours to fill in", the "required and still empty" highlight and every
 *    grey stay the approved file's, and no colour is less legible than the one
 *    it replaced, in any design the catalogue offers;
 *  - **the form still works** — every part not named for a change is carried
 *    across byte for byte, and the workbook reads back through the app's own
 *    parser exactly as the approved one does.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  PACK_BRAND_COLOURS,
  PACK_HOUSE_NAME,
  PACK_PLACEHOLDER,
  PackStillNamesTheHouse,
  handsOverApprovedFile,
  packBrandColours,
  presentPackDocument,
  renameInHeadersAndFooters,
  type PackPresentation,
} from '../packPresentation';
import { parseIntakeFile } from '../parseWorkbook';
import { drawnDesignOf, type DrawnDocumentDesign } from '@/lib/reportDesign/drawnDesign.pure';
import {
  catalogueColourways,
  catalogueDesigns,
  resolveCatalogueDesign,
} from '@/lib/reportDesign/templateDesign.pure';
import { contrastRatio } from '@/lib/reportDesign/color.pure';
import { namesTheHouse } from '@/lib/reports/issuerIdentity.pure';

const ASSETS = resolve(__dirname, '../../../../assets/intakePack');
const WORKBOOK = readFileSync(resolve(ASSETS, 'CommercialIndustrialFinanceIntakeWorkbook.xlsx'));
const GUIDE = readFileSync(resolve(ASSETS, 'CommercialIndustrialFinanceIntakePack.docx'));
const EXAMPLE_WORKBOOK = readFileSync(resolve(ASSETS, 'CommercialIndustrialFinanceIntakeWorkbookMOCKDATA.xlsx'));

const WHITE = '#FFFFFF';

function design(code: string, colourway: string): DrawnDocumentDesign {
  const resolved = resolveCatalogueDesign({ code, colourway });
  if (resolved.ok === false) throw new Error(`${code} × ${colourway}: ${resolved.reason}`);
  return drawnDesignOf(resolved.design);
}

/** Every catalogue design in every colourway of its family. */
function everyDesign(): Array<[string, DrawnDocumentDesign]> {
  const out: Array<[string, DrawnDocumentDesign]> = [];
  for (const variant of catalogueDesigns()) {
    for (const colourway of catalogueColourways(variant.familyKey)) {
      out.push([`${variant.code} × ${colourway.id}`, design(variant.code, colourway.id)]);
    }
  }
  return out;
}

const NAVY = (() => {
  const all = everyDesign();
  return all.find(([, d]) => d.family.accent !== `#${PACK_BRAND_COLOURS.accent}`)![1];
})();

/** Every part of a file, as text, keyed by name. */
async function parts(bytes: Uint8Array | Buffer): Promise<Map<string, string>> {
  const zip = await JSZip.loadAsync(bytes);
  const out = new Map<string, string>();
  for (const entry of Object.values(zip.files)) {
    if (!entry.dir) out.set(entry.name, await entry.async('string'));
  }
  return out;
}

async function present(bytes: Buffer, kind: 'workbook' | 'guide', presentation: PackPresentation) {
  const out = await presentPackDocument(bytes, kind, presentation);
  if (!out) throw new Error('expected a prepared copy');
  return out;
}

const words = (xml: string) => xml.replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ');

const sheetFooters = (all: Map<string, string>) => [...all.entries()]
  .filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
  .map(([, xml]) => /<oddFooter>([\s\S]*?)<\/oddFooter>/.exec(xml)?.[1] ?? '');

const APPROVED_WORKBOOK_PARTS = await parts(WORKBOOK);
const APPROVED_GUIDE_PARTS = await parts(GUIDE);

describe('the approved files this is measured on', () => {
  it('name the house in the places the module names', () => {
    expect(words(APPROVED_WORKBOOK_PARTS.get('xl/sharedStrings.xml')!))
      .toContain(`The client consents to ${PACK_HOUSE_NAME} collecting`);
    expect(sheetFooters(APPROVED_WORKBOOK_PARTS)).toHaveLength(12);
    sheetFooters(APPROVED_WORKBOOK_PARTS).forEach((footer) => expect(footer).toContain(PACK_HOUSE_NAME));
    expect(words(APPROVED_GUIDE_PARTS.get('word/document.xml')!)).toContain(`Completed by (${PACK_HOUSE_NAME})`);
    for (const all of [APPROVED_WORKBOOK_PARTS, APPROVED_GUIDE_PARTS]) {
      expect(all.get('docProps/core.xml')).toContain(`<dc:creator>${PACK_HOUSE_NAME}</dc:creator>`);
      expect(all.get('docProps/core.xml')).not.toContain('<cp:lastModifiedBy></cp:lastModifiedBy>');
    }
  });

  it('already use the placeholders a clone with no name falls back to, in the parallel places', () => {
    // Quoted, not composed: the guide's consent and the workbook's sign-off.
    expect(words(APPROVED_GUIDE_PARTS.get('word/document.xml')!))
      .toContain(`The client consents to ${PACK_PLACEHOLDER.consent} collecting`);
    expect(words(APPROVED_WORKBOOK_PARTS.get('xl/sharedStrings.xml')!))
      .toContain(`Completed by (${PACK_PLACEHOLDER.signOff})`);
  });
});

describe('the prime, with no design chosen', () => {
  it('hands over the approved file — nothing is read and nothing is re-zipped', async () => {
    expect(handsOverApprovedFile({})).toBe(true);
    expect(handsOverApprovedFile({ design: null })).toBe(true);
    const out = await presentPackDocument(WORKBOOK, 'workbook', {}, () => {
      throw new Error('the zip library must not even be loaded');
    });
    expect(out).toBeNull();
  });
});

describe('a clone that names its business', () => {
  const NAME = 'Harbour & Vine Advisory';

  it('is named in the consent clause, every sheet footer and the sign-off, and never the house', async () => {
    const workbook = await parts(await present(WORKBOOK, 'workbook', { issuerName: NAME }));
    expect(words(workbook.get('xl/sharedStrings.xml')!)).toContain(`The client consents to ${NAME} collecting`);
    for (const footer of sheetFooters(workbook)) {
      // `&` opens a formatting code in a footer, so a literal one is doubled.
      expect(footer).toContain('&amp;K808080Harbour &amp;&amp; Vine Advisory  ·  Confidential&amp;R');
    }
    const guide = await parts(await present(GUIDE, 'guide', { issuerName: NAME }));
    expect(words(guide.get('word/document.xml')!)).toContain(`Completed by (${NAME})`);
    // What the approved guide leaves for the adviser to fill, a clone leaves too.
    expect(words(guide.get('word/document.xml')!))
      .toContain(`The client consents to ${PACK_PLACEHOLDER.consent} collecting`);

    for (const all of [workbook, guide]) {
      for (const [name, xml] of all) {
        if (!/\.(xml|rels)$/.test(name)) continue;
        expect(namesTheHouse(words(xml)), name).toBe(false);
        expect(xml, name).not.toMatch(/Naidu/);
      }
      expect(all.get('docProps/core.xml')).toContain('<dc:creator>Harbour &amp; Vine Advisory</dc:creator>');
      expect(all.get('docProps/core.xml')).toContain('<cp:lastModifiedBy></cp:lastModifiedBy>');
    }
  });
});

describe('a clone that names nobody', () => {
  it("uses the pack's own placeholders — never the platform, which is nobody's adviser", async () => {
    const workbook = await parts(await present(WORKBOOK, 'workbook', { issuerName: null }));
    expect(words(workbook.get('xl/sharedStrings.xml')!))
      .toContain(`The client consents to ${PACK_PLACEHOLDER.consent} collecting`);
    for (const footer of sheetFooters(workbook)) {
      expect(footer).toContain('&amp;K808080Confidential&amp;R');
    }
    const guide = await parts(await present(GUIDE, 'guide', { issuerName: null }));
    expect(words(guide.get('word/document.xml')!)).toContain(`Completed by (${PACK_PLACEHOLDER.signOff})`);
    for (const all of [workbook, guide]) {
      for (const xml of all.values()) expect(xml).not.toMatch(/Naidu|Aurixa/);
      expect(all.get('docProps/core.xml')).toContain('<dc:creator></dc:creator>');
    }
  });

  it('keeps a footer inside the limit Excel sets, by leaving a name out that would break it', () => {
    const footer = '<oddFooter>&amp;L&amp;8 &amp;K808080Naidu Property Consulting Services  ·  Confidential&amp;R&amp;8 &amp;A</oddFooter>';
    expect(renameInHeadersAndFooters(footer, 'x'.repeat(300)))
      .toBe('<oddFooter>&amp;L&amp;8 &amp;K808080Confidential&amp;R&amp;8 &amp;A</oddFooter>');
  });
});

describe('only what is named changes', () => {
  it.each([
    ['workbook', WORKBOOK, APPROVED_WORKBOOK_PARTS, ['xl/sharedStrings.xml', 'docProps/core.xml', 'xl/styles.xml']],
    ['guide', GUIDE, APPROVED_GUIDE_PARTS, ['word/document.xml', 'word/header1.xml', 'word/footer1.xml', 'docProps/core.xml']],
  ] as const)('%s: every other part is carried across byte for byte', async (kind, bytes, approved, named) => {
    const out = await parts(await present(bytes, kind, { issuerName: 'Harbour Advisory', design: NAVY }));
    expect([...out.keys()]).toEqual([...approved.keys()]);
    for (const [name, xml] of approved) {
      const rewritable = named.includes(name as never) || /^xl\/worksheets\/sheet\d+\.xml$/.test(name);
      if (!rewritable) expect(out.get(name), name).toBe(xml);
    }
  });

  it('reads back through the app\'s own parser exactly as the approved workbook does', async () => {
    const cases: Array<[Buffer, PackPresentation]> = [
      [WORKBOOK, { issuerName: 'Harbour Advisory' }],
      [WORKBOOK, { issuerName: null }],
      [WORKBOOK, { design: NAVY }],
      [WORKBOOK, { issuerName: 'Harbour Advisory', design: NAVY }],
      // The worked example has every sheet filled in, so it proves the answers
      // survive a recolour. It is never renamed: it is viewed, never handed
      // over, and its own reference ("NPC-CIF-TEST-…") is refused by the
      // clone's guard, as anything reading like the house must be.
      [EXAMPLE_WORKBOOK, { design: NAVY }],
    ];
    // The parse stamps when it read each field; that is the one thing two
    // reads of the same file may not share.
    const read = (buffer: ArrayBuffer) => JSON.parse(JSON.stringify(parseIntakeFile(buffer),
      (key, value) => (key === 'capturedAt' ? undefined : value)));
    for (const [bytes, presentation] of cases) {
      const approved = read(new Uint8Array(bytes).buffer);
      const out = await present(bytes, 'workbook', presentation);
      expect(read(out.slice().buffer)).toEqual(approved);
    }
    expect(parseIntakeFile(new Uint8Array(EXAMPLE_WORKBOOK).buffer).counts.tenancies).toBeGreaterThan(0);
  });
});

describe('a design', () => {
  const COUNT = (xml: string, hex: string) => (xml.match(new RegExp(`"(?:FF)?${hex}"`, 'gi')) ?? []).length;

  it('moves the three brand colours everywhere they are used as a style, and nothing else', async () => {
    const mapped = packBrandColours(NAVY);
    const workbook = await parts(await present(WORKBOOK, 'workbook', { design: NAVY }));
    const styles = workbook.get('xl/styles.xml')!;
    const approvedStyles = APPROVED_WORKBOOK_PARTS.get('xl/styles.xml')!;
    const section = (xml: string, tag: string) => new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`).exec(xml)?.[0] ?? '';
    for (const tag of ['fonts', 'fills', 'borders']) {
      for (const role of Object.keys(PACK_BRAND_COLOURS) as Array<keyof typeof PACK_BRAND_COLOURS>) {
        const before = COUNT(section(approvedStyles, tag), PACK_BRAND_COLOURS[role]);
        expect(COUNT(section(styles, tag), PACK_BRAND_COLOURS[role]), `${tag} ${role}`).toBe(0);
        expect(COUNT(section(styles, tag), mapped[role]), `${tag} ${role}`).toBeGreaterThanOrEqual(before);
      }
    }
    // Excel's palette and the conditional highlight are not brand.
    expect(section(styles, 'colors')).toBe(section(approvedStyles, 'colors'));
    expect(section(styles, 'dxfs')).toBe(section(approvedStyles, 'dxfs'));
    // The meanings stay: cream is "yours to fill in", and the greys are the greys.
    for (const kept of ['FDF1DC', 'FFFDF7', 'FBFAF7', 'F4F0E8', 'E8E3D9', 'D8D0C2', '6B7280', '1F2937', '9A6B12']) {
      expect(COUNT(styles, kept), kept).toBe(COUNT(approvedStyles, kept));
    }
    for (const [name, xml] of workbook) {
      if (!/^xl\/worksheets\//.test(name)) continue;
      expect(xml).not.toMatch(new RegExp(`tabColor rgb="FF(${Object.values(PACK_BRAND_COLOURS).join('|')})"`));
    }

    const guide = await parts(await present(GUIDE, 'guide', { design: NAVY }));
    for (const part of ['word/document.xml', 'word/header1.xml', 'word/footer1.xml']) {
      for (const hex of Object.values(PACK_BRAND_COLOURS)) expect(COUNT(guide.get(part)!, hex), `${part} ${hex}`).toBe(0);
      for (const kept of ['FBFAF7', 'F4F0E8', 'E8E3D9', 'D8D0C2', '6B7280', 'FFFFFF']) {
        expect(COUNT(guide.get(part)!, kept), `${part} ${kept}`).toBe(COUNT(APPROVED_GUIDE_PARTS.get(part)!, kept));
      }
    }
  });

  it('leaves the house named on the prime: a design changes how the pack looks, never whose it is', async () => {
    const workbook = await parts(await present(WORKBOOK, 'workbook', { design: NAVY }));
    expect(words(workbook.get('xl/sharedStrings.xml')!)).toContain(`The client consents to ${PACK_HOUSE_NAME} collecting`);
    expect(workbook.get('docProps/core.xml')).toBe(APPROVED_WORKBOOK_PARTS.get('docProps/core.xml'));
  });

  it.each(everyDesign())('%s: no colour is less legible than the approved one, and the hint is as faint', (_id, d) => {
    const mapped = packBrandColours(d);
    const approved = (role: keyof typeof PACK_BRAND_COLOURS) => contrastRatio(`#${PACK_BRAND_COLOURS[role]}`, WHITE);
    expect(contrastRatio(`#${mapped.deep}`, WHITE)).toBeGreaterThanOrEqual(approved('deep') - 0.005);
    expect(contrastRatio(`#${mapped.accent}`, WHITE)).toBeGreaterThanOrEqual(approved('accent') - 0.005);
    // White type sits on the deep band and on the one accent band.
    expect(contrastRatio(WHITE, `#${mapped.deep}`)).toBeGreaterThanOrEqual(approved('deep') - 0.005);
    // A hint as dark as an answer reads as one: at least as legible, and no more.
    const hint = contrastRatio(`#${mapped.hint}`, WHITE);
    expect(hint).toBeGreaterThanOrEqual(approved('hint') - 0.005);
    expect(hint).toBeLessThan(approved('hint') + 0.15);
  });
});

describe('a name the pack has to carry safely', () => {
  /** Whether a part still parses as XML. A malformed one is a file Word or Excel calls corrupt. */
  const wellFormed = (xml: string) => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    return doc.getElementsByTagName('parsererror').length === 0;
  };

  // Each of these broke the files in the audit before this shipped: a string
  // replacement expands `$&`, `$'` and `` $` ``, and a control character is
  // not allowed in an XML document at all.
  it.each([
    ['Evil $` Co', 'Evil $` Co'],
    ["Evil $' Co", "Evil $' Co"],
    ['Evil $& Co', 'Evil $& Co'],
    ['Evil $$ Co', 'Evil $$ Co'],
    ['Harbour\u0001 Advisory', 'Harbour Advisory'],
    ['Harbour￾ Advisory', 'Harbour Advisory'],
    ['Harbour\uD800 Advisory', 'Harbour Advisory'],
    ['  Harbour \n\t Advisory  ', 'Harbour Advisory'],
  ])('%j is carried as %j, and every part still parses', async (name, carried) => {
    for (const [bytes, kind] of [[WORKBOOK, 'workbook'], [GUIDE, 'guide']] as const) {
      const all = await parts(await present(bytes, kind, { issuerName: name }));
      for (const [part, xml] of all) {
        if (!/\.(xml|rels)$/.test(part)) continue;
        expect(wellFormed(xml), `${kind} ${part}`).toBe(true);
      }
      const creator = /<dc:creator>([\s\S]*?)<\/dc:creator>/.exec(all.get('docProps/core.xml')!)?.[1] ?? '';
      expect(words(creator.replace(/&apos;/g, "'").replace(/&quot;/g, '"')).trim()).toBe(carried);
    }
  });

  it.each([
    ['longer than any business name', `Harbour ${'x'.repeat(500)}`],
    ['made only of what XML refuses', '\u0001\u0002'],
  ])('reads a name %s as nobody named, never cut short', async (_label, name) => {
    const guide = await parts(await present(GUIDE, 'guide', { issuerName: name }));
    expect(guide.get('docProps/core.xml')).toContain('<dc:creator></dc:creator>');
    expect(words(guide.get('word/document.xml')!)).toContain(`Completed by (${PACK_PLACEHOLDER.signOff})`);
    expect(guide.get('word/document.xml')).not.toContain('xxxxxxxxxx');
  });
});

describe('what cannot happen', () => {
  it('a clone is never handed a pack that still names the house', async () => {
    const zip = await JSZip.loadAsync(GUIDE);
    const app = await zip.file('docProps/app.xml')!.async('string');
    zip.file('docProps/app.xml', app.replace('<Company></Company>', '<Company>NPC Services</Company>'));
    const tampered = await zip.generateAsync({ type: 'uint8array' });
    await expect(presentPackDocument(tampered, 'guide', { issuerName: 'Harbour Advisory' }))
      .rejects.toBeInstanceOf(PackStillNamesTheHouse);
  });
});

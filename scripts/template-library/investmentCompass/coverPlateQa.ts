/**
 * The cover photograph plate — measured, not modelled.
 *
 * `coverPlates` lays the plate out once per title depth and picks one by the
 * address's length, using the same character-advance model the title uses.
 * That model counts characters; a title wraps at WORDS. So the only honest
 * check that a plate never meets the title is to set the title in the face it
 * ships in, at the longest address each plate is chosen for, and look at the
 * boxes.
 *
 * For every master that draws the plate, and for every plate it carries, this
 * renders the cover at that plate's `maxChars` with five differently-worded
 * addresses of exactly that length, then asserts:
 *   - exactly one plate image is drawn, and
 *   - no text on the cover intersects it.
 * It also renders one address a character past the deepest plate and asserts
 * no plate is drawn at all (the photograph falls back to the layer under the
 * type).
 *
 * `templates:compass:qa` cannot see this: its collision measure skips the
 * cover, and its one address is the corpus maximum, which chooses no plate.
 *
 * Run:  npm run templates:compass:cover-qa
 */
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { renderTemplateToHtml } from '../../../src/lib/reportTemplate/htmlRenderer';
import { SAMPLE_REPORT_DATA } from '../../../src/lib/templateLibrary/sampleReportData';
import { INVESTMENT_COMPASS_TEMPLATES } from './templates';

const A4_PX = { width: 794, height: 1123 };
const PLATE_BRIEF = 'Cover photograph — the lead photograph, shown whole';

/**
 * Five ways an address of a given length can be worded. Cut to the length
 * required, so each is exactly that many characters; they differ in where the
 * long words fall, which is what decides how early a line breaks.
 */
const WORDINGS = [
  "Apartment 1204A, 'Waterline Residences', 145-149 Marine Parade, Kingscliff, NSW 2487, Tweed Shire Coast",
  '37 Bolin Street (Tallawong), Schofields NSW 2762, Blacktown City Council, North West Growth Area Precinct',
  'Lot 2267 Hunza Road, Truganina VIC 3029, Harpley Estate Werribee, Cranbourne East, Wyndham City Council',
  'Unit 12/45-47 Macquarie Street, Parramatta NSW 2150, Cumberland Highway Westmead Northmead Constitution Hill',
  'Lot 1037 Cloverton Boulevard, Kalkallo, Victoria 3064, Beveridge Mickleham Donnybrook Wollert Craigieburn',
];

function addressOf(length: number, wording: string): string {
  let text = wording;
  while (text.length < length) text = `${text} ${wording}`;
  return text.slice(0, length).trimEnd().padEnd(length, 'x');
}

function findChromium(): string | undefined {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!existsSync(root)) return undefined;
  return readdirSync(root)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort()
    .reverse()
    .map((name) => resolve(root, name, 'chrome-linux/chrome'))
    .find((path) => existsSync(path));
}

interface SchemaBlock { name?: string; conditional?: string; props: Record<string, unknown> }

function withAddress(address: string): Record<string, unknown> {
  const data = SAMPLE_REPORT_DATA as unknown as Record<string, unknown>;
  return { ...data, property: { ...(data.property as Record<string, unknown>), address }, property_address: address };
}

async function main(): Promise<void> {
  const executablePath = findChromium();
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const context = await browser.newContext({ viewport: A4_PX });
  // The faces are read from the machine (see `assertDeclaredFacesResolve` in
  // qa.ts); a stylesheet request that cannot complete would only stall the
  // load. A plate's BOX is what is measured, so no image needs to arrive.
  await context.route(/^https?:/, (route) => route.abort());
  const failures: string[] = [];
  let measured = 0;
  let mastersWithPlates = 0;

  for (const master of INVESTMENT_COMPASS_TEMPLATES) {
    const blocks = (master.schema as { pages: Array<{ blocks: SchemaBlock[] }> }).pages[0].blocks;
    const plates = blocks.filter((b) => b.name === PLATE_BRIEF);
    if (plates.length === 0) continue;
    mastersWithPlates += 1;
    const limits = plates.map((b) => {
      const m = /length > (\d+)\)$/.exec(b.conditional ?? '');
      if (!m) throw new Error(`${master.name}: a plate whose condition names no length: ${b.conditional}`);
      return Number(m[1]);
    });
    const cases = [
      ...limits.flatMap((n) => WORDINGS.map((w) => ({ address: addressOf(n, w), expectPlate: true }))),
      { address: addressOf(Math.max(...limits) + 1, WORDINGS[0]), expectPlate: false },
    ];

    for (const { address, expectPlate } of cases) {
      const { html } = renderTemplateToHtml(master.schema as never, { data: withAddress(address) });
      const page = await context.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      await page.evaluate(() => (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts?.ready);
      const result = await page.evaluate(`(() => {
        const cover = document.querySelector('.tpl-page');
        const plates = Array.from(cover.querySelectorAll('img'))
          .filter((img) => img.getAttribute('alt') === 'Photograph of the property');
        const texts = [];
        const walker = document.createTreeWalker(cover, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
          if ((node.textContent || '').trim() !== '') {
            const range = document.createRange();
            range.selectNodeContents(node);
            for (const r of Array.from(range.getClientRects())) {
              if (r.width > 0 && r.height > 0) texts.push({ top: r.top, bottom: r.bottom, left: r.left, right: r.right, text: node.textContent.trim().slice(0, 40) });
            }
          }
          node = walker.nextNode();
        }
        return {
          plates: plates.map((img) => { const r = img.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; }),
          texts,
        };
      })()`) as { plates: Array<{ top: number; bottom: number; left: number; right: number }>; texts: Array<{ top: number; bottom: number; left: number; right: number; text: string }> };
      await page.close();
      measured += 1;

      const label = `${master.designMeta.templateCode} ${master.name} · ${address.length} chars`;
      if (!expectPlate) {
        if (result.plates.length !== 0) failures.push(`${label}: past the deepest plate, yet ${result.plates.length} plate(s) drawn`);
        continue;
      }
      if (result.plates.length !== 1) {
        failures.push(`${label}: expected one plate, drew ${result.plates.length}`);
        continue;
      }
      const [plate] = result.plates;
      for (const t of result.texts) {
        const vy = Math.min(plate.bottom, t.bottom) - Math.max(plate.top, t.top);
        const vx = Math.min(plate.right, t.right) - Math.max(plate.left, t.left);
        if (vy > 0 && vx > 0) {
          failures.push(`${label}: "${t.text}" sets ${Math.round((vy * 72) / 96)}pt into the plate`);
        }
      }
      // The clear space is part of the promise: a title touching the plate is a defect.
      const below = result.texts.filter((t) => t.top >= plate.top && t.left < plate.right && t.right > plate.left);
      const nearest = below.reduce((min, t) => Math.min(min, t.top), Number.POSITIVE_INFINITY);
      if (Number.isFinite(nearest) && ((nearest - plate.bottom) * 72) / 96 < 8) {
        failures.push(`${label}: the title sets ${Math.round(((nearest - plate.bottom) * 72) / 96)}pt under the plate`);
      }
    }
  }
  await browser.close();

  console.log(`  ${mastersWithPlates} masters draw a plate; ${measured} covers measured`);
  if (mastersWithPlates === 0) {
    console.error('✖ no master draws a plate — the check measured nothing');
    process.exit(1);
  }
  if (failures.length) {
    console.error(`\n✖ ${failures.length} failure(s):`);
    for (const f of failures.slice(0, 80)) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log('✓ every plate clears the head and the title at the longest address it is chosen for');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

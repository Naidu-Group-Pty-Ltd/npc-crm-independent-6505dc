/**
 * Render one Investment Compass master against a REAL stored investment_reports
 * row and screenshot named pages.
 *
 * Scratch harness — not part of the build. `productionFit.ts` measures boxes;
 * this one is for looking at a page.
 *
 *   tsx scripts/template-library/investmentCompass/_prodrender.tmp.mts <page name substring>...
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { renderTemplateToHtml } from '../../../src/lib/reportTemplate/htmlRenderer';
import { evalConditional } from '../../../src/lib/reportTemplate/bindingResolver';
import { applyInvestmentProjection } from '../../../supabase/functions/_shared/reportBindingProjection.pure';
import { applyOrganisationProjection } from '../../../supabase/functions/_shared/organisationProjection.pure';
import { INVESTMENT_COMPASS_TEMPLATES } from './templates';

const SCRATCH = process.env.SCRATCH
  ?? '/tmp/claude-0/-home-user-npc-property-dashbord/14855680-71eb-5c41-b10a-fcb8738ed01d/scratchpad';
const OUT = `${SCRATCH}/prodrender`;
mkdirSync(OUT, { recursive: true });

const row = JSON.parse(readFileSync(`${SCRATCH}/investment-row.json`, 'utf8'));

const ORG = {
  company_name: 'NPC Services',
  email_signature_phone: '03 9000 0000',
  email_signature_email: 'hello@npcservices.com.au',
  email_signature_website: 'npcservices.com.au',
  email_signature_address: '1 Collins Street, Melbourne VIC 3000',
};
const MARK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwC'
  + 'AAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const flat = (o: unknown) => (o && typeof o === 'object' ? { ...(o as object) } : {});
const data: Record<string, any> = {
  report: { id: row.id, type: 'investment', generated_at: row.updated_at },
  property: flat(row.property_specs),
  financials: flat(row.financial_calculations),
  scores: flat(row.investment_score),
  brand: { tokens: {}, logo: null },
};
applyInvestmentProjection(data, row);
applyOrganisationProjection(data, ORG as never, { mark: MARK, markMono: MARK });

console.log('property namespace →', JSON.stringify(data.property, null, 2));
console.log('equitySeries →', JSON.stringify(data.tenYear?.equitySeries ?? data.equitySeries));

const wanted = process.argv.slice(2);
const templateNames = (process.env.TEMPLATES ?? 'pb-01,pb-03').split(',');

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});

for (const key of templateNames) {
  const template = INVESTMENT_COMPASS_TEMPLATES.find(
    (t) => String((t as never as { slug?: string }).slug ?? '').includes(`-${key}-`) || t.name === key,
  );
  if (!template) throw new Error(`No master matched "${key}"`);
  const schema = (template as never as { schema: never }).schema as never as {
    pages: Array<{ name: string; conditional?: string }>;
    tokens: unknown;
  };
  const { html } = renderTemplateToHtml(schema as never, { data });
  writeFileSync(`${OUT}/${key}.html`, html);

  const visible = schema.pages.filter(
    (p) => !p.conditional || evalConditional(String(p.conditional), { data, tokens: schema.tokens } as never),
  );
  const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
  await page.setContent(html, { waitUntil: 'load' });
  const sheets = page.locator('.tpl-page');
  const count = await sheets.count();
  console.log(`${key}: ${count} rendered sheets, ${visible.length} visible pages`);
  for (let i = 0; i < visible.length && i < count; i += 1) {
    const name = visible[i].name;
    if (wanted.length && !wanted.some((w) => name.toLowerCase().includes(w.toLowerCase()))) continue;
    const file = `${OUT}/${key}-${String(i + 1).padStart(2, '0')}-${name.replace(/[^a-z0-9]+/gi, '-')}.png`;
    await sheets.nth(i).screenshot({ path: file });
    console.log('  →', file);
  }
  await page.close();
}

await browser.close();

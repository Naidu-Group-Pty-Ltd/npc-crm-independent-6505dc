/**
 * Where does the cover title's top land, per master, per address length?
 *
 * The cover title is bottom-anchored and grows upward, so the question the
 * geometry cannot answer on paper is whether it reaches the head. This measures
 * it in Chromium against the address lengths production actually holds.
 */
import { chromium } from 'playwright';
import { renderTemplateToHtml } from '../../../src/lib/reportTemplate/htmlRenderer';
import { applyInvestmentProjection } from '../../../supabase/functions/_shared/reportBindingProjection.pure';
import { applyOrganisationProjection } from '../../../supabase/functions/_shared/organisationProjection.pure';
import { INVESTMENT_COMPASS_TEMPLATES } from './templates';

const ORG = { company_name: 'NPC Services', email_signature_phone: '03 9000 0000' };
const MARK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwC'
  + 'AAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** Real production addresses at the percentiles that matter. */
const ADDRESSES: Array<[string, string]> = [
  ['p50 (19)', '28 Bligh Street'],
  ['p90 (44)', '93 Bimbadeen Avenue, Banora Point NSW 2486'],
  ['p99 (61)', 'Lot 1128 Holloway Road (Maplewood), MELTON SUTH, VIC 3338'],
  ['max (83)', 'Emerald Estates,  39 Pats Road and 10 Scheiwe Road, Plainland  Qld  4341, Australia'],
];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });

const worst = new Map<string, { label: string; gap: number }>();

for (const [label, address] of ADDRESSES) {
  for (const template of INVESTMENT_COMPASS_TEMPLATES as Array<{ slug: string; schema: never }>) {
    const data: Record<string, unknown> = { report: {}, brand: {} };
    applyInvestmentProjection(data, {
      property_address: address,
      property_specs: { property_type: 'House' },
      financial_calculations: {},
      investment_score: { grade: 'C+', totalScore: 56, recommendation: 'HOLD - Above average investment' },
    } as never);
    applyOrganisationProjection(data, ORG as never, { mark: MARK, markMono: MARK });

    const { html } = renderTemplateToHtml(template.schema, { data });
    await page.setContent(html, { waitUntil: 'load' });
    // The first sheet only. `Cover title` and the head elements are named.
    // A string, not a function: tsx's esbuild injects `__name` into compiled
    // arrow functions and the page has no such symbol.
    const gap = await page.evaluate(`(() => {
      var sheet = document.querySelector('.tpl-page');
      if (!sheet) return null;
      var p = sheet.getBoundingClientRect();
      function box(el) {
        var r = el.getBoundingClientRect();
        return { top: (r.top - p.top) * 0.75, bottom: (r.bottom - p.top) * 0.75 };
      }
      var kids = Array.prototype.slice.call(sheet.children);
      var title = null;
      for (var i = 0; i < kids.length; i++) { if (kids[i].querySelector('h2')) { title = kids[i]; break; } }
      if (!title) return null;
      var t = box(title);
      var head = -1;
      for (var j = 0; j < kids.length; j++) {
        var el = kids[j];
        if (el === title) continue;
        var b = box(el);
        if (b.bottom - b.top > 700) continue;
        if (b.bottom <= t.bottom && b.top < t.top) head = Math.max(head, b.bottom);
      }
      return head < 0 ? 999 : Math.round(t.top - head);
    })()`) as number | null;
    if (gap === null) continue;
    const key = template.slug;
    const prev = worst.get(key);
    if (!prev || gap < prev.gap) worst.set(key, { label, gap });
  }
}

await browser.close();

const rows = [...worst.entries()].sort((a, b) => a[1].gap - b[1].gap);
console.log('tightest clearance between the cover title and whatever is above it:');
for (const [slug, { label, gap }] of rows.slice(0, 14)) {
  console.log(`  ${gap > 0 ? ' ' : ''}${gap}pt  ${slug}  at ${label}`);
}
const collide = rows.filter(([, v]) => v.gap < 0);
console.log(`\n${collide.length} of ${rows.length} masters collide at the worst address in production.`);

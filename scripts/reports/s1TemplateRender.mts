/**
 * S1 — the Annabelle row through the TEMPLATE path, to the production engine.
 *
 * The client's document comes from the Templates workflow: the stored row is
 * projected by `applyInvestmentProjection`, bound into an Investment Compass
 * master, compiled under the print contract and drawn by WeasyPrint. The
 * flowing renderer is the fallback and draws a different document, so a
 * representative page has to come from this path or it is representative of
 * nothing.
 *
 *   npx tsx scripts/reports/s1TemplateRender.mts [masterKey...]
 *
 * Writes reports/html/s1-tpl-<key>.html and prints the template identity —
 * name, slug and a content hash of the schema — so a rendered page can be
 * tied to the exact master that drew it.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { evalConditional } from '../../src/lib/reportTemplate/bindingResolver';
import { compileTemplateHtmlForPdf } from '../../src/lib/reportTemplate/compileTemplateForPdf';
import { applyInvestmentProjection } from '../../supabase/functions/_shared/reportBindingProjection.pure';
import { applyOrganisationProjection } from '../../supabase/functions/_shared/organisationProjection.pure';
import { INVESTMENT_COMPASS_TEMPLATES } from '../template-library/investmentCompass/templates';

const REPO = resolve(import.meta.dirname, '../..');
const HTML = resolve(REPO, 'reports/html');
const PDF = resolve(REPO, 'reports/pdf');
mkdirSync(HTML, { recursive: true });
mkdirSync(PDF, { recursive: true });

const row = JSON.parse(readFileSync(resolve(REPO, 'reports/fixtures/annabelle-row.json'), 'utf8'));

const ORG = {
  company_name: 'Naidu Property Consulting Services',
  email_signature_phone: '02 8609 3299',
  email_signature_email: 'admin@npcservices.com.au',
  email_signature_website: 'npcservices.com.au',
  email_signature_address: 'Level 5 Nexus Norwest, 4 Columbia Ct, Norwest NSW 2153',
};

/**
 * The workspace's own report settings, as `global_report_settings` holds them.
 *
 * `applyOrganisationProjection` takes these as its FOURTH argument, and passing
 * three is why the first baseline printed no ABN and the generic five-line
 * disclaimer instead of the configured nine-paragraph one. `contact_details`
 * wins over the email-signature columns wherever both carry a field, which is
 * the point of the Report Settings page.
 */
const SETTINGS = {
  contact: {
    company_name: 'Naidu Property Consulting Services',
    abn: '50 684 555 771',
    email: 'admin@npcservices.com.au',
    phone: '02 8609 3299',
    address: 'Level 5 Nexus Norwest, 4 Columbia Ct, Norwest NSW 2153',
    website: 'www.npcservices.com.au',
  },
  disclaimer: {
    is_enabled: true,
    font_size: 'medium',
    text: readFileSync(resolve(REPO, 'reports/fixtures/disclaimer.txt'), 'utf8'),
  },
};
// A 1×1 transparent PNG stands in for the mark: the real asset is a repo file
// and the print boundary refuses a network fetch, so a page that needs a mark
// is judged on its layout rather than on the artwork.
const MARK = readFileSync(resolve(REPO, 'reports/fixtures/mark-monogram.txt'), 'utf8').trim();

const flat = (o: unknown) => (o && typeof o === 'object' ? { ...(o as object) } : {});
const data: Record<string, any> = {
  report: { id: row.id, type: 'investment', generated_at: row.updated_at },
  property: flat(row.property_specs),
  financials: flat(row.financial_calculations),
  scores: flat(row.investment_score),
  brand: { tokens: {}, logo: null },
};
applyInvestmentProjection(data, row);
applyOrganisationProjection(data, ORG as never, { mark: MARK, markMono: MARK }, SETTINGS as never);

const keys = process.argv.slice(2);
const wanted = keys.length ? keys : ['pb-01'];

for (const key of wanted) {
  const template = INVESTMENT_COMPASS_TEMPLATES.find(
    (t) => String((t as never as { slug?: string }).slug ?? '').includes(`-${key}-`) || t.name === key,
  );
  if (!template) throw new Error(`no master matched "${key}"`);

  const t = template as never as { name: string; slug?: string; schema: unknown };
  const schema = t.schema as never as { pages: Array<{ name: string; conditional?: string }>; tokens: unknown };
  const hash = createHash('sha256').update(JSON.stringify(schema)).digest('hex').slice(0, 16);

  const visible = schema.pages.filter(
    (p) => !p.conditional || evalConditional(String(p.conditional), { data, tokens: schema.tokens } as never),
  );

  // The production print contract: `compileTemplateHtmlForPdf` renders with
  // `fontSource: 'container'` and resolves assets inside the render boundary,
  // which is what `render-template-pdf` does before it invokes the engine.
  // Rendering with `renderTemplateToHtml` directly would skip both.
  const compiled = await compileTemplateHtmlForPdf(schema as never, { data });
  const body = compiled.html;

  const htmlPath = resolve(HTML, `s1-tpl-${key}.html`);
  const pdfPath = resolve(PDF, `s1-tpl-${key}.pdf`);
  writeFileSync(htmlPath, body);
  // WeasyPrint writes CSS warnings to stderr on a clean render, so stderr is
  // captured and reported rather than treated as failure. Only a non-zero exit
  // is a failure.
  //
  // Drawn through `renderWeasy.py`, which sends the SAME engine options the
  // route sends — `pdf_variant: 'pdf/ua-1'`, `pdf_tags`, `output_intent`,
  // `optimize_images`, `custom_metadata`. A bare `weasyprint in.html out.pdf`
  // takes the CLI's defaults instead, which is a different file: untagged,
  // with no `/StructTreeRoot` and no output intent. This script already
  // compiled the HTML the way the route compiles it and then handed it to an
  // engine configured differently, so the review artefact could not be put
  // through veraPDF and answer for the product's own document.
  let pages = '—';
  try {
    const r = execFileSync('python3', [resolve(REPO, 'scripts/reports/renderWeasy.py'), htmlPath, pdfPath], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const line of r.split('\n')) if (line.startsWith('warning\t')) console.log(`  engine ${line.replace('\t', ': ')}`);
    pages = execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8' }).match(/^Pages:\s+(\d+)/m)?.[1] ?? '—';
  } catch (err) {
    const e = err as { status?: number; stderr?: Buffer };
    console.log(`  weasyprint exit ${e.status}`);
    console.log(String(e.stderr ?? '').split('\n').filter((l) => !l.startsWith('WARNING')).slice(0, 12).join('\n'));
  }
  console.log(
    `${t.name}  slug=${t.slug ?? '—'}  schemaSha256=${hash}  `
    + `pagesDeclared=${schema.pages.length}  pagesVisible=${visible.length}  pagesDrawn=${pages}`,
  );
  console.log(`  ${htmlPath}\n  ${pdfPath}`);
  console.log(`  page names: ${visible.map((p) => p.name).join(' · ')}`);
  if (compiled.unresolvedRasterPages.length) {
    console.log(`  unresolved raster pages: ${compiled.unresolvedRasterPages.join(', ')}`);
  }
  if (compiled.droppedAssets.length) {
    console.log(`  dropped assets: ${compiled.droppedAssets.map((d) => d.where).join(', ')}`);
  }
}

#!/usr/bin/env node
/**
 * A report FORMAT's user journey, driven in a real browser (RS-5c.5).
 *
 *   surface → choose a template → generate → (send) → measure the PDF
 *
 * `run.mjs` drives the Investment Compass journey and is deliberately specific
 * to that page. This drives the same mechanics for the other formats against
 * the REAL application, with every Supabase request answered from fixtures
 * (`supabaseDouble.mjs`) and the final render drawn by the SAME WeasyPrint
 * version production pins (`localWeasy.mjs`). No credential, no network,
 * nothing outside this process changes.
 *
 * What it checks, for every format: the surface mounts; a template can be
 * chosen where the document is produced and the choice persists through the
 * broker; ONE finalisation asks for ONE document; a PDF arrives; where the
 * format has a send, the send reuses the finalised document and the portal row
 * names it; and nothing the page asked for went unanswered.
 *
 * Every format here keeps its own pages and wears the chosen template as its
 * DESIGN (`templateParity.pure.ts`, `standardDesign.ts`), so "one document"
 * means ONE call to the format's own route carrying the chosen template as
 * `design`, and NO template render. The route's document is drawn by the
 * deployed function and is proven where it is drawn
 * (`templateDesignParity.spec.ts`); the double answers it with a stand-in. A
 * format released to its template's pages would name no `route` and be judged
 * by the template branch: one final-mode `render-template-pdf` of the chosen
 * template, measured clean (`measure.mjs`).
 *
 * Usage:
 *   node scripts/verify/report-journey/run-format.mjs --format <cashflow|market_intelligence|comparison|report_qa> --record <id> [--template <id|name>] [--subject structured|transcript]
 *
 * Fixtures: `.verify/fixtures/<record>/report.json` where the format's record
 * IS an investment report (cashflow), or `.verify/fixtures/<record>/tables/
 * <table>.json` (arrays of rows) for everything else; the format's active
 * `report_templates` rows in `.verify/fixtures/templates/`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createSupabaseDouble, loadFixtures } from './supabaseDouble.mjs';
import { assertEngineMatchesPin, renderHtmlWithWeasy } from './localWeasy.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const require = createRequire(path.join(ROOT, 'package.json'));
const { chromium } = require('playwright-core');

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => {
  if (!a.startsWith('--')) return [];
  const v = all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true';
  return [a.slice(2), v];
}).filter((x) => x.length));

/**
 * Each format: where its document is produced, how the template is chosen
 * there, how it is generated, and (if it has one) how it is sent.
 *
 * `selectionType` is the key `report_template_selections` is written under —
 * the adapter registry's `reportType`.
 */
const EXPORT = /^\s*export\s*$/i;
const escapeRe = (t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Report Q&A only: which of its documents to typeset (`--subject structured|transcript`). */
const SUBJECT = (process.argv.includes('--subject') ? process.argv[process.argv.indexOf('--subject') + 1] : null) ?? 'transcript';
const FORMATS = {
  cashflow: {
    label: '10 Year Cash Flow',
    selectionType: 'cashflow',
    route: 'render-cash-flow-pdf',
    requiresReport: true,
    url: (id) => `/cash-flow-analysis/${id}`,
    stays: (url, id) => url.includes(`/cash-flow-analysis/${id}`),
    ready: async (page) => {
      await page.getByRole('button', { name: EXPORT }).first().waitFor({ state: 'visible', timeout: 60_000 });
    },
    openPicker: async (page) => {
      await page.getByRole('button', { name: EXPORT }).first().click();
      await page.getByRole('menuitem').filter({ hasText: /template/i }).first().click();
    },
    generate: async (page) => {
      await page.getByRole('button', { name: EXPORT }).first().click();
      await page.getByRole('menuitem').filter({ hasText: /^\s*generate pdf\s*$/i }).first().click();
    },
    send: {
      open: async (page) => {
        await page.getByRole('button', { name: EXPORT }).first().click();
        await page.getByRole('menuitem').filter({ hasText: /send to client/i }).first().click();
      },
      button: /prepare & send|^send/i,
    },
  },
  market_intelligence: {
    label: 'Market Intelligence',
    selectionType: 'market_intelligence',
    route: 'render-market-intelligence-pdf',
    requiresReport: false,
    url: () => '/marketing-analytics',
    stays: (url) => url.includes('/marketing-analytics'),
    // The analytics panels around the export control ask Meta for figures this
    // journey is not about; answered empty so the page settles.
    answers: {
      // The Market Correlation panel is mounted only while Meta Ads INSIGHTS
      // exist (`enabled: adsData.insights.length > 0`), so one fixture row is
      // what puts the Market Intelligence export on the page at all.
      'fetch-meta-ads': () => {
        const insights = [{
          campaign_id: 'fixture-campaign', campaign_name: 'Fixture campaign', adset_id: 'fixture-adset', ad_id: 'fixture-ad',
          date_start: '2026-09-01', date_stop: '2026-09-14', spend: '120.00', impressions: '4200', clicks: '96', reach: '3900',
          ctr: '2.29', cpc: '1.25', cpm: '28.57', frequency: '1.08',
          actions: [{ action_type: 'lead', value: '4' }], cost_per_action_type: [{ action_type: 'lead', value: '30.00' }],
        }];
        const campaigns = [{ id: 'fixture-campaign', name: 'Fixture campaign', status: 'ACTIVE', objective: 'OUTCOME_LEADS' }];
        const body = { insights, campaigns, adsets: [], ads: [], account: { name: 'Fixture account', currency: 'AUD' } };
        return { success: true, ...body, data: body };
      },
      'analyze-meta-ads': () => ({ success: true, analysis: null, data: null }),
      'analyze-meta-ads-phase2': () => ({ success: true, data: null }),
      'analyze-meta-ads-phase3': () => ({ success: true, data: null }),
      // The Market Correlation panel — the ONLY door to the Market Intelligence
      // export and its history — renders nothing at all until this analysis has
      // produced content (`MarketCorrelationPanel` returns null otherwise). A
      // deployment with no Meta figures therefore has no way to reach a stored
      // market intelligence report from the page. Answered with one line so
      // the panel mounts; the finding is recorded in RUNTIME_CONSOLIDATION §9.
      'analyze-meta-ads-phase4': () => {
        const market = { marketEvents: [], perplexityResearch: '', citations: [], aiAnalysis: 'Market correlation analysis (fixture).', benchmarks: [] };
        return { success: true, ...market, data: market };
      },
      'analyze-meta-ads-phase5': () => ({ success: true, data: null }),
      'agent-models-read': () => ({ success: true, models: [], data: [] }),
      'dispatch-marketing-reports': () => ({ success: true, schedules: [], history: [], log: [] }),
      'manage-automation-settings': () => ({ success: true, settings: null, data: null }),
      'mission-control-packs': () => ({ success: true, packs: [], data: [] }),
    },
    // The picker is opened from a popover inside the History dialog; one
    // Escape closes the picker and leaves the dialog the document is produced from.
    escapesAfterPick: 1,
    ready: async (page) => {
      await page.getByRole('button', { name: /report history/i }).first().waitFor({ state: 'visible', timeout: 60_000 });
    },
    openPicker: async (page) => {
      await page.getByRole('button', { name: /report history/i }).first().click();
      const history = page.getByRole('dialog').first();
      const options = history.getByRole('button', { name: /typeset pdf options/i }).first();
      await options.waitFor({ state: 'visible', timeout: 20_000 });
      await options.click();
      await page.getByRole('button', { name: /choose template|change template/i }).first().click();
    },
    // The picker lives inside a modal dialog, so the body stays locked by
    // design while that dialog is open; what must hold is that the dialog the
    // document is produced from is still there.
    afterPick: async (page, check) => {
      const history = page.getByRole('dialog').filter({ hasText: /report history/i }).first();
      check('the History dialog stays open after the picker', await history.isVisible().catch(() => false));
    },
    generate: async (page) => {
      const history = page.getByRole('dialog').filter({ hasText: /report history/i }).first();
      await history.getByRole('button', { name: /^\s*typeset pdf\s*$/i }).first().click();
    },
    afterGenerate: async (page, check) => {
      // The design path writes the stored copy itself, in the chosen design,
      // so nothing may say the email copy was left in another one (RS-5c.4's
      // note belongs to a template's pages, which this format never reaches).
      const note = page.getByText(/not saved for the scheduled email/i).first();
      check('no note says the stored copy was left in another design',
        !(await note.isVisible().catch(() => false)));
    },
  },
  comparison: {
    label: 'Property Comparison Analysis',
    selectionType: 'comparison',
    route: 'render-property-comparison-pdf',
    requiresReport: false,
    // The library's Comparisons tab: every saved comparison is a card with the
    // download this format never had until RS-5c (a menu button, icon only,
    // named for the screen reader).
    url: () => '/generated-reports?tab=comparisons',
    stays: (url) => url.includes('/generated-reports'),
    ready: async (page) => {
      await page.getByRole('button', { name: /download this comparison/i }).first().waitFor({ state: 'visible', timeout: 60_000 });
    },
    openPicker: async (page) => {
      await page.getByRole('button', { name: /download this comparison/i }).first().click();
      await page.getByRole('menuitem').filter({ hasText: /template/i }).first().click();
    },
    generate: async (page) => {
      await page.getByRole('button', { name: /download this comparison/i }).first().click();
      await page.getByRole('menuitem').filter({ hasText: /\(typeset\)/i }).first().click();
    },
  },
  report_qa: {
    label: `Report Q&A (${SUBJECT})`,
    selectionType: 'qa',
    requiresReport: false,
    url: () => '/report-qa',
    stays: (url) => url.includes('/report-qa'),
    // Both subjects go to the format's own route, in the chosen design.
    route: 'render-report-qa-pdf',
    // The chat's model picker asks for the agent model list on mount.
    answers: {
      'agent-models-read': () => ({ success: true, models: [], data: [] }),
    },
    // The typeset control exists only once a conversation with messages is
    // open, so "ready" is: open History, load the fixture conversation, and
    // wait for the control — the path a person takes to reach it.
    ready: async (page, fixtures) => {
      const history = page.getByRole('button', { name: /history/i }).first();
      await history.waitFor({ state: 'visible', timeout: 60_000 });
      await history.click();
      const conv = fixtures.rows?.report_qa_conversations?.[0];
      if (!conv) throw new Error('no report_qa_conversations fixture row');
      const row = page.getByRole('button', { name: new RegExp(`load conversation ${escapeRe(conv.title)}`, 'i') }).first();
      await row.waitFor({ state: 'visible', timeout: 20_000 });
      await row.click();
      const typeset = page.getByRole('button', { name: /^\s*typeset pdf\s*$/i }).first();
      await typeset.waitFor({ state: 'visible', timeout: 60_000 });
      // Loading a conversation leaves the History dialog to its own close; if
      // it is still up, the page behind it is not reachable.
      if (await page.getByRole('dialog').first().isVisible().catch(() => false)) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
      }
    },
    openPicker: async (page) => {
      await page.getByRole('button', { name: /^\s*typeset pdf\s*$/i }).first().click();
      await page.getByRole('menuitem').filter({ hasText: /template/i }).first().click();
    },
    generate: async (page) => {
      await page.getByRole('button', { name: /^\s*typeset pdf\s*$/i }).first().click();
      const item = SUBJECT === 'structured' ? /structured report/i : /full transcript/i;
      await page.getByRole('menuitem').filter({ hasText: item }).first().click();
    },
  },
};

const FORMAT = args.format;
const RECORD_ID = args.record;
const spec = FORMATS[FORMAT];
if (!spec || !RECORD_ID) {
  console.error(`usage: --format <${Object.keys(FORMATS).join('|')}> --record <id> [--template <id|name>]`);
  process.exit(2);
}
const BASE = args.base ?? 'http://127.0.0.1:5173';
const TEMPLATE = args.template ? String(args.template) : null;
const OUT = path.resolve(ROOT, args.out
  ?? `.verify/out/journey/${FORMAT}${FORMAT === 'report_qa' ? `-${SUBJECT}` : ''}-${RECORD_ID.slice(0, 8)}${TEMPLATE ? `-${TEMPLATE.replace(/[^a-z0-9]+/gi, '').slice(0, 8)}` : ''}`);
const FIXTURES = path.resolve(ROOT, '.verify/fixtures');
fs.mkdirSync(OUT, { recursive: true });

const chromiumPath = process.env.VERIFY_CHROMIUM
  ?? (fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined);

const engine = assertEngineMatchesPin(ROOT);
const fixtures = loadFixtures(FIXTURES, RECORD_ID, { requireReport: spec.requiresReport !== false });
const dbl = createSupabaseDouble(fixtures, {
  renderHtml: async (html) => renderHtmlWithWeasy(html),
  extraEdge: (name, body) => (spec.answers?.[name] ? spec.answers[name](body) : null),
});

const findings = [];
const unfulfilledNow = () => dbl.log.filter((l) => !l.fulfilled && l.kind !== 'external');
const check = (step, ok, detail = '') => { findings.push({ step, ok: !!ok, detail }); console.log(`${ok ? '  ✓' : '  ✗'} ${step}${detail ? ` — ${detail}` : ''}`); return !!ok; };
const shot = async (page, name) => { await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false }).catch(() => {}); };
const buttonNames = (page) => page.locator('button, [role="menuitem"]').evaluateAll((els) =>
  els.map((e) => (e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean)).catch(() => []);

const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
await context.route('**/*', (route, request) => dbl.handle(route, request));
const page = await context.newPage();
page.setDefaultTimeout(8_000);
page.on('dialog', (d) => d.accept().catch(() => {}));

const consoleErrors = []; const pageErrors = []; const netFail = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 240)); });
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
page.on('requestfailed', (r) => netFail.push(`${r.failure()?.errorText} ${r.url().slice(0, 100)}`));
const downloads = [];
page.on('download', async (d) => {
  const file = path.join(OUT, d.suggestedFilename());
  await d.saveAs(file);
  downloads.push({ name: d.suggestedFilename(), file, bytes: fs.statSync(file).size });
});

const t0 = Date.now();
let fatal = null;
let finalRender = null;
/** The format's own route call the generate step made, on the design path. */
let finalRoute = null;
try {
  console.log(`\n═══ ${spec.label} journey — record ${RECORD_ID} — WeasyPrint ${engine} ═══\n`);

  // ── 1. The surface opens ────────────────────────────────────────────────
  await page.goto(`${BASE}${spec.url(RECORD_ID, fixtures)}`, { waitUntil: 'networkidle', timeout: 90_000 });
  await spec.ready(page, fixtures);
  check('surface opens (its export control is on screen)', true, spec.url(RECORD_ID, fixtures));
  check('no "Something went wrong" boundary', !(await page.getByText(/something went wrong/i).count()));
  await shot(page, '01-surface');
  fs.writeFileSync(path.join(OUT, 'controls.json'), JSON.stringify(await buttonNames(page), null, 2));

  // ── 2. The template is chosen where the document is produced ────────────
  await spec.openPicker(page);
  const picker = page.getByRole('dialog', { name: /choose a template/i });
  check('template picker opens from the export control', await picker.isVisible().catch(() => false));
  await page.waitForTimeout(1200);
  const radios = picker.getByRole('radio');
  const radioCount = await radios.count();
  check('selectable templates appear', radioCount >= 2, `${radioCount} radio options`);
  await shot(page, '02-picker');
  let chosenLabel = null; let chosenValue = null;
  for (let i = radioCount - 1; i >= 0; i--) {
    const r = radios.nth(i);
    const label = (await r.getAttribute('aria-label')) ?? '';
    const value = (await r.getAttribute('value')) ?? '';
    if (/automatic/i.test(label)) continue;
    if (TEMPLATE && !(value === TEMPLATE || label.toLowerCase().includes(TEMPLATE.toLowerCase()))) continue;
    if (!(await r.isVisible().catch(() => false))) continue;
    await r.click(); chosenLabel = label || value; chosenValue = value; break;
  }
  check('the requested template was offered', !TEMPLATE || chosenLabel !== null, TEMPLATE ? `${TEMPLATE} → ${chosenLabel ?? 'not found among the radios'}` : 'no template requested');
  await page.waitForTimeout(600);
  const confirm = picker.getByRole('button', { name: /use this|choose|select|confirm|save|done/i }).first();
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await page.waitForTimeout(900);
  const selRow = dbl.state.selections.find((s) => s.report_type === spec.selectionType);
  check('template selection persists (written through the broker)', !!selRow && (!chosenValue || selRow.template_id === chosenValue),
    selRow ? `${selRow.report_type} → ${selRow.template_id}` : 'no selection row written');
  for (let i = 0; i < (spec.escapesAfterPick ?? 2); i += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
  if (spec.afterPick) {
    await spec.afterPick(page, check);
  } else {
    const interactive = await page.waitForFunction(() => getComputedStyle(document.body).pointerEvents !== 'none', null, { timeout: 3_000 }).then(() => true).catch(() => false);
    check('page remains interactive after the picker', interactive, interactive ? '' : 'body still carries pointer-events: none');
  }
  await shot(page, '03-template-selected');

  // ── 3. Generate: one finalisation → one final render of the chosen template ──
  const rendersBefore = dbl.state.renders.length;
  const routeCallsBefore = dbl.state.routeCalls.length;
  await spec.generate(page);
  await page.waitForFunction(() => !document.querySelector('button:has(svg.animate-spin), [role="menuitem"]:has(svg.animate-spin)'), null, { timeout: 180_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const rendersAfter = dbl.state.renders.length - rendersBefore;
  if (spec.route) {
    const calls = dbl.state.routeCalls.slice(routeCallsBefore);
    finalRoute = calls[calls.length - 1] ?? null;
    check(`one finalisation → one call to the format's own route (${spec.route}), no template render`,
      rendersAfter === 0 && calls.length === 1 && calls[0].fn === spec.route,
      `${rendersAfter} template render(s) · ${calls.map((c) => c.fn).join(', ') || 'no route call'}`);
    check('the route was sent the chosen template as the design to draw in',
      !!finalRoute && (!chosenValue || finalRoute.design?.templateId === chosenValue),
      finalRoute ? `design=${JSON.stringify(finalRoute.design)} · chosen ${chosenValue ?? '(none)'}` : 'no route call');
  } else {
    check('one finalisation → one render request', rendersAfter === 1, `${rendersAfter} render-template-pdf call(s)`);
    finalRender = dbl.state.renders[dbl.state.renders.length - 1] ?? null;
    check('render asked in final mode and named the record',
      !!finalRender && finalRender.mode === 'final' && finalRender.reportId === RECORD_ID,
      finalRender ? JSON.stringify({ mode: finalRender.mode, reportId: finalRender.reportId, templateId: finalRender.templateId, bytes: finalRender.bytes }) : 'no render');
    check('the render drew the chosen template', !!finalRender && (!chosenValue || finalRender.templateId === chosenValue),
      finalRender ? `rendered ${finalRender.templateId} · chosen ${chosenValue ?? '(none)'}` : 'no render');
  }
  check('a PDF download arrived', downloads.length >= 1 && downloads[0].bytes > 10_000, downloads.map((d) => `${d.name} ${d.bytes}B`).join(', '));
  if (spec.afterGenerate) await spec.afterGenerate(page, check);
  await shot(page, '04-generated');
  await page.keyboard.press('Escape').catch(() => {});

  // ── 4. Send reuses the finalised document ───────────────────────────────
  if (spec.send) {
    await spec.send.open(page);
    const sendDialog = page.getByRole('dialog').first();
    check('Send to Client opens', await sendDialog.isVisible().catch(() => false));
    const clientRow = sendDialog.getByText(/verify client/i).first();
    await clientRow.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
    if (await clientRow.isVisible().catch(() => false)) {
      await clientRow.click();
      const rendersBeforeSend = dbl.state.renders.length;
      const routeCallsBeforeSend = dbl.state.routeCalls.length;
      const downloadsBeforeSend = downloads.length;
      await sendDialog.getByRole('button', { name: spec.send.button }).first().click();
      await page.waitForFunction(() => !document.querySelector('[role="dialog"] button:has(svg.animate-spin)'), null, { timeout: 180_000 }).catch(() => {});
      await page.waitForTimeout(1500);
      const sent = dbl.state.portalReports[dbl.state.portalReports.length - 1];
      check('send publishes a portal row with a stored document', !!sent?.storage_path, sent ? `storage_path=${String(sent.storage_path).slice(0, 70)}` : 'no client_portal_reports row');
      const extraRenders = (dbl.state.renders.length - rendersBeforeSend)
        + (dbl.state.routeCalls.length - routeCallsBeforeSend);
      check('send reuses the finalised document (no second render)', extraRenders === 0, `${extraRenders} additional render(s)`);
      const finalDoc = finalRender ?? finalRoute;
      check('the portal row names the finalised PDF', !!sent && !!finalDoc && sent.storage_path === finalDoc.path,
        `portal=${String(sent?.storage_path).slice(0, 60)} final=${String(finalDoc?.path).slice(0, 60)}`);
      check('send did not trigger a browser download', downloads.length === downloadsBeforeSend);
    } else {
      check('the fixture client is offered in the send dialog', false, 'client list empty');
    }
    await shot(page, '05-send');
    await page.keyboard.press('Escape');
  }

  // ── 5. Hygiene ──────────────────────────────────────────────────────────
  const benign = (t) => /favicon|realtime|websocket|turnstile|ERR_ABORTED/i.test(t);
  check('no console errors', consoleErrors.filter((e) => !benign(e)).length === 0, consoleErrors.filter((e) => !benign(e)).slice(0, 3).join(' | '));
  check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
  check('no failed front-end requests', netFail.filter((e) => !benign(e)).length === 0, netFail.filter((e) => !benign(e)).slice(0, 3).join(' | '));
  check('every request the page made was answered', unfulfilledNow().length === 0, [...new Set(unfulfilledNow().map((u) => u.kind))].slice(0, 10).join(', '));
  check('no unexpected navigation', spec.stays(page.url(), RECORD_ID), page.url());
} catch (e) {
  fatal = String(e?.message ?? e).split('\n')[0];
  console.log(`  ✗ journey aborted — ${fatal}`);
  console.log(String(e?.message ?? e).split('\n').slice(1, 14).map((l) => '      ' + l).join('\n'));
  await shot(page, '99-aborted');
  console.log('  visible controls:', JSON.stringify((await buttonNames(page)).slice(0, 40)));
  console.log('  unanswered:', JSON.stringify([...new Set(unfulfilledNow().map((u) => u.kind))].slice(0, 12)));
}
await browser.close();

// ── 6. The document, measured as a document ────────────────────────────────
let measure = null;
// A route's document is the route's own to judge — the double answers it with
// a stand-in so the front end's decision can be watched, and that stand-in is
// not a document to measure.
if (downloads[0] && !spec.route) {
  const jsonOut = path.join(OUT, 'measure.json');
  const label = `${FORMAT}-${RECORD_ID.slice(0, 8)}`;
  try {
    execFileSync('node', [path.join(ROOT, 'scripts/verify/report-pdf/measure.mjs'), downloads[0].file, '--json', jsonOut, '--label', label],
      { stdio: ['ignore', fs.openSync(path.join(OUT, 'measure.log'), 'w'), 'pipe'], timeout: 300_000 });
  } catch { /* the measurer exits non-zero on a FAIL verdict; the JSON says why */ }
  if (fs.existsSync(jsonOut)) {
    measure = JSON.parse(fs.readFileSync(jsonOut, 'utf8'));
    // An issue is `{ page, kind, detail }`; the kind is what is judged. SPARSE
    // is reported and not failed here — a one-topic-per-page master is a
    // catalogue design, not a render fault — and everything else is.
    const HARD = /OVERLAP|OFF-PAGE|ILLEGIBLE|RAW|MOJIBAKE|BLANK|SENTINEL|PLACEHOLDER|FONTS|NUMBERING/i;
    const hard = (measure.issues ?? []).filter((i) => HARD.test(String(i?.kind ?? i)));
    check('final PDF measures clean (no overlap, off-page, illegible, raw binding or placeholder)', hard.length === 0,
      `${measure.pages} pages · ${(measure.issues ?? []).length} finding(s)${hard.length ? ': ' + hard.slice(0, 4).map((i) => `p${i.page} ${i.kind} ${String(i.detail).slice(0, 60)}`).join(' | ') : ''}`);
  } else {
    check('final PDF measured', false, 'measure.mjs produced no JSON');
  }
}

const unfulfilled = unfulfilledNow();
const passed = !fatal && findings.every((f) => f.ok);
const report = {
  format: FORMAT, recordId: RECORD_ID, template: TEMPLATE, engine, base: BASE, ms: Date.now() - t0,
  result: passed ? 'FRONT END — PASS' : 'FRONT END — FAIL',
  findings, downloads, selections: dbl.state.selections, portalReports: dbl.state.portalReports,
  measure: measure ? { pages: measure.pages, issues: measure.issues, sparsePages: measure.sparsePages, meanLargestBandPct: measure.meanLargestBandPct } : null,
  unfulfilled, consoleErrors, pageErrors, netFail, fatal,
  requestKinds: Object.entries(dbl.log.reduce((m, l) => { m[l.kind] = (m[l.kind] ?? 0) + 1; return m; }, {})),
};
if (finalRender?.html) fs.writeFileSync(path.join(OUT, 'final.html'), finalRender.html);
report.renders = dbl.state.renders.map(({ html: _html, ...rest }) => rest);
fs.writeFileSync(path.join(OUT, 'journey.json'), JSON.stringify(report, null, 2));
console.log(`\n${report.result}  (${findings.filter((f) => f.ok).length}/${findings.length} checks, ${(report.ms / 1000).toFixed(1)}s)  → ${path.relative(ROOT, OUT)}/journey.json\n`);
process.exit(passed ? 0 : 1);

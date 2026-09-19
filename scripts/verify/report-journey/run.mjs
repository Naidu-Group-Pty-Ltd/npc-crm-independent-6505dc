#!/usr/bin/env node
/**
 * The Investment Compass user journey, driven in a real browser.
 *
 *   report → edit → templates → preview → publishing/export → generate → send
 *
 * against the REAL application, with every Supabase request answered from
 * fixtures (`supabaseDouble.mjs`) and the final render drawn by the SAME
 * WeasyPrint version production pins (`localWeasy.mjs`). No credential is
 * used, no network is reached, nothing outside this process changes.
 *
 * This is the FRONT-END CHECK of the mandatory loop
 *   change → front-end check → final PDF → content check → visual check → tests → commit
 * and it runs in about a minute. It fails on: a page or component that does
 * not mount, an edit that does not persist, a template choice that does not
 * persist, a control that does nothing, a duplicated or legacy PDF button, a
 * console error, a request the page made that nothing answered, a render that
 * was not asked for, or a PDF that did not arrive.
 *
 * Usage:
 *   node scripts/verify/report-journey/run.mjs --report <id> [--base http://127.0.0.1:5173] [--out .verify/out]
 *
 * Prerequisites: the Vite dev server running; `.verify/fixtures` populated
 * (README.md); WeasyPrint at the pinned version installed for python3.
 */
import fs from 'node:fs';
import path from 'node:path';
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
const REPORT_ID = args.report;
if (!REPORT_ID) { console.error('usage: --report <investment_report id>'); process.exit(2); }
const BASE = args.base ?? 'http://127.0.0.1:5173';
/**
 * Which engine the FINAL document is expected to come from.
 *   weasyprint — the target architecture: exactly one `render-template-pdf`
 *                call in final mode naming the report (default).
 *   browser    — the pre-cutover baseline: no server render at all.
 */
const EXPECT_RENDERER = args['expect-renderer'] ?? 'weasyprint';
/**
 * Which template to choose in the picker: a `report_templates` id (matched on
 * the radio's `value`) or a substring of its name (matched on `aria-label`).
 * Omitted, the last non-automatic option is chosen so a change is observable.
 */
const TEMPLATE = args.template ? String(args.template) : null;
const OUT = path.resolve(ROOT, args.out
  ?? `.verify/out/journey/${REPORT_ID.slice(0, 8)}${TEMPLATE ? `-${TEMPLATE.replace(/[^a-z0-9]+/gi, '').slice(0, 8)}` : ''}`);
const FIXTURES = path.resolve(ROOT, '.verify/fixtures');
fs.mkdirSync(OUT, { recursive: true });

const chromiumPath = process.env.VERIFY_CHROMIUM
  ?? (fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined);

const engine = assertEngineMatchesPin(ROOT);
const fixtures = loadFixtures(FIXTURES, REPORT_ID);
const dbl = createSupabaseDouble(fixtures, { renderHtml: async (html) => renderHtmlWithWeasy(html) });

const findings = [];   // { step, ok, detail }
const unfulfilledNow = () => dbl.log.filter((l) => !l.fulfilled && l.kind !== 'external');
const check = (step, ok, detail = '') => { findings.push({ step, ok: !!ok, detail }); console.log(`${ok ? '  ✓' : '  ✗'} ${step}${detail ? ` — ${detail}` : ''}`); return !!ok; };
const probes = [];
const probe = async (page, label) => {
  const v = await page.evaluate(() => ({
    bodyPointer: document.body.style.pointerEvents || '(unset)',
    dialogs: document.querySelectorAll('[role="dialog"]').length,
    openMenus: document.querySelectorAll('[role="menu"][data-state="open"]').length,
  })).catch(() => null);
  probes.push({ label, ...v }); return v;
};
const shot = async (page, name) => { await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false }); };

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
const address = fixtures.report.property_address;
let fatal = null;
try {
console.log(`\n═══ Investment journey — report ${REPORT_ID} — WeasyPrint ${engine} ═══\n`);

// ── 1. The report opens ──────────────────────────────────────────────────
await page.goto(`${BASE}/investment-report/${REPORT_ID}`, { waitUntil: 'networkidle', timeout: 90_000 });
const heading = page.getByRole('heading', { name: new RegExp(address.split(',')[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first();
check('report opens (address heading visible)', await heading.isVisible().catch(() => false), address);
check('no "Something went wrong" boundary', !(await page.getByText(/something went wrong/i).count()));
check('no loading loop (skeletons cleared)', (await page.locator('[class*="skeleton"], [data-loading="true"]').count()) === 0);
await shot(page, '01-report');
// Every control the page exposes, recorded so a locator that misses is
// diagnosable from the manifest rather than by re-running with a debugger.
const controlNames = await page.locator('button, [role="menuitem"], a[href]').evaluateAll((els) =>
  els.map((e) => (e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean));
fs.writeFileSync(path.join(OUT, 'controls.json'), JSON.stringify(controlNames, null, 2));

// ── 2. Edit → persist ────────────────────────────────────────────────────
await probe(page, 'before menu');
const more = page.locator('button').filter({ hasText: /^\s*more\s*$/i }).first();
await more.click();
await probe(page, 'menu open');
await page.getByRole('menuitem', { name: /^\s*edit\s*$/i }).click();
await page.waitForTimeout(600);
await probe(page, 'editor open');
const editorTitle = page.getByRole('dialog').getByText(/edit/i).first();
check('report editor opens', await editorTitle.isVisible().catch(() => false));
const contentBox = page.getByPlaceholder(/investment analysis report content/i);
const MARK = `[VERIFY-EDIT ${Date.now()}]`;
await contentBox.click();
await contentBox.press('End');
await contentBox.type(`\n\n${MARK}`);
await page.getByRole('button', { name: /save changes/i }).click();
// The editor reports its own state; wait for it rather than for a clock.
await page.getByRole('dialog').getByText(/all changes saved/i).waitFor({ timeout: 15_000 }).catch(() => {});
const saved = dbl.state.updates.some((u) => String(u.report_content ?? '').includes(MARK));
check('edit is written through the broker', saved, 'manage-investment-reports update carried the edit');
await probe(page, 'after save');
check('editor confirms the save', await page.getByRole('dialog').getByText(/all changes saved/i).isVisible().catch(() => false));
await page.getByRole('dialog').getByRole('button', { name: /^cancel$/i }).click();
await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
await page.waitForTimeout(600);
await probe(page, 'after cancel');
check('editor closes', (await page.getByRole('dialog').count()) === 0);
// A modal opened from a menu can leave `body { pointer-events: none }` behind
// when both layers disable outside pointer events and unmount in the wrong
// order — every control on the page is then dead until a reload. Ask the DOM.
const interactive = await page.waitForFunction(() => getComputedStyle(document.body).pointerEvents !== 'none', null, { timeout: 3_000 }).then(() => true).catch(() => false);
check('page remains interactive after closing the editor', interactive, interactive ? '' : 'body still carries pointer-events: none');
check('edit persists on the page', (await page.locator('body').innerText()).includes(MARK.slice(0, 12)), 'the document card shows the new text');
await shot(page, '02-edited');

/*
 * The edit fixture and the acceptance document are separated here.
 *
 * Everything above proves the edit path: the marker was typed, written through
 * `manage-investment-reports`, and read back onto the page. Everything below
 * finalises a document a person is asked to accept — and until this step
 * existed the two were the same bytes, so all five supplied PDFs carried
 * `[VERIFY-EDIT …]` in their prose.
 *
 * The fixture is put back rather than the text being stripped out. A scrubber
 * that deletes bracketed text from a stored document would delete a real
 * user's edit just as readily; restoring the fixture can only ever write what
 * the fixture already said, so it cannot reach a customer's content at all.
 *
 * `KEEP_VERIFY_EDIT=1` keeps the marker through to the PDF, which is how the
 * edit-preservation claim is demonstrated end to end when that is what is
 * being demonstrated. It is off by default, so the ordinary run of this
 * harness produces a clean document.
 */
const keepEdit = process.env.KEEP_VERIFY_EDIT === '1';
if (keepEdit) {
  check('edit deliberately carried into the document', true, 'KEEP_VERIFY_EDIT=1 — this run is edit-preservation evidence, not an acceptance document');
} else {
  const restored = dbl.restoreReportFields(['report_content']);
  check('edit fixture reset before the acceptance render', restored.includes('report_content'),
    'the document finalised below is the fixture\'s own content, with no harness marker in it');
  await page.reload({ waitUntil: 'networkidle', timeout: 90_000 });
  await page.waitForTimeout(800);
  const cleaned = !(await page.locator('body').innerText()).includes('[VERIFY-EDIT');
  check('no harness marker on the page after the reset', cleaned, cleaned ? '' : 'the marker survived the reset');
}

// ── 3. Templates selector → picker → selection persists ─────────────────
const chooser = page.getByRole('button', { name: /choose template|change template/i }).first();
check('templates selector visible', await chooser.isVisible().catch(() => false));
await chooser.click();
const picker = page.getByRole('dialog', { name: /choose a template/i });
check('template picker opens', await picker.isVisible().catch(() => false));
await page.waitForTimeout(1200);
const radios = picker.getByRole('radio');
const radioCount = await radios.count();
check('selectable templates appear', radioCount >= 2, `${radioCount} radio options`);
await shot(page, '03-picker');
// choose the requested template, else the last non-automatic option so a
// change is observable
let chosenLabel = null;
for (let i = radioCount - 1; i >= 0; i--) {
  const r = radios.nth(i);
  const label = (await r.getAttribute('aria-label')) ?? '';
  const value = (await r.getAttribute('value')) ?? '';
  if (/automatic/i.test(label)) continue;
  if (TEMPLATE && !(value === TEMPLATE || label.toLowerCase().includes(TEMPLATE.toLowerCase()))) continue;
  // The picker lists a template under more than one heading (a design family's
  // colourways, the individual designs, the other active rows), and a radio in
  // a collapsed group is not clickable; take the one a person could reach.
  if (!(await r.isVisible().catch(() => false))) continue;
  await r.click(); chosenLabel = label || value; break;
}
check('the requested template was offered', !TEMPLATE || chosenLabel !== null, TEMPLATE ? `${TEMPLATE} → ${chosenLabel ?? 'not found among the radios'}` : 'no template requested');
await page.waitForTimeout(600);
const confirm = picker.getByRole('button', { name: /use this|choose|select|confirm|save|done/i }).first();
if (await confirm.isVisible().catch(() => false)) await confirm.click();
await page.waitForTimeout(900);
const selRow = dbl.state.selections.find((s) => /invest/.test(s.report_type));
check('template selection persists (written through the broker)', !!selRow, selRow ? `${selRow.report_type} → ${selRow.template_id}` : 'no selection row written');
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
const selectorText = await page.locator('text=/Template/').first().locator('..').innerText().catch(() => '');
await shot(page, '04-template-selected');

// ── 4. Publishing / Export panel ─────────────────────────────────────────
const panel = page.getByText(/publishing & export/i).first();
check('Publishing & Export panel present', await panel.isVisible().catch(() => false));
const switches = page.getByRole('switch');
const swCount = await switches.count();
check('export controls respond (toggle a switch and back)', await (async () => {
  if (!swCount) return false;
  const s = switches.first(); const before = await s.getAttribute('aria-checked');
  await s.click(); const mid = await s.getAttribute('aria-checked'); await s.click(); const after = await s.getAttribute('aria-checked');
  return before !== mid && before === after;
})(), `${swCount} switches`);

// ── 5. The PDF controls — exactly one, no legacy ─────────────────────────
const pdfButtons = page.getByRole('button', { name: /generate client pdf|download pdf|client pdf/i });
const pdfNames = await pdfButtons.evaluateAll((els) => els.map((e) => e.textContent?.trim()));
const legacy = await page.getByText(/legacy layout|legacy/i).count();
check('one client-PDF action per surface, no legacy button', legacy === 0 && pdfNames.filter((n) => /generate client pdf/i.test(n ?? '')).length === 1, JSON.stringify(pdfNames));

// ── 6. Generate the client PDF (the finalisation) ───────────────────────
const rendersBefore = dbl.state.renders.length;
const gen = page.getByRole('button', { name: /generate client pdf/i }).first();
// Whether the button was EVER disabled while its render ran is observed from
// inside the page, because a fast render can finish before a poll sees it.
await gen.evaluate((btn) => {
  window.__genDisabledSeen = false;
  new MutationObserver(() => { if (btn.disabled) window.__genDisabledSeen = true; })
    .observe(btn, { attributes: true, attributeFilter: ['disabled'] });
});
await gen.click();
await page.waitForFunction(() => !document.querySelector('button:has(svg.animate-spin)'), null, { timeout: 180_000 }).catch(() => {});
await page.waitForTimeout(1500);
check('finalisation button disabled while in flight', await page.evaluate(() => window.__genDisabledSeen === true));
const rendersAfter = dbl.state.renders.length - rendersBefore;
if (EXPECT_RENDERER === 'browser') {
  check('baseline: the document is drawn in the browser (no server render)', rendersAfter === 0, `${rendersAfter} render-template-pdf call(s)`);
} else {
  check('one finalisation → one render request', rendersAfter === 1, `${rendersAfter} render-template-pdf call(s)`);
  const finalRender = dbl.state.renders[dbl.state.renders.length - 1];
  check('render asked in final mode and named the report', !!finalRender && finalRender.mode === 'final' && finalRender.reportId === REPORT_ID, finalRender ? JSON.stringify({ mode: finalRender.mode, reportId: finalRender.reportId, templateId: finalRender.templateId, bytes: finalRender.bytes }) : 'no render');
}
check('a PDF download arrived', downloads.length >= 1 && downloads[0].bytes > 10_000, downloads.map((d) => `${d.name} ${d.bytes}B`).join(', '));
await shot(page, '05-generated');

// ── 7. Send to Client reuses the finalised document ─────────────────────
const sendBtn = page.getByRole('button', { name: /send to client/i }).first();
if (await sendBtn.isVisible().catch(() => false)) {
  await sendBtn.click();
  const sendDialog = page.getByRole('dialog').first();
  check('Send to Client opens', await sendDialog.isVisible().catch(() => false));
  // Pick the fixture client and send. The modal generates the document itself
  // when the page hands it no stored path — which is where a second render
  // would happen if the finalisation were not reused.
  // The list is fetched when the dialog opens; give it time to arrive rather
  // than reading the spinner as an empty list.
  const clientRow = sendDialog.getByText(/verify client/i).first();
  await clientRow.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
  if (await clientRow.isVisible().catch(() => false)) {
    await clientRow.click();
    const rendersBeforeSend = dbl.state.renders.length;
    const downloadsBeforeSend = downloads.length;
    await sendDialog.getByRole('button', { name: /prepare & send|^send\b/i }).first().click();
    await page.waitForFunction(() => !document.querySelector('[role="dialog"] button:has(svg.animate-spin)'), null, { timeout: 180_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const sent = dbl.state.portalReports[dbl.state.portalReports.length - 1];
    check('send publishes a portal row with a stored document', !!sent?.storage_path, sent ? `storage_path=${String(sent.storage_path).slice(0, 60)}` : 'no client_portal_reports row');
    const extraRenders = dbl.state.renders.length - rendersBeforeSend;
    if (EXPECT_RENDERER === 'weasyprint') {
      check('send reuses the finalised document (no second render)', extraRenders === 0, `${extraRenders} additional render(s)`);
      const finalPath = dbl.state.renders[dbl.state.renders.length - 1]?.path;
      check('the portal row names the finalised PDF', !!sent && sent.storage_path === finalPath, `portal=${String(sent?.storage_path).slice(0, 50)} final=${String(finalPath).slice(0, 50)}`);
    } else {
      check('baseline: send draws the document in the browser again', extraRenders === 0, `${extraRenders} server render(s)`);
    }
    check('send did not trigger a browser download', downloads.length === downloadsBeforeSend);
  } else {
    check('the fixture client is offered in the send dialog', false, 'client list empty');
  }
  await shot(page, '06-send');
  await page.keyboard.press('Escape');
}

// ── 8. Hygiene ───────────────────────────────────────────────────────────
const benign = (t) => /favicon|realtime|websocket|turnstile|ERR_ABORTED/i.test(t);
check('no console errors', consoleErrors.filter((e) => !benign(e)).length === 0, consoleErrors.filter((e) => !benign(e)).slice(0, 3).join(' | '));
check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
check('no failed front-end requests', netFail.filter((e) => !benign(e)).length === 0, netFail.filter((e) => !benign(e)).slice(0, 3).join(' | '));
check('every request the page made was answered', unfulfilledNow().length === 0, [...new Set(unfulfilledNow().map((u) => u.kind))].slice(0, 8).join(', '));
check('no unexpected navigation', page.url().includes(`/investment-report/${REPORT_ID}`), page.url());
} catch (e) {
  fatal = String(e?.message ?? e).split('\n')[0];
  console.log(`  ✗ journey aborted — ${fatal}`);
  console.log(String(e?.message ?? e).split('\n').slice(1, 14).map((l) => '      ' + l).join('\n'));
  await shot(page, '99-aborted').catch(() => {});
  const names = await page.locator('button').evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean)).catch(() => []);
  const top = await page.evaluate(() => {
    const el = document.elementFromPoint(window.innerWidth * 0.8, window.innerHeight * 0.5);
    const dialogs = [...document.querySelectorAll('[role="dialog"],[data-state="open"]')].map((d) => d.getAttribute('aria-label') || d.className.toString().slice(0, 60));
    return { top: el ? `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 80)}` : null, dialogs: dialogs.slice(0, 6), bodyPointer: getComputedStyle(document.body).pointerEvents };
  }).catch(() => null);
  console.log('  on top:', JSON.stringify(top));
  console.log('  visible buttons:', JSON.stringify(names.slice(0, 40)));
}
await browser.close();

const unfulfilled = unfulfilledNow();
const passed = !fatal && findings.every((f) => f.ok);
const report = {
  reportId: REPORT_ID, address, engine, expectRenderer: EXPECT_RENDERER, base: BASE, ms: Date.now() - t0,
  result: passed ? 'FRONT END — PASS' : 'FRONT END — FAIL',
  findings, downloads, renders: dbl.state.renders, selections: dbl.state.selections, portalReports: dbl.state.portalReports,
  updates: dbl.state.updates.map((u) => Object.keys(u)),
  unfulfilled, consoleErrors, pageErrors, netFail,
  fatal,
  probes,
  requestLog: dbl.log,
  requestKinds: Object.entries(dbl.log.reduce((m, l) => { m[l.kind] = (m[l.kind] ?? 0) + 1; return m; }, {})),
};
// The HTML the engine was handed, beside the PDF it made of it: a geometry
// defect is diagnosed on that document, and this is the only place it exists.
const lastRender = dbl.state.renders[dbl.state.renders.length - 1];
if (lastRender?.html) fs.writeFileSync(path.join(OUT, 'final.html'), lastRender.html);
report.renders = dbl.state.renders.map(({ html: _html, ...rest }) => rest);
fs.writeFileSync(path.join(OUT, 'journey.json'), JSON.stringify(report, null, 2));
console.log(`\n${report.result}  (${findings.filter((f) => f.ok).length}/${findings.length} checks, ${(report.ms / 1000).toFixed(1)}s)  → ${path.relative(ROOT, OUT)}/journey.json\n`);
process.exit(passed ? 0 : 1);

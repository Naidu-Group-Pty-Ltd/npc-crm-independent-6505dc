/**
 * render-source — headless render microservice (plan WS1 §3.2).
 *
 * Renders to a screenshot + a DOM box tree (computed positions/styles in CSS px),
 * which the client grounds into a GroundedReference and reconstructs through the
 * existing `screenshot_to_block` pipeline. Supports all four code tiers:
 *
 *   C1 html/css   → { html, css? }            setContent
 *   C2 live url   → { url }                    goto (SSRF-guarded)
 *   C3 react/jsx  → { jsx, entry? }            Babel-standalone harness (React via CDN)
 *   C4 repo/zip   → { zipBase64 }              extract → static serve
 *
 *   POST /render   Authorization: Bearer <RENDER_SOURCE_TOKEN>
 *   GET  /healthz  → 200 "ok"
 *
 * C4 accepts static/exported zips only. Uploaded projects are never executed.
 */
const express = require('express');
const { chromium } = require('playwright');
const AdmZip = require('adm-zip');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { assertPublicUrl, installNetworkPolicy } = require('./network-policy');

const app = express();
app.use(express.json({ limit: process.env.MAX_BODY || '60mb' }));

const EXPECTED_TOKEN = (process.env.RENDER_SOURCE_TOKEN || '').trim().replace(/^"|"$/g, '');
const NAV_TIMEOUT_MS = Number(process.env.NAV_TIMEOUT_MS || 20000);
const MAX_DIM = 4000;
const MAX_UNZIP_BYTES = Number(process.env.MAX_UNZIP_BYTES || 200 * 1024 * 1024);

// id → absolute static dir, served at /__build/:id for C4 renders.
const buildDirs = new Map();

function authOk(req) {
  if (!EXPECTED_TOKEN) return false; // fail closed
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return false;
  return h.slice(7).trim().replace(/^"|"$/g, '') === EXPECTED_TOKEN;
}

// ── C3: wrap a single-file React/JSX component in a self-mounting HTML harness ──
// React + Babel load from a CDN; imports are stripped (globals provided) and the
// default/`App` export is mounted. Handles the common single-component case.
//
// Real-world single-file components need two more things to render faithfully:
//   1. React hooks as bare globals — `import { useState } from 'react'` is
//      stripped, so without the destructured globals every hook call throws
//      and the render collapses to an error <pre>.
//   2. The Tailwind Play CDN — exported components routinely style with
//      Tailwind utility classes (incl. arbitrary values like text-[72px]);
//      without the JIT runtime they render completely unstyled.
function jsxToHarness(jsx, entryName) {
  let src = String(jsx || '');
  src = src.replace(/^\s*import\s+[^\n;]+;?\s*$/gm, '');            // drop imports
  src = src.replace(/export\s+default\s+function\s+([A-Za-z0-9_]+)/, 'window.__default = function $1');
  src = src.replace(/export\s+default\s+class\s+([A-Za-z0-9_]+)/, 'window.__default = class $1');
  src = src.replace(/export\s+default\s+/, 'window.__default = ');
  src = src.replace(/export\s+(const|let|var|function|class)\s+/g, '$1 '); // drop named-export kw
  const pick = entryName
    ? `(typeof ${entryName} !== 'undefined' ? ${entryName} : window.__default)`
    : `(window.__default || (typeof App !== 'undefined' ? App : null))`;
  const mount = `
;(function(){
  try {
    var C = ${pick};
    var el = document.getElementById('root');
    if (!C) { el.innerHTML = '<pre>render-source: no default export or &lt;App/&gt; found</pre>'; return; }
    ReactDOM.createRoot(el).render(React.createElement(C));
  } catch (e) {
    document.getElementById('root').innerHTML = '<pre>render-source JSX error: ' + (e && e.message) + '</pre>';
  }
})();`;
  // The source travels base64-encoded (no HTML/JS escaping pitfalls) and is
  // compiled with an explicit Babel.transform: the declarative data-presets
  // attribute cannot pass `isTSX`, so real .tsx files (type annotations + JSX
  // in one file) failed to parse at all.
  const sourceB64 = Buffer.from(src + mount, 'utf8').toString('base64');
  return `<!doctype html><html><head><meta charset="utf-8">
<script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
<script src="https://unpkg.com/@babel/standalone@7/babel.min.js"></script>
<script src="https://cdn.tailwindcss.com"></script>
<style>body{margin:0}</style></head><body><div id="root"></div>
<script>
// Hooks + common exports as globals (imports are stripped from the source).
(function(){
  var R = window.React || {};
  ['useState','useEffect','useRef','useCallback','useMemo','useReducer','useContext',
   'useLayoutEffect','useId','useTransition','useSyncExternalStore','useImperativeHandle',
   'Fragment','createContext','forwardRef','memo','createElement','cloneElement','Children'
  ].forEach(function(k){ if (R[k] !== undefined && window[k] === undefined) window[k] = R[k]; });
  try {
    var bytes = Uint8Array.from(atob('${sourceB64}'), function(c){ return c.charCodeAt(0); });
    var code = new TextDecoder().decode(bytes);
    var out = Babel.transform(code, {
      filename: 'component.tsx',
      presets: [['typescript', { isTSX: true, allExtensions: true }], 'react'],
    }).code;
    (new Function(out))();
  } catch (e) {
    document.getElementById('root').innerHTML = '<pre>render-source JSX compile error: ' + (e && e.message) + '</pre>';
  }
})();
</script></body></html>`;
}

// ── C4: extract a static/exported zip and return its static dir to serve ──
function extractZip(b64, destRoot) {
  const zip = new AdmZip(Buffer.from(b64, 'base64'));
  let total = 0;
  for (const e of zip.getEntries()) {
    if (e.isDirectory) continue;
    total += e.header.size;
    if (total > MAX_UNZIP_BYTES) throw new Error('zip too large when expanded');
    const out = path.resolve(destRoot, e.entryName);
    if (out !== destRoot && !out.startsWith(destRoot + path.sep)) throw new Error('unsafe zip entry path');
  }
  zip.extractAllTo(destRoot, true);
}

function findServeDir(root) {
  for (const d of ['dist', 'build', 'out', 'public']) {
    if (fs.existsSync(path.join(root, d, 'index.html'))) return path.join(root, d);
  }
  if (fs.existsSync(path.join(root, 'index.html'))) return root;
  for (const name of fs.readdirSync(root)) {
    const p = path.join(root, name);
    try { if (fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, 'index.html'))) return p; } catch { /* ignore */ }
  }
  return null;
}

function findProjectRoot(root) {
  if (fs.existsSync(path.join(root, 'package.json')) || fs.existsSync(path.join(root, 'index.html'))) return root;
  const children = fs.readdirSync(root)
    .map((name) => path.join(root, name))
    .filter((p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } });
  for (const child of children) {
    if (fs.existsSync(path.join(child, 'package.json')) || fs.existsSync(path.join(child, 'index.html'))) return child;
  }
  return root;
}

function prepareZipServe(b64, id) {
  const root = path.join(os.tmpdir(), 'render-source', id);
  fs.mkdirSync(root, { recursive: true });
  extractZip(b64, root);
  const projectRoot = findProjectRoot(root);
  let serveDir = findServeDir(projectRoot) || findServeDir(root);
  if (!serveDir) {
    throw new Error('No index.html found (only static/exported project zips are supported).');
  }
  buildDirs.set(id, serveDir);
  return { root };
}

// DOM walk — runs in the page; no Node scope.
function extractBoxTree() {
  const TRANSPARENT = /^(transparent|rgba\(\s*0,\s*0,\s*0,\s*0\s*\))$/i;

  // Effective opacity = the product of the element's own opacity and every
  // ancestor's (a 20% wrapper around a solid orb must import at 20%, not 100%).
  const opacityCache = new Map();
  const effectiveOpacity = (el) => {
    let node = el;
    let acc = 1;
    const pending = [];
    while (node && node !== document.documentElement) {
      if (opacityCache.has(node)) { acc = opacityCache.get(node); break; }
      pending.push(node);
      node = node.parentElement;
    }
    for (let i = pending.length - 1; i >= 0; i--) {
      const own = Number(getComputedStyle(pending[i]).opacity);
      acc *= Number.isFinite(own) ? own : 1;
      opacityCache.set(pending[i], acc);
    }
    return acc;
  };

  // Resolve the PAINTED text colour: gradient-clipped text (bg-clip:text +
  // color:transparent) computes as transparent — fall back to the text-fill
  // colour, the first gradient stop, then the nearest opaque ancestor colour.
  const paintedTextColor = (el, cs) => {
    const isTransparent = (v) => !v || TRANSPARENT.test(v);
    if (!isTransparent(cs.color)) return cs.color;
    const fill = cs.webkitTextFillColor;
    if (fill && !isTransparent(fill)) return fill;
    let node = el;
    while (node && node !== document.documentElement) {
      const ncs = getComputedStyle(node);
      const bgImage = ncs.backgroundImage || '';
      if (/gradient\(/.test(bgImage)) {
        const stop = /(?:rgba?\([^)]*\)|#[0-9a-f]{3,8})/i.exec(bgImage);
        if (stop) return stop[0];
      }
      if (!isTransparent(ncs.color)) return ncs.color;
      node = node.parentElement;
    }
    return undefined;
  };

  const radiusPx = (cs, r) => {
    const raw = cs.borderTopLeftRadius || '0px';
    const v = parseFloat(raw) || 0;
    if (/%$/.test(raw.trim())) return Math.min(r.width, r.height) * (v / 100);
    return Math.min(v, Math.min(r.width, r.height) / 2);
  };

  const blurPx = (cs) => {
    const m = /blur\(\s*([\d.]+)px\s*\)/.exec(cs.filter || '');
    return m ? Number(m[1]) : undefined;
  };

  const textBoxes = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const text = (node.nodeValue || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const el = node.parentElement;
    if (!el) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const opacity = effectiveOpacity(el);
    if (opacity < 0.02) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const fontSizePx = parseFloat(cs.fontSize) || r.height;
    const lineHeightPx = cs.lineHeight && cs.lineHeight !== 'normal' ? parseFloat(cs.lineHeight) || undefined : undefined;
    textBoxes.push({
      text,
      x: r.left + window.scrollX,
      y: r.top + window.scrollY,
      width: r.width,
      height: r.height,
      fontSizePx,
      lineHeightPx,
      fontWeight: Number(cs.fontWeight) || undefined,
      fontFamily: (cs.fontFamily || '').split(',')[0].replace(/["']/g, '').trim() || undefined,
      color: paintedTextColor(el, cs),
      italic: cs.fontStyle === 'italic' || undefined,
      letterSpacingPx: cs.letterSpacing && cs.letterSpacing !== 'normal' ? parseFloat(cs.letterSpacing) || undefined : undefined,
      textAlign: ['center', 'right', 'justify'].includes(cs.textAlign) ? cs.textAlign : undefined,
      opacity: opacity < 0.996 ? Math.round(opacity * 1000) / 1000 : undefined,
    });
  }

  // Painted element boxes (section fills, cards, buttons, rules, borders,
  // gradients, glow orbs) — without these the editable import is text-on-white
  // and every background colour from the source is lost.
  const shapeBoxes = [];
  const all = document.body.querySelectorAll('*');
  for (let i = 0; i < all.length && shapeBoxes.length < 400; i++) {
    const el = all[i];
    if (el.tagName === 'IMG' || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const opacity = effectiveOpacity(el);
    if (opacity < 0.02) continue;
    const bg = cs.backgroundColor || '';
    const bgImage = cs.backgroundImage && cs.backgroundImage !== 'none' ? cs.backgroundImage : '';
    const bw = parseFloat(cs.borderTopWidth) || 0;
    const borderColor = cs.borderTopColor || '';
    const hasBg = bg && !TRANSPARENT.test(bg);
    const hasBorder = bw > 0 && borderColor && !TRANSPARENT.test(borderColor) && cs.borderTopStyle !== 'none';
    const hasGradient = /gradient\(/.test(bgImage);
    if (!hasBg && !hasBorder && !hasGradient) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 1) continue;
    const shadow = cs.boxShadow && cs.boxShadow !== 'none' ? cs.boxShadow : undefined;
    shapeBoxes.push({
      x: r.left + window.scrollX,
      y: r.top + window.scrollY,
      width: r.width,
      height: r.height,
      backgroundColor: hasBg ? bg : undefined,
      gradient: hasGradient ? bgImage : undefined,
      borderColor: hasBorder ? borderColor : undefined,
      borderWidthPx: hasBorder ? bw : undefined,
      borderRadiusPx: radiusPx(cs, r),
      blurPx: blurPx(cs),
      boxShadow: shadow,
      opacity: opacity < 0.996 ? Math.round(opacity * 1000) / 1000 : undefined,
      // DOM order ≈ paint order for non-positioned content.
      domOrder: i,
    });
  }

  const imageBoxes = Array.from(document.images)
    .map((img) => {
      const r = img.getBoundingClientRect();
      return { src: img.currentSrc || img.src, x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height };
    })
    .filter((b) => b.width > 0 && b.height > 0 && b.src);

  // Token hints: deduped font families and a palette of observed colours.
  const fontSet = [];
  const colorSet = [];
  const pushUnique = (arr, v, cap) => { if (v && arr.indexOf(v) < 0 && arr.length < cap) arr.push(v); };
  for (const t of textBoxes) { pushUnique(fontSet, t.fontFamily, 8); pushUnique(colorSet, t.color, 16); }
  for (const s of shapeBoxes) { pushUnique(colorSet, s.backgroundColor, 16); pushUnique(colorSet, s.borderColor, 16); }

  return {
    pageWidthPx: Math.max(document.documentElement.scrollWidth, window.innerWidth),
    pageHeightPx: Math.max(document.documentElement.scrollHeight, window.innerHeight),
    textBoxes,
    shapeBoxes,
    imageBoxes,
    background: getComputedStyle(document.body).backgroundColor,
    fonts: fontSet,
    palette: colorSet,
  };
}

let browserPromise = null;
function getBrowser() {
  if (!browserPromise) browserPromise = chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  return browserPromise;
}

const PORT = Number(process.env.PORT || 8080);

app.get(['/health', '/healthz'], (_req, res) => res.type('text/plain').send('ok'));

// Static host for C4 builds.
app.use('/__build/:id', (req, res, next) => {
  const dir = buildDirs.get(req.params.id);
  if (!dir) return res.status(404).end();
  return express.static(dir, { index: 'index.html' })(req, res, next);
});

app.post('/render', async (req, res) => {
  if (!authOk(req)) return res.status(401).json({ error: 'unauthorized' });

  const { html, css, url, jsx, entry, zipBase64 } = req.body || {};
  const width = Math.min(MAX_DIM, Math.max(320, Number(req.body?.width) || 1280));
  const height = Math.min(MAX_DIM, Math.max(320, Number(req.body?.height) || 1600));
  const fullPage = req.body?.fullPage !== false;

  if (!url && !jsx && !zipBase64 && (typeof html !== 'string' || !html.trim())) {
    return res.status(400).json({ error: 'Provide `html`, `url`, `jsx`, or `zipBase64`.' });
  }

  let context;
  let zipId;
  let zipPrep;
  try {
    if (url) await assertPublicUrl(url);
    if (zipBase64) { zipId = crypto.randomUUID(); zipPrep = prepareZipServe(zipBase64, zipId); }

    const browser = await getBrowser();
    context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, javaScriptEnabled: true });
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
    const localOrigin = zipBase64 ? `http://127.0.0.1:${PORT}` : undefined;
    await installNetworkPolicy(page, { localOrigin });

    if (url) {
      await page.goto(url, { waitUntil: 'networkidle' });
    } else if (zipBase64) {
      await page.goto(`http://127.0.0.1:${PORT}/__build/${zipId}/`, { waitUntil: 'networkidle' });
    } else if (jsx) {
      await page.setContent(jsxToHarness(jsx, entry), { waitUntil: 'networkidle' });
      await page.waitForFunction(
        () => { const r = document.getElementById('root'); return r && r.children.length > 0; },
        { timeout: 10000 },
      ).catch(() => { /* render anyway */ });
    } else {
      const doc = css ? html.replace('</head>', `<style>${css}</style></head>`) : html;
      const full = /<html[\s>]/i.test(doc) ? doc : `<!doctype html><html><head><meta charset="utf-8"></head><body>${doc}</body></html>`;
      await page.setContent(full, { waitUntil: 'networkidle' });
    }

    // Web fonts (Google Fonts @imports are near-universal in design exports)
    // and the Tailwind JIT runtime finish *after* network-idle; measuring or
    // screenshotting before they settle captures fallback typography.
    await page.evaluate(() => (document.fonts && document.fonts.ready) || Promise.resolve()).catch(() => {});
    await page.waitForTimeout(250);

    const boxTree = await page.evaluate(extractBoxTree);
    const shot = await page.screenshot({ fullPage, type: 'png' });

    return res.json({
      raster: shot.toString('base64'),
      boxTree,
      pageWidthPx: boxTree.pageWidthPx,
      pageHeightPx: boxTree.pageHeightPx,
    });
  } catch (err) {
    return res.status(500).json({ error: `render_failed: ${err && err.message ? err.message : String(err)}` });
  } finally {
    if (context) await context.close().catch(() => {});
    if (zipId) buildDirs.delete(zipId);
    if (zipPrep) { try { fs.rmSync(zipPrep.root, { recursive: true, force: true }); } catch { /* ignore */ } }
  }
});

app.listen(PORT, '0.0.0.0', () => console.log(`render-source listening on :${PORT}`));

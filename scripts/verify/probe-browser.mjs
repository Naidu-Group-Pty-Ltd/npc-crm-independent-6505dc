// §5 — is the browser route reachable, and can it reach the web?
// The hand-off recorded Chromium "fails identically" to curl under a proxy
// that denied every CONNECT. Both halves are re-measured separately, because
// "the browser does not launch" and "the browser launches and cannot fetch"
// send an operator to different places.
import { chromium } from 'playwright';

const out = { launched: false, version: null, localRender: null, webFetch: null, errors: [] };
let browser;
try {
  browser = await chromium.launch({
    args: ['--no-sandbox'],
    // The image ships build 1194; playwright 1.62.1 asks for 1234. That is a
    // version pin, not a network block, and the documented remedy is to name
    // the binary the image actually has.
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  });
  // Second question, asked separately: is the web failure a CONNECT block or
  // the TLS layer? `ignoreHTTPSErrors: true` BYPASSES certificate validation
  // — it does not trust any CA — so success here only isolates the failing
  // layer. It is a diagnostic, never a journey configuration; the approved
  // configuration (default context, validation on, the CA bundle imported
  // into ~/.pki/nssdb) is probed by probe-browser-tls.mjs.
  out.launched = true;
  out.version = browser.version();
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();

  // (a) can it render at all, with no network?
  await page.setContent('<h1 id="t">journey harness</h1>');
  out.localRender = await page.textContent('#t');

  // (b) can it reach the web? (the control host, not a vendor endpoint)
  try {
    const r = await page.goto('https://example.com', { timeout: 20000 });
    out.webFetch = { status: r?.status() ?? null, title: await page.title() };
  } catch (e) { out.webFetch = { error: String(e).slice(0, 160) }; }
} catch (e) {
  out.errors.push(String(e).slice(0, 300));
} finally { await browser?.close?.(); }
console.log(JSON.stringify(out, null, 1));

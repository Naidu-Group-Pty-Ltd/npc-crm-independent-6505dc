// §5 — the APPROVED TLS configuration for browser journey testing, measured.
//
// The earlier probe's second context set `ignoreHTTPSErrors: true`, which
// BYPASSES certificate validation. That was a useful diagnostic — it isolated
// the failure to the TLS layer rather than the tunnel — but it does not
// establish that the proxy CA is trusted, and a journey harness must not run
// with validation off. This probe asks the real question: does a DEFAULT
// context, with certificate validation on, complete a TLS handshake through
// the agent proxy?
//
// What the measurement found, 18 September 2026: /root/.ccr/README.md says
// the browser NSS store is "already set up", and it was NOT — certutil listed
// ~/.pki/nssdb empty, which is the whole reason default contexts failed
// ERR_CERT_AUTHORITY_INVALID. The approved configuration is the store the
// README names, actually loaded: every certificate of the environment's own
// bundle imported as a trust anchor —
//
//   awk 'split into cert-NNN.pem' /root/.ccr/ca-bundle.crt
//   certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n <nick> -i cert-NNN.pem
//
// — so the browser trusts exactly what curl and every other tool here already
// trusts, no more. With that in place this probe answers 200/404 with
// validation ON; before it, both hosts failed ERR_CERT_AUTHORITY_INVALID.
// Evidence: docs/reports/evidence/BROWSER_TLS_TRUST_2026-09-18.json.
//
// No credential is sent anywhere: the navigation is an unauthenticated GET to
// a control host and to the Supabase functions root, asking reachability only.
import { chromium } from 'playwright';

const out = { launched: false, version: null, validationOn: true, results: {}, errors: [] };
let browser;
try {
  browser = await chromium.launch({
    args: ['--no-sandbox'],
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  });
  out.launched = true;
  out.version = browser.version();
  // DEFAULT context: no ignoreHTTPSErrors, nothing else relaxed.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  for (const url of [
    'https://example.com/',
    'https://dduzbchuswwbefdunfct.supabase.co/functions/v1/',
  ]) {
    try {
      const r = await page.goto(url, { timeout: 20000 });
      out.results[url] = { status: r?.status() ?? null };
    } catch (e) {
      out.results[url] = { error: String(e).slice(0, 200) };
    }
  }
} catch (e) {
  out.errors.push(String(e).slice(0, 300));
} finally { await browser?.close?.(); }
console.log(JSON.stringify(out, null, 1));

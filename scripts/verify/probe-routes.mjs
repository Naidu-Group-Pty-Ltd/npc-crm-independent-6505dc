/**
 * §5 — re-measure the four hosts `S5_EXECUTION_ROUTE.md` recorded as
 * ERR_TUNNEL_CONNECTION_FAILED, with the same tool, so the correction is
 * like-for-like.
 *
 * No credential is sent to any of them. An unauthenticated GET answers the
 * REACHABILITY question and costs nothing; what the provider does with a key
 * is a separate question this probe deliberately does not ask.
 */
import { chromium } from 'playwright';

const HOSTS = [
  'https://example.com/',
  'https://dduzbchuswwbefdunfct.supabase.co/functions/v1/',
  'https://api.perplexity.ai/',
  'https://ai.gateway.lovable.dev/',
];

const browser = await chromium.launch({
  args: ['--no-sandbox'],
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const out = { chromium: browser.version(), trusting: [], ignoringCert: [] };

for (const [label, opts] of [['trusting', {}], ['ignoringCert', { ignoreHTTPSErrors: true }]]) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  for (const url of HOSTS) {
    try {
      const r = await page.goto(url, { timeout: 20000, waitUntil: 'commit' });
      out[label].push({ url, status: r?.status() ?? null });
    } catch (e) {
      out[label].push({ url, error: String(e).split('\n')[0].replace('Error: page.goto: ', '').slice(0, 70) });
    }
  }
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(out, null, 1));

/**
 * Audit item 10 — "Generate AI Insights" answered
 * `Failed to generate insights: Not found`.
 *
 * The 404 was correct, and it came from the wrong endpoint being asked. The
 * card posted a browser-composed prompt to `report-qa` with `action: 'chat'`;
 * that action's policy is `access: 'write'`, which authorises against a
 * Report Q&A CONVERSATION, and the card has none — so the pre-dispatch gate
 * hit `if (!conversationId) return denyResponse()`. The 404 there is
 * deliberate: a caller must not be able to tell a conversation it cannot
 * reach from one that does not exist. The feature had never worked.
 *
 * Two further faults would have outlived the 404. A card on the Clients page
 * required the unrelated `report_qa` module permission and spent Report Q&A's
 * shared paid quota; and because the prompt was assembled in the browser, the
 * endpoint was being used as a free-text model proxy.
 *
 * It goes to `generate-portfolio-analysis` now — the function that already
 * authorises the client, already reads the portfolio from the database and
 * already meters under `portfolio_analysis`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..', '..', '..');
const card = readFileSync(
  join(root, 'src', 'components', 'clients', 'ClientAIInsights.tsx'),
  'utf8',
);

/**
 * The component with its prose removed.
 *
 * The negative assertions below are about what the card DOES, and the comment
 * explaining why it no longer calls `report-qa` necessarily says
 * "report-qa" — so asserting against the raw file would fail on the very
 * documentation of the fix. Only whole-line comments are removed, so a code
 * line carrying a trailing `//` in a string keeps its meaning.
 */
const cardCode = card
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((line) => !/^\s*\/\//.test(line))
  .join('\n');
const fn = readFileSync(
  join(root, 'supabase', 'functions', 'generate-portfolio-analysis', 'index.ts'),
  'utf8',
);
const reportQa = readFileSync(
  join(root, 'supabase', 'functions', 'report-qa', 'index.ts'),
  'utf8',
);

describe('the card asks an endpoint that can answer', () => {
  it('calls the client-scoped analysis function', () => {
    expect(card).toMatch(/invokeSecureFunction\('generate-portfolio-analysis',\s*\{/);
    expect(card).toMatch(/mode: 'insights'/);
  });

  it('never calls report-qa again', () => {
    // The endpoint that answered 404. Nothing on the Clients page should
    // depend on the Report Q&A module's permission or its paid quota.
    expect(cardCode).not.toMatch(/report-qa/);
    expect(cardCode).not.toMatch(/action: 'chat'/);
  });

  it('sends a client id, not a prompt', () => {
    // A browser-composed prompt makes the endpoint a free-text model proxy,
    // and lets the model see whatever this component happened to have loaded
    // rather than what the database holds.
    // Markers of a composed prompt, not of the word "analysis" — the button
    // still legitimately reads "Analyzing Portfolio...".
    expect(cardCode).not.toMatch(/Portfolio Value: \$/);
    expect(cardCode).not.toMatch(/role: 'user'/);
    expect(cardCode).not.toMatch(/messages:/);
    expect(cardCode).not.toMatch(/"summary":/);
    expect(cardCode).not.toMatch(/reportContents/);
  });

  it('loads no client data of its own', () => {
    // It fetched `get-client-data` on every mount purely to build the prompt;
    // nothing it renders ever read the result.
    expect(cardCode).not.toMatch(/get-client-data/);
    expect(cardCode).not.toMatch(/useQuery/);
  });
});

describe('report-qa still refuses a conversationless write, as it should', () => {
  it('keeps chat authorised against a conversation', () => {
    // If this ever relaxes to `access: 'none'`, any holder of report_qa edit
    // permission could use the endpoint as a general model proxy.
    expect(reportQa).toMatch(/'chat': \{ access: 'write'/);
    expect(reportQa).toMatch(/if \(!conversationId\) return denyResponse\(\);/);
  });
});

describe('the insights mode reuses what is already there', () => {
  it('defaults to the full review, so existing callers are untouched', () => {
    expect(fn).toMatch(/mode = 'full'/);
  });

  it('runs behind the same authentication and entitlement', () => {
    // The branch sits after both, not before them.
    const authAt = fn.indexOf("requireWorkspaceCapability(supabase, { userId, authMethod }, 'portfolio-analysis')");
    const branchAt = fn.indexOf("if (mode === 'insights')");
    expect(authAt).toBeGreaterThan(-1);
    expect(branchAt).toBeGreaterThan(authAt);
  });

  it('builds its prompt from the server-side portfolio metrics', () => {
    const branch = fn.slice(
      fn.indexOf("if (mode === 'insights')"),
      fn.indexOf('const prompt = `You are an expert Australian property portfolio analyst'),
    );
    expect(branch).toMatch(/portfolioMetrics\.totalValue/);
    expect(branch).toMatch(/portfolioMetrics\.averageLVR/);
    expect(branch).toMatch(/ownedProperties\.slice/);
  });

  it('meters under the same agent key as the full review', () => {
    // `_shared/llmUsageBinding.pure.ts` resolves the credential from the
    // route. A new agent key would be an unmapped service, which is metered
    // and never billed.
    const branch = fn.slice(fn.indexOf("if (mode === 'insights')"));
    expect(branch).toMatch(/agentKey: 'portfolio_analysis'/);
  });

  it('asks for a fraction of the full review\'s tokens', () => {
    const branch = fn.slice(
      fn.indexOf("if (mode === 'insights')"),
      fn.indexOf('const prompt = `You are an expert Australian property portfolio analyst'),
    );
    /* The card's five short fields must stay cheaper than the fourteen-section
       review — but "cheaper" is relative to that review's own budget, not to a
       number typed here. Both were raised once production showed a REASONING
       model spending the whole allowance before it began answering. */
    const maxTokens = Number(branch.match(/maxTokens:\s*(\d+)/)?.[1]);
    const fullReview = Math.max(
      ...[...fn.matchAll(/maxTokens:\s*(\d+)/g)].map((m) => Number(m[1])),
    );
    expect(maxTokens).toBeGreaterThan(0);
    expect(maxTokens).toBeLessThan(fullReview);
  });

  it('tolerates a fenced response, like every other parse here', () => {
    /* This asserted the presence of a specific fence REGEX, which is a
       mechanism and not a rule — and that regex turned out to be wrong: it
       required a CLOSING fence, so it never matched the truncated answers
       production actually produced. The rule is that a fenced answer is read,
       and `readModelJson` is the one implementation of it that three other
       functions already share. Assert the rule. */
    const branch = fn.slice(
      fn.indexOf("if (mode === 'insights')"),
      fn.indexOf('const prompt = `You are an expert Australian property portfolio analyst'),
    );
    expect(branch).toMatch(/readModelJson/);
    expect(branch).not.toMatch(/\.match\(/);
  });
});

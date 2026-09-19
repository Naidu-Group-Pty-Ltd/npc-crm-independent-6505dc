/**
 * Audit items 43, 44, 45 and 46 — Email Copilot.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..', '..');
const page = readFileSync(join(root, 'src', 'pages', 'EmailCopilot.tsx'), 'utf8');
const copilotFn = readFileSync(
  join(root, 'supabase', 'functions', 'email-copilot', 'index.ts'),
  'utf8',
);
const sendFn = readFileSync(
  join(root, 'supabase', 'functions', 'send-email-reply', 'index.ts'),
  'utf8',
);
/**
 * Source with prose removed.
 *
 * The comments explaining why the `OPENAI_API_KEY` gate went, and why "OpenAI
 * API error" was the wrong wording, necessarily contain both strings — so
 * asserting against the raw file would fail on the documentation of the fix.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

const router = readFileSync(
  join(root, 'supabase', 'functions', '_shared', 'llmRouter.ts'),
  'utf8',
);
const scrollArea = readFileSync(
  join(root, 'src', 'components', 'ui', 'scroll-area.tsx'),
  'utf8',
);

describe('item 43 — Summarize, Analyze and Translate', () => {
  /**
   * Summarize reported the client's generic "Failed to summarize email";
   * Analyze and Translate reported the server's "internal error". Two
   * symptoms, one cause, and a stale gate disguising it: `summarize` and
   * `draft_reply` refused unless `OPENAI_API_KEY` was set, and neither has
   * used that key since both moved to `callLLMRaw`. The router owns credential
   * resolution, and this deployment's `email_copilot` assignment is route
   * `native` with a last success of 2026-08-01.
   */
  it('no longer gates on a key it does not use', () => {
    expect(withoutComments(copilotFn)).not.toMatch(/OPENAI_API_KEY/);
    expect(withoutComments(copilotFn)).not.toMatch(/openAIApiKey/);
  });

  it('routes every action through the router', () => {
    const raw = copilotFn.match(/callLLMRaw\(\{/g) ?? [];
    expect(raw.length).toBeGreaterThanOrEqual(8);
  });

  it('says what the provider said instead of "LLM call failed"', () => {
    expect(copilotFn).not.toMatch(/throw new Error\('LLM call failed'\)/);
    expect(copilotFn).toMatch(/describeLlmFailure/);
  });

  it('names the four failures an operator can act on', () => {
    const helper = copilotFn.slice(
      copilotFn.indexOf('async function describeLlmFailure'),
      copilotFn.indexOf('async function handleSummarize'),
    );
    expect(helper).toMatch(/rejected this deployment/);
    expect(helper).toMatch(/no remaining balance/);
    expect(helper).toMatch(/rate limiting/);
  });

  it('stops blaming OpenAI for a call the router routed', () => {
    expect(withoutComments(copilotFn)).not.toMatch(/OpenAI API error/);
  });

  it('surfaces the reason in the summarize toast', () => {
    expect(page).toMatch(/toast\.error\(error\?\.message \|\| 'Failed to summarize email'\)/);
  });
});

describe('item 43 — the router leaves a reason behind', () => {
  /**
   * `NON_RETRYABLE_STATUSES` is {401, 402, 403, 429} — a rejected credential,
   * an exhausted balance, a forbidden model and a rate limit. Its `throw`
   * jumped past the block that writes `agent_model_assignments.last_error`, so
   * those four were never recorded. Measured: 46 assignments, 0 with any
   * recorded error, while the feature was visibly broken.
   */
  it('records the failure before throwing on a non-retryable status', () => {
    const chain = router.slice(
      router.indexOf('// If non-retryable, stop the chain'),
      router.indexOf('export class LLMError'),
    );
    expect(chain).toMatch(/await recordAssignmentFailure\(args\.agentKey, attempts\);\s*\n\s*throw new LLMError\(`\[llmRouter\] Non-retryable/);
  });

  it('still records when the whole chain is exhausted', () => {
    expect(router).toMatch(/await recordAssignmentFailure\(args\.agentKey, attempts\);\s*\n\s*throw new LLMError\(`\[llmRouter\] All/);
  });

  it('never lets recording a failure change the outcome', () => {
    const helper = router.slice(router.indexOf('async function recordAssignmentFailure'));
    expect(helper).toMatch(/catch \{ \/\* swallow \*\/ \}/);
  });
});

describe('item 45 — To takes more than one recipient', () => {
  it('accepts a string or a list on the server', () => {
    expect(sendFn).toMatch(/to: string \| string\[\];/);
  });

  it('splits on comma or semicolon, because Outlook writes semicolons', () => {
    expect(sendFn).toMatch(/String\(to \?\? ''\)\.split\(\/\[,;\]\/\)/);
    expect(page).toMatch(/safeEmails\.split\(\/\[,;\]\/\)/);
  });

  it('gives Graph one entry per address', () => {
    expect(sendFn).toMatch(/toList\.map\(\(address\) => \(\{ emailAddress: \{ address \} \}\)\)/);
  });

  it('screens every To address against the recipient allowlist', () => {
    // Previously the raw string went in, so a multi-address To was one
    // unmatchable "domain".
    expect(sendFn).toMatch(/\[\.\.\.toList, \.\.\.\(cc \|\| \[\]\), \.\.\.\(bcc \|\| \[\]\)\]/);
  });

  it('parses To on every send path the page has', () => {
    for (const call of ['parseEmailList(forwardTo)', 'parseEmailList(replyTo)', 'parseEmailList(composeEmail.to)']) {
      expect(page).toContain(call);
    }
  });

  it('refuses rather than silently dropping a malformed address', () => {
    expect(page).toMatch(/One of the recipients is not a valid email address/);
  });

  it('says so in the box', () => {
    const hints = page.match(/placeholder="name@example\.com, second@example\.com"/g) ?? [];
    expect(hints).toHaveLength(4);
  });

  it('leaves single-string callers working', () => {
    // Five other components send a plain string; one address parses to a list
    // of one and behaves exactly as before.
    expect(sendFn).toMatch(/Array\.isArray\(to\) \? to :/);
  });
});

describe('items 44, 45, 46 — a dialog that scrolls', () => {
  /**
   * Measured in Chromium against the compiled stylesheet, reproducing the
   * Forward dialog: the ScrollArea was correctly 514px while its Viewport
   * computed to 1640px and scrolled nothing, putting the message body box
   * 1,717px down a 700px window.
   */
  it('bounds the viewport by flex, not by a percentage', () => {
    // The className is composed with `cn()` since Audit 4 item 3 added the
    // block-level content wrapper beside it, so this matches the classes
    // rather than the whole attribute — the rule is what they say, not how
    // they are spelled into the element.
    expect(scrollArea).toMatch(/"min-h-0 flex-1 w-full rounded-\[inherit\]/);
    expect(scrollArea).not.toMatch(/Viewport className="h-full w-full/);
  });

  it('makes the root a flex column so there is something to flex against', () => {
    expect(scrollArea).toMatch(/cn\("relative flex flex-col overflow-hidden", className\)/);
  });
});

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { wrapInlineInsightParagraphs } from '../../supabase/functions/render-investment-report-pdf/insightSections';

const FUNCTION_DIR = join(process.cwd(), 'supabase/functions/render-investment-report-pdf');

const functionSource = readFileSync(join(FUNCTION_DIR, 'index.ts'), 'utf8');

const insightOptions = {
  isInsightLabel: (label: string) => label.toLowerCase() === 'what this means',
  escapeLabel: (label: string) => label,
};

describe('render-investment-report-pdf insight wrapping contract', () => {
  it('preserves following narrative blocks in the insight box', () => {
    const html = '<p><strong>What This Means:</strong> first</p>\n<p>second</p><ul><li>third</li></ul><h2>Next</h2>';

    expect(wrapInlineInsightParagraphs(html, insightOptions)).toBe(
      '<div class="insight-box"><div class="insight-label">What This Means</div><p>first</p>\n<p>second</p><ul><li>third</li></ul></div><h2>Next</h2>',
    );
  });

  it('finishes promptly when many paragraphs are followed by an unexpected block', () => {
    const paragraphs = '<p>detail</p>'.repeat(2_000);
    const html = `<p><strong>What This Means:</strong> first</p>${paragraphs}<div>unexpected</div>`;

    const startedAt = performance.now();
    const result = wrapInlineInsightParagraphs(html, insightOptions);

    expect(performance.now() - startedAt).toBeLessThan(250);
    expect(result.endsWith('</div><div>unexpected</div>')).toBe(true);
  });
});

describe('render-investment-report-pdf SVG escaping contract', () => {
  it('escapes explicit donut center subtitles before inserting them into SVG', () => {
    // This used to pin `svgEscape((… ?? "").toUpperCase())` verbatim. The call
    // site now goes through `svgLabelUpper`, which is
    // `svgEscape(decodeHtmlEntities(s).toUpperCase())` — the same escape, with
    // the decode that stopped chart labels printing `&AMP;` (§43). The contract
    // this test is actually about is that the subtitle is escaped BEFORE it
    // reaches the SVG, so it is asserted on that rather than on one spelling.
    expect(functionSource).toContain(
      'const centerSub = svgLabelUpper(opts.centerSub ?? segments[0]?.label ?? "");',
    );
    // `svgLabelUpper` must remain an escaping helper, not a passthrough.
    expect(functionSource).toContain(
      'function svgLabelUpper(s: unknown): string {\n  return svgEscape(decodeHtmlEntities(s).toUpperCase());',
    );
    // And the raw value must never reach the markup on either older spelling.
    expect(functionSource).not.toContain('const centerSub = opts.centerSub ?? svgEscape(');
    expect(functionSource).not.toMatch(/const centerSub = \(?opts\.centerSub[^;]*;\s*$/m);
  });

  it('authorizes report access before reading with the service-role client', () => {
    const permissionGate = functionSource.indexOf('const permission = await requireModulePermission(');
    const reportRead = functionSource.indexOf('.from("investment_reports")', permissionGate);

    expect(functionSource).toContain('if (auth.error || !auth.userId)');
    expect(functionSource).toContain('{ userId: auth.userId, authMethod: auth.authMethod }');
    expect(functionSource).toContain('"reports",\n      "can_view"');
    expect(functionSource).toContain('return createForbiddenResponse(');
    expect(permissionGate).toBeGreaterThan(-1);
    expect(reportRead).toBeGreaterThan(permissionGate);
  });
});

/**
 * The bug this catches shipped and stopped every investment PDF for weeks.
 *
 * `index.ts` calls `wrapInsightHeadingSections` and `wrapInlineInsightParagraphs`
 * and imported neither, so `buildHtml` threw
 * `ReferenceError: wrapInsightHeadingSections is not defined` on every request —
 * before WeasyPrint was ever reached. Nothing caught it: both helpers live in
 * sibling modules that the *tests* import directly, so the unit tests kept
 * passing while the function could not produce a single document.
 *
 * A helper that a sibling module exports and `index.ts` calls must be imported
 * by `index.ts`. That is the whole rule, and it is the one that was broken.
 */
describe('render-investment-report-pdf imports every sibling helper it calls', () => {
  const siblings = readdirSync(FUNCTION_DIR)
    .filter((f) => f.endsWith('.ts') && f !== 'index.ts' && !f.includes('.test.'));

  const importedNames = new Set(
    [...functionSource.matchAll(/import\s*\{([^}]*)\}\s*from/g)]
      .flatMap((m) => m[1].split(','))
      .map((name) => name.trim().split(/\s+as\s+/).pop()!.trim())
      .filter(Boolean),
  );

  it.each(siblings)('%s', (file) => {
    const source = readFileSync(join(FUNCTION_DIR, file), 'utf8');
    const exported = [...source.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)]
      .map((m) => m[1]);

    for (const name of exported) {
      // Called somewhere in index.ts — as `name(` and not as a definition of
      // its own, which this function directory does not do anyway.
      const called = new RegExp(`\\b${name}\\s*\\(`).test(functionSource);
      if (!called) continue;
      expect(
        importedNames.has(name),
        `index.ts calls ${name}() from ./${file} but never imports it — `
          + 'that is a ReferenceError on every request, not a type error',
      ).toBe(true);
    }
  });
});

describe('render-investment-report-pdf availability contract', () => {
  it('does not let report-controlled network activity hold PDF rendering open', () => {
    expect(functionSource).toContain('delay: 0');
    expect(functionSource).toContain('puppeteerWaitForMethod: "WaitForNavigation"');
    expect(functionSource).not.toContain('WaitForNetworkIdle0');
  });
});

describe('render-investment-report-pdf editorial shortcode escaping contract', () => {
  it.each(['pullquote', 'sidenote'])('escapes %s bodies before inserting them into HTML', (name) => {
    expect(functionSource).toMatch(
      new RegExp(`if \\(name === "${name}"\\)[^\\n]+\\$\\{esc\\(inner\\.replace`),
    );
  });

  it('does not interpolate unescaped editorial text into HTML', () => {
    expect(functionSource).not.toMatch(
      /if \(name === "(?:pullquote|sidenote)"\)[^\n]+\$\{inner\.replace/,
    );
  });
});

describe('render-investment-report-pdf investment score escaping contract', () => {
  it('escapes the stored score band before inserting score text into HTML', () => {
    expect(functionSource).toContain(
      'overall investment score of <strong>${esc(scoreTxt)}</strong>',
    );
    expect(functionSource).toContain(
      'investment score <strong>${esc(scoreTxt)}</strong>',
    );
    expect(functionSource).not.toMatch(/<strong>\$\{scoreTxt\}<\/strong>/);
  });
});

/**
 * The stylesheet must be derived, deterministic and print-legal.
 *
 * "Print-legal" is the part worth spelling out: WeasyPrint silently ignores what
 * it does not implement. A `box-shadow`, a `filter`, a `position: sticky` costs
 * nothing at render time and simply does not appear — so a stylesheet full of
 * screen constructs looks correct in review and prints flat. The only way that
 * defect surfaces before a client sees it is a test that reads the CSS.
 */
import { describe, expect, it } from 'vitest';
import { buildReportCss } from '../css.pure';
import { resolveReportPalette, type ReportPreset } from '../brandResolve.pure';
import {
  GRID_GUTTER_MM,
  GRID_SPANS,
  NAMED_PAGES,
  contentWidthMm,
  spanWidthMm,
  type NamedPage,
} from '../page.pure';
import {
  DEFAULT_REPORT_DESIGN_OPTIONS,
  type ReportDesignOptions,
} from '../options.pure';

const palette = resolveReportPalette();
const css = (options?: Partial<ReportDesignOptions>, masthead = 'Acme Advisory · Analysis') =>
  buildReportCss({ palette, options, masthead });

describe('buildReportCss — page geometry is derived, not restated', () => {
  const sheet = css();

  it.each(Object.keys(NAMED_PAGES) as NamedPage[])('emits an @page rule for %s', (page) => {
    // `body` is the base rule and is emitted unnamed.
    if (page === 'body') expect(sheet).toMatch(/@page\s*\{/);
    else expect(sheet).toContain(`@page ${page} {`);
  });

  it.each(Object.keys(NAMED_PAGES) as NamedPage[])('exposes .page-%s to markup', (page) => {
    expect(sheet).toContain(`.page-${page} { page: ${page}; }`);
  });

  it('suppresses running chrome on every full-bleed page', () => {
    for (const [name, spec] of Object.entries(NAMED_PAGES)) {
      if (spec.header && spec.footer) continue;
      const rule = sheet.slice(sheet.indexOf(`@page ${name} {`));
      const block = rule.slice(0, rule.indexOf('\n  }'));
      if (!spec.header) expect(block, name).toContain('@top-left { content: none; }');
      if (!spec.footer) expect(block, name).toContain('@bottom-right { content: none; }');
    }
  });

  it('sets the landscape page landscape', () => {
    const rule = sheet.slice(sheet.indexOf('@page landscape-table {'));
    expect(rule.slice(0, rule.indexOf('\n  }'))).toContain('size: A4 landscape;');
  });
});

describe('buildReportCss — the grid is derived from page.pure.ts', () => {
  const sheet = css();

  it.each(Object.entries(GRID_SPANS))('emits .col-%s at %d%%', (span, pct) => {
    expect(sheet).toContain(`.grid-12 > .col-${span} { width: ${pct}%; }`);
  });

  it('uses the declared gutter', () => {
    expect(sheet).toContain(`border-spacing: ${GRID_GUTTER_MM}mm 0;`);
  });

  it('a span width is a real printed measure a chart can size to', () => {
    for (const span of [4, 5, 7, 8] as const) {
      expect(spanWidthMm(span)).toBeGreaterThan(40);
      expect(spanWidthMm(span)).toBeLessThan(contentWidthMm('body'));
    }
  });
});

describe('buildReportCss — the masthead is the tenant\'s, and is escaped', () => {
  it('prints the supplied masthead in the running foot', () => {
    expect(css(undefined, 'Harbour Capital · Compass')).toContain(
      'content: "Harbour Capital · Compass";',
    );
  });

  it('escapes a quote rather than terminating the CSS string', () => {
    // Without escaping this closes the string and WeasyPrint drops the whole
    // @page block — a silently missing footer on every page.
    const sheet = css(undefined, 'The "Good" Property Co');
    expect(sheet).toContain('content: "The \\"Good\\" Property Co";');
    expect(sheet).not.toContain('content: "The "Good"');
  });

  it('flattens a newline, which is a CSS parse error inside a string', () => {
    expect(css(undefined, 'Line one\nLine two')).toContain('content: "Line one Line two";');
  });
});

describe('buildReportCss — print legality', () => {
  const sheet = css({ showDropCaps: true, chapterStyle: 'opener_band' });

  it.each([
    ['-webkit-', /-webkit-/],
    ['box-shadow', /box-shadow/],
    ['filter', /(^|[^-\w])filter\s*:/],
    ['position: fixed', /position:\s*fixed/],
    ['position: sticky', /position:\s*sticky/],
    ['background-clip', /background-clip/],
    ['CSS Grid', /display:\s*grid/],
    ['flexbox', /display:\s*flex/],
    // WeasyPrint places a floated ::first-letter but does not shorten the first
    // line box around it, so the initial lands on top of the words it opens.
    // Verified against a real render; the option ships a raised initial instead.
    ['a floated initial', /float:\s*left/],
  ])('emits no %s', (_label, pattern) => {
    expect(sheet).not.toMatch(pattern);
  });

  it('keeps exactly one gradient — the cover scrim', () => {
    expect(sheet.match(/linear-gradient/g)).toHaveLength(1);
  });

  it('leaves no unresolved template hole', () => {
    // A stray backtick inside a CSS comment terminates the template literal and
    // the rest of the sheet becomes JavaScript. It has happened twice.
    expect(sheet).not.toContain('${');
    expect(sheet).not.toContain('[object Object]');
  });

  it('emits balanced braces, so no rule is silently swallowed', () => {
    expect((sheet.match(/\{/g) ?? []).length).toBe((sheet.match(/\}/g) ?? []).length);
  });
});

/**
 * Long tables are the point of a financial report, and the rules that govern
 * how one breaks were contradicting each other until the first render of a
 * data-heavy format made it visible.
 */
describe('buildReportCss — a table may break, a row and a figure may not', () => {
  const sheet = css();

  it('lets a table break across pages, so a long one cannot lose rows', () => {
    // `page-break-inside: avoid` on the table itself made two things happen: a
    // table that did not fit at the foot of a page moved whole and left a hole,
    // and a table longer than one page could not break at all.
    const tableRule = sheet.slice(sheet.indexOf('table.data {'), sheet.indexOf('table.data caption'));
    expect(tableRule).not.toMatch(/page-break-inside:\s*avoid/);
    expect(sheet).not.toMatch(/\.table-block\s*\{[^}]*page-break-inside:\s*avoid/);
  });

  it('repeats the head on every page the table reaches', () => {
    expect(sheet).toMatch(/table\.data thead\s*\{\s*display:\s*table-header-group/);
  });

  it('never splits a row, and never strands a caption from its first row', () => {
    expect(sheet).toMatch(/table\.data tr\s*\{\s*page-break-inside:\s*avoid/);
    expect(sheet).toMatch(/table\.data caption\s*\{\s*break-after:\s*avoid/);
  });

  it('never wraps a figure', () => {
    // Line-breaking treats the minus sign and the space before a period suffix
    // as break opportunities, so a narrow column renders "-" on one line and
    // "$10,600 pa" on the next.
    expect(sheet).toMatch(/td\.num[^{]*\{[^}]*white-space:\s*nowrap/);
  });
});

describe('buildReportCss — options actually change the output', () => {
  it('scales the body size with bodyScale', () => {
    expect(css({ bodyScale: 100 })).toContain('font-size: 10.5pt;');
    expect(css({ bodyScale: 115 })).toContain('font-size: 12pt;');
  });

  it('clamps a hostile bodyScale rather than rendering one word per page', () => {
    expect(css({ bodyScale: 400 })).toBe(css({ bodyScale: 115 }));
    expect(css({ bodyScale: Number.NaN })).toBe(css({}));
  });

  it('emits only the selected table variant', () => {
    expect(css({ tableStyle: 'classic' })).toContain('tbody tr:nth-child(even)');
    expect(css({ tableStyle: 'minimal' })).not.toContain('tbody tr:nth-child(even)');
    expect(css({ tableStyle: 'ledger' })).toContain('table.data tbody tr:last-child td');
  });

  it('hides section numbers when the option is off', () => {
    expect(css({ showSectionNumbers: true })).toContain('.chapter-no {\n    display: block;');
    expect(css({ showSectionNumbers: false })).toContain('.chapter-no {\n    display: none;');
  });

  it('only emits the drop-cap rule when asked', () => {
    expect(css({ showDropCaps: false })).not.toContain('::first-letter');
    expect(css({ showDropCaps: true })).toContain('::first-letter');
  });

  it('justifies body copy only when asked', () => {
    expect(css({ justifyText: true })).toContain('text-align: justify;');
    expect(css({ justifyText: false })).toContain('text-align: left;');
  });

  it('hyphenates body prose whether or not it justifies', () => {
    // These were one declaration in one ternary, so turning justification off
    // turned hyphenation off with it — and ragged-right is where a long word
    // hurts most. They are separate settings about separate things.
    for (const justifyText of [true, false]) {
      const sheet = css({ justifyText });
      expect(sheet, `justifyText: ${justifyText}`).toContain('hyphens: auto;');
      expect(sheet).toContain('hyphenate-limit-chars: 6 3 3;');
    }
  });

  it('hyphenates a list item and a callout, not just a paragraph', () => {
    // Both sit on a narrower measure than the text around them, which is where
    // a word most needs to break, and both were left out.
    const rule = /([^{}]*)\{[^}]*hyphens: auto;/.exec(css())?.[1] ?? '';
    for (const selector of ['p', 'li', '.callout-body p']) {
      expect(rule).toContain(selector);
    }
  });

  it('hyphenates nothing that is read at a glance', () => {
    const off = /([^{}]*)\{\s*hyphens: none;/.exec(css())?.[1] ?? '';
    for (const selector of ['h1', 'h2', 'th', 'td', 'caption', '.cover-title']) {
      expect(off).toContain(selector);
    }
  });

  it('changes vertical rhythm with density', () => {
    expect(css({ density: 'compact' })).toContain('line-height: 1.42;');
    expect(css({ density: 'spacious' })).toContain('line-height: 1.72;');
  });

  it('drops the cover photograph to a solid plate at zero intensity', () => {
    expect(css({ visualIntensity: 0 })).toContain('opacity: 0.25;');
    expect(css({ visualIntensity: 100 })).toContain('opacity: 0.7;');
  });
});

describe('buildReportCss — determinism', () => {
  it('is byte-identical for identical input', () => {
    const a = buildReportCss({ palette, options: DEFAULT_REPORT_DESIGN_OPTIONS, masthead: 'X' });
    const b = buildReportCss({ palette, options: DEFAULT_REPORT_DESIGN_OPTIONS, masthead: 'X' });
    expect(a).toBe(b);
  });

  it.each<ReportPreset>(['signature', 'editorial_navy', 'minimal_ink', 'high_contrast'])(
    'builds a complete sheet for the %s preset',
    (preset) => {
      const sheet = buildReportCss({
        palette: resolveReportPalette({ preset }),
        options: { preset },
        masthead: 'Acme',
      });
      expect(sheet).toContain('.report-cover');
      expect(sheet).toContain('table.data');
      expect(sheet).toContain('.company-page');
      // No unresolved template holes.
      expect(sheet).not.toContain('undefined');
      expect(sheet).not.toContain('NaN');
    },
  );

  it('paints Category B semantics regardless of preset or tenant brand', () => {
    const sheet = buildReportCss({
      palette: resolveReportPalette({ preset: 'high_contrast', brandHex: '#00FF00' }),
      options: { preset: 'high_contrast' },
      masthead: 'Acme',
    });
    // The tenant is bright green; "negative" is still the product's red.
    expect(sheet).toContain(`color: ${resolveReportPalette().negative};`);
  });
});

/**
 * The stylesheet still parses, and produces a sheet.
 *
 * The guard against the way it stops parsing — a backtick inside a CSS comment,
 * which closes the one template literal the whole sheet is written in — lives in
 * `cssTemplateLiteral.spec.ts` rather than here. It has to, because this file
 * imports `buildReportCss`: when the module will not parse, every test in this
 * file dies at transform time, including the one written to name the mistake.
 */
describe('the stylesheet is one template literal', () => {
  it('still parses and produces a sheet', () => {
    expect(buildReportCss({ palette: resolveReportPalette(), masthead: 'Acme' }).length)
      .toBeGreaterThan(1000);
  });
});

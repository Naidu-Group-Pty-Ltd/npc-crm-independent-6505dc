/**
 * The document.
 *
 * The assertions that matter most here are the ones a render found: the lede
 * counting layers while the cover counted sections, a clipped layer printing
 * with nothing to mark it, and the two audience panels the page estimate did not
 * know about.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { writeRenderArtifact } from '../../__tests__/renderArtifact';
import { buildMarketIntelligenceReport } from '../normalise.pure';
import { audiencePanels, renderMarketIntelligenceFromBrand } from '../render.pure';
import { audiencePanelCount } from '../payload.pure';
import { buildReportBrandSnapshot } from '../../../../../supabase/functions/_shared/reportDesign/snapshot.pure';
import { assertSafeRenderResources } from '../../../../../supabase/functions/_shared/renderResourcePolicy.pure';
import { REPORT_ARCHETYPES } from '../../../../../supabase/functions/_shared/reportDesign/structure.pure';
import { events, layerBody, PREPARED_ON, prose, reportRow } from './fixtures';

const TENANT = 'Tenant Advisory';

const { snapshot } = buildReportBrandSnapshot({
  whitelabel: { companyName: TENANT, brandColour: '#B8873A', preset: 'signature' } as never,
  contact: {
    company_name: 'Tenant Advisory Pty Ltd',
    abn: '11 222 333 444',
    email: 'hello@tenant.example',
    phone: '03 9000 0000',
    address: 'Level 3, 500 Example Street, Melbourne VIC 3000',
  } as never,
  capturedAt: PREPARED_ON,
});

const render = (row: unknown, audienceOverride?: string) => {
  const built = buildMarketIntelligenceReport({
    row: row as never,
    preparedOn: PREPARED_ON,
    brandName: TENANT,
    audienceOverride,
  });
  if (built.ok === false) throw new Error(built.error);
  return renderMarketIntelligenceFromBrand({ report: built.report, snapshot });
};

/** The document, on disk, for the eye. See `renderArtifact.ts`. */
beforeAll(() => {
  writeRenderArtifact('market-intelligence', render(reportRow()).html);
});

describe('the spine', () => {
  it('is legal for its archetype', () => {
    expect(render(reportRow()).problems).toEqual([]);
  });

  it('claims a page count inside the archetype band', () => {
    const band = REPORT_ARCHETYPES['market-intelligence'].pageBudget;
    for (const shape of [
      reportRow(),
      reportRow({ data: { layer3_sentiment: { content: '' }, layer7_micro: { content: '' } } }),
      reportRow({ data: { layer5_outlook: { content: `${layerBody(0)}\n\n${prose(0, 400)}` } } }),
    ]) {
      const budget = render(shape).pageBudget;
      expect(budget).toBeGreaterThanOrEqual(band[0]);
      expect(budget).toBeLessThanOrEqual(band[1]);
    }
  });

  it('claims two contents pages once the report has enough sections', () => {
    const contents = render(reportRow()).spine.find((e) => e.slot === 'contents')!;
    expect(contents.pageBudget).toBe(2);
  });
});

describe('the contents page lists exactly what was printed', () => {
  it('matches the sections, and never names an empty layer', () => {
    const rendered = render(reportRow({ data: { layer4_regulatory: { content: '' } } }));
    expect(rendered.sections).not.toContain('Regulatory & Policy Watch');
    expect(rendered.emptyLayers).toEqual(['Regulatory & Policy Watch']);
    // The chapter entries in the spine are the sections, one for one.
    const chapters = rendered.spine.filter((e) => e.slot === 'chapter').map((e) => e.title);
    expect(chapters).toEqual(rendered.sections);
    // And the printed contents page names none of the empty ones.
    const contents = rendered.html.slice(
      rendered.html.indexOf('page-contents'),
      rendered.html.indexOf('</section>', rendered.html.indexOf('page-contents')),
    );
    expect(contents).not.toContain('Regulatory &amp; Policy Watch');
  });
});

describe('the lede agrees with the cover', () => {
  it('counts sections, not layers', () => {
    // The stored narrative counts layers, because layers are all the normaliser
    // has. A `full` report has fourteen sections against eight layers, so the
    // page said "in 8 sections" under a cover reading "SECTIONS 14".
    const rendered = render(reportRow());
    expect(rendered.sections.length).toBe(14);
    expect(rendered.html).toContain(`in ${rendered.sections.length} sections`);
    expect(rendered.html).not.toContain('in 8 sections');
  });

  it('still counts sections when layers are missing', () => {
    const rendered = render(reportRow({ data: { layer3_sentiment: { content: '' } } }));
    expect(rendered.html).toContain(`in ${rendered.sections.length} sections`);
  });
});

describe('what the page says about what it left out', () => {
  it('names the empty layers, as layers rather than sections', () => {
    const rendered = render(reportRow({
      data: { layer3_sentiment: { content: '' }, layer4_regulatory: { content: '' } },
    }));
    expect(rendered.html).toContain('2 layers returned no data');
    expect(rendered.html).toContain('Consumer &amp; Investor Sentiment');
    expect(rendered.degraded).toBe(true);
  });

  it('says on the page when a section was shortened, and by how much', () => {
    // Silent truncation is the one failure this programme exists to remove.
    // `planSections` counted the omission from the first draft and the renderer
    // never asked for the number, so a clipped layer printed unmarked.
    const rendered = render(reportRow({
      data: { layer5_outlook: { content: `${layerBody(0)}\n\n${prose(0, 400)}` } },
    }));
    expect(rendered.charsOmitted).toBeGreaterThan(0);
    expect(rendered.html).toContain('This section is shortened');
    expect(rendered.html).toMatch(/A further [\d,]+ characters of this section/);
    expect(rendered.degraded).toBe(true);
  });

  it('says nothing of the kind on an ordinary report', () => {
    const rendered = render(reportRow());
    expect(rendered.html).not.toContain('This section is shortened');
    expect(rendered.html).not.toContain('returned no data');
    expect(rendered.html).not.toContain('Not every section is shown');
    expect(rendered.degraded).toBe(false);
  });
});

describe('the audience edition', () => {
  it('prints the panel count the estimate charges for', () => {
    // Two facts in two modules; this is what stops them drifting. Without it the
    // suburb section simply under-claims by a page and nothing says so.
    for (const segment of ['general', 'investor', 'homebuyer']) {
      const html = audiencePanels(segment);
      // `class="callout tone-…"`, not `class="callout`: the label span inside
      // each one is `callout-label`, so the looser pattern counts every callout
      // twice and the assertion passes for the wrong reason.
      const callouts = (html.match(/class="callout tone-/g) || []).length;
      expect(callouts, `${segment} edition`).toBe(audiencePanelCount(segment));
    }
  });

  it('changes the panels without touching a word of the prose', () => {
    const general = render(reportRow());
    const homebuyer = render(reportRow(), 'homebuyer');
    expect(general.html).toContain('What this means for investors');
    expect(general.html).toContain('What this means for homebuyers');
    expect(homebuyer.html).toContain('What this means for your home search');
    expect(homebuyer.html).not.toContain('What this means for investors');
    expect(homebuyer.sections).toEqual(general.sections);
  });
});

describe('the events timeline', () => {
  it('prints the timing, so the ordering reads as deliberate', () => {
    const rendered = render(reportRow({ data: { marketEvents: events(6) } }));
    expect(rendered.html).toContain('>Timing<');
    expect(rendered.html).toContain('>Passed<');
  });

  it('labels each sidenote with its event, not only a date', () => {
    const rendered = render(reportRow({ data: { marketEvents: events(3) } }));
    expect(rendered.html).toContain('Reserve Bank board meeting 1');
  });
});

describe('the brand', () => {
  it('puts the tenant on the document and us nowhere', () => {
    const rendered = render(reportRow());
    expect(rendered.html).toContain(TENANT);
    expect(rendered.html).not.toContain('Naidu Property');
    expect(rendered.html).not.toContain('NPC Services');
  });

  it('names the tenant in the brand close', () => {
    expect(render(reportRow()).html).toContain(`Why ${TENANT}?`);
  });
});

describe('the resource policy', () => {
  it('passes on every shape, including one with URLs in the prose', () => {
    const withUrls = reportRow({
      data: {
        layer1_rba: {
          content: `${layerBody(0)}\n\nSee https://example.test/series and //cdn.example.test/x.`,
        },
        allCitations: ['CoreLogic, https://corelogic.test/hedonic-index'],
      },
    });
    for (const shape of [reportRow(), withUrls]) {
      const html = render(shape).html;
      expect(() => assertSafeRenderResources(html, 'https://project.supabase.co')).not.toThrow();
    }
  });
});

describe('determinism', () => {
  it('renders byte-identically twice', () => {
    expect(render(reportRow()).html).toBe(render(reportRow()).html);
  });
});

/**
 * A chosen template that cannot carry the report is composed, never shipped
 * near-empty.
 *
 * Measured defect, 15 Sep 2026: the library's "First-Home Buyer Report" was
 * chosen for an Investment report and drew five pages — a cover reading
 * "Prepared for" with nothing after it, three content pages carrying only
 * their headings, and a disclaimer — because every binding on it
 * (`client.deposit`, `finance.capacity`, `grants.fhog`, `steps.0`) is a
 * sample-preset vocabulary no adapter publishes. Nothing measured that.
 *
 * And the first composition kept that template's COVER unconditionally, so on
 * 16 Sep 2026 an Investment report shipped with page 1 reading "FIRST HOME /
 * Your First Property" — static words the coverage measure cannot judge, on a
 * page whose only bindings are the tenant's mark and the client's name,
 * neither of which says which document it fronts. A chosen cover is now kept
 * only where it resolves this report's identity; otherwise the donor's cover
 * leads under the merged tokens.
 */
import { describe, expect, it } from 'vitest';
import {
  classifyPage,
  measureBindingCoverage,
  pathsInBlock,
  pathsInConditional,
  pathsInString,
} from '../templateBindingCoverage.pure';
import { composeTemplateWithDonor, mergeTokens } from '../templateComposition.pure';

const tokens = (colors: Record<string, string>, fonts: Record<string, string>) => ({
  colors, fonts, radii: { sm: 0, md: 0, lg: 2 }, spacing: { gutter: 22, padding: 24, sectionGap: 30 },
  typeScale: { body: 9.75, cover: 44, eyebrow: 8, heading: 21 }, fontFaces: [],
});

/** The shape the seeded First-Home Buyer Report has, reduced to what matters. */
const firstHomeBuyer = {
  name: 'First-Home Buyer Report',
  version: 1,
  tokens: tokens({ bg: 'cocoa', primary: 'gold', ink: 'ink-brown' }, { body: 'Inter, sans-serif', heading: 'Fraunces, serif' }),
  pages: [
    { id: 'seed-page-2', name: 'Cover', blocks: [{ id: 'c', type: 'cover', props: { mark: '{{org.markMono}}', subtitle: 'Prepared for {{client.name}}', title: 'Your First Property' } }] },
    { id: 'seed-page-7', name: 'What you can do', blocks: [
      { id: 't', type: 'text-block', props: { heading: 'What you can do', body: 'Based on the deposit…' } },
      { id: 'k', type: 'kpi-grid', props: { items: [{ label: 'Deposit', value: '{{client.deposit | currency}}' }, { label: 'Capacity', value: '{{finance.capacity | currency}}' }] } },
      { id: 'f', type: 'footer', props: { text: '{{property.address}} · {{client.name}}' } },
      { id: 'n', type: 'page-number', props: {} },
    ] },
    { id: 'seed-page-d', name: 'The real cost', blocks: [
      { id: 'b', type: 'chart-bar', props: { dataPath: 'finance.rateScenarios', title: 'If rates move' } },
      { id: 'f2', type: 'footer', props: { text: '{{property.address}}' } },
    ] },
    { id: 'seed-page-n', name: 'Important information', blocks: [{ id: 'd', type: 'disclaimer', props: { abn: '{{org.abn}}', companyName: '{{org.name}}' } }] },
  ],
};

/** A family master, reduced: cover, contents, two narrative pages, method, disclaimer. */
const master = {
  name: 'Luxury Editorial — Frontispiece · Midnight Editorial',
  version: 1,
  tokens: tokens({ bg: 'midnight', primary: 'brass', ink: 'parchment', info: 'sky' }, { body: 'Playfair Display, serif', heading: 'Cinzel, serif' }),
  slots: { runningHead: { id: 'rh', type: 'text-block', props: { body: '{{report.address}}' } } },
  pageMasters: { std: { id: 'std', name: 'Standard', margins: { top: 36, right: 36, bottom: 36, left: 36 } } },
  pages: [
    // The masters build their covers on a hero plate and text blocks — no `cover` block.
    { id: 'm-cover', name: 'Cover', blocks: [
      { id: 'mh', type: 'hero', props: { src: '{{report.heroImage}}' } },
      { id: 'mt', type: 'text-block', props: { heading: '{{report.address}}', body: '{{org.name}}' } },
    ] },
    { id: 'm-contents', name: 'Contents', blocks: [{ id: 'toc', type: 'toc', props: {} }, { id: 'rh', type: 'text-block', props: { body: '{{report.address}}' } }] },
    { id: 'm-narr-0', name: 'The report', conditional: 'narrative && narrative.source', blocks: [{ id: 'md0', type: 'markdown-block', props: { source: '{{narrative.source}}', pageIndex: 0 } }] },
    { id: 'm-narr-1', name: 'The report', conditional: 'narrative && narrative.pages > 1', blocks: [{ id: 'md1', type: 'markdown-block', props: { source: '{{narrative.source}}', pageIndex: 1 } }] },
    { id: 'm-method', name: 'Sources and methodology', blocks: [{ id: 'dl', type: 'definition-list', props: { items: [{ term: 'Prepared by', definition: '{{org.name}}' }, { term: 'Property', definition: '{{property.address}}' }] } }] },
    { id: 'm-disc', name: 'Important information', blocks: [{ id: 'md', type: 'disclaimer', props: { abn: '{{org.abn}}' } }] },
  ],
};

/** What the Investment adapter publishes for a real report, reduced. */
const investmentData = {
  report: { id: 'r1', type: 'investment', address: '291 Stone Mason Drive, Kellyville NSW 2155' },
  property: { address: '291 Stone Mason Drive, Kellyville NSW 2155', bedrooms: 3 },
  narrative: { source: '# Executive Verdict\n\nKellyville offers…', pages: 22 },
  org: { name: 'Naidu Property Consulting Services', abn: '50 684 555 771', mark: 'data:image/svg+xml;utf8,x', markMono: 'data:image/svg+xml;utf8,y' },
};

describe('binding paths are read the way the resolver reads them', () => {
  it('takes the head of each binding and skips computed forms', () => {
    expect(pathsInString('{{client.deposit | currency}} and {{finance.capacity}}')).toEqual(['client.deposit', 'finance.capacity']);
    expect(pathsInString('{{= price * 0.06 | currency}} {{@netYield}}')).toEqual([]);
    expect(pathsInString('no bindings here')).toEqual([]);
  });

  it('reads a bare data path on a chart prop and dotted paths in a conditional', () => {
    expect(pathsInBlock({ type: 'chart-bar', props: { dataPath: 'finance.rateScenarios', title: 'x' } })).toEqual(['finance.rateScenarios']);
    expect(pathsInConditional('narrative && narrative.pages > 3')).toEqual(['narrative.pages']);
  });

  it('classifies a page by what it is for', () => {
    expect(classifyPage(firstHomeBuyer.pages[0])).toBe('cover');
    expect(classifyPage(firstHomeBuyer.pages[1])).toBe('content');
    expect(classifyPage(firstHomeBuyer.pages[3])).toBe('closing');
    expect(classifyPage({ name: 'x', blocks: [{ type: 'footer', props: {} }, { type: 'page-number', props: {} }] })).toBe('furniture');
  });

  it('recognises a master cover built on a hero, and not a plate page further in', () => {
    expect(classifyPage(master.pages[0], 0)).toBe('cover');
    expect(classifyPage({ name: 'Plate 01', blocks: [{ type: 'hero', props: {} }] }, 3)).toBe('content');
    expect(classifyPage({ name: 'Cover', blocks: [{ type: 'text-block', props: {} }] }, 0)).toBe('cover');
    expect(classifyPage({ name: 'Back cover', blocks: [{ type: 'text-block', props: {} }] }, 9)).toBe('closing');
  });
});

describe('measureBindingCoverage', () => {
  it('finds that the First-Home Buyer template carries nothing of an Investment report', () => {
    const cov = measureBindingCoverage(firstHomeBuyer, investmentData);
    expect(cov.carriesBody).toBe(false);
    // The address in a footer is furniture; the cover's client name never resolves.
    expect(cov.pages.map((p) => [p.kind, p.contentResolved.length])).toEqual([
      ['cover', 0], ['content', 0], ['content', 0], ['closing', 0],
    ]);
    expect(cov.resolved).toEqual(['org.markMono', 'property.address', 'org.abn', 'org.name']);
    expect(cov.bound).toContain('client.deposit');
    expect(cov.coverage).toBeLessThanOrEqual(0.5);
    expect(cov.needsComposition).toBe(true);
    expect(cov.pages.map((p) => p.blank)).toEqual([false, true, true, false]);
  });

  it('finds that a family master carries the body through its narrative pages', () => {
    const cov = measureBindingCoverage(master, investmentData);
    expect(cov.carriesBody).toBe(true);
    expect(cov.pages.filter((p) => p.carriesBody).map((p) => p.name)).toEqual(['The report', 'The report']);
    expect(cov.pages.map((p) => p.kind)).toEqual(['cover', 'content', 'content', 'content', 'content', 'closing']);
    expect(cov.needsComposition).toBe(false);
  });

  it('never counts a value that is present but empty as resolved', () => {
    const cov = measureBindingCoverage(firstHomeBuyer, { ...investmentData, client: { name: '   ' } });
    expect(cov.resolved).not.toContain('client.name');
  });
});

describe('composeTemplateWithDonor', () => {
  it('drops a cover that cannot name this report, keeps the closing page, and leads with the donor cover', () => {
    // The First-Home Buyer cover binds `org.markMono` (the tenant, on every
    // report) and `client.name` (absent here) — nothing that names THIS
    // document — so its static "Your First Property" cannot front an
    // Investment report. The donor's cover leads instead, in document order.
    const result = composeTemplateWithDonor(firstHomeBuyer, master, investmentData)!;
    expect(result).not.toBeNull();
    expect(result.kept).toEqual([{ name: 'Important information', kind: 'closing' }]);
    expect(result.dropped).toEqual([
      { name: 'Cover', kind: 'cover' },
      { name: 'What you can do', kind: 'content' },
      { name: 'The real cost', kind: 'content' },
    ]);
    expect(result.coverFrom).toBe('donor');
    const names = (result.schema.pages as Array<{ id: string; name: string }>).map((p) => `${p.id}:${p.name}`);
    expect(names).toEqual([
      'm-cover:Cover',
      'm-contents:Contents', 'm-narr-0:The report', 'm-narr-1:The report', 'm-method:Sources and methodology',
      'seed-page-n:Important information',
    ]);
    expect(result.bodyPages).toBe(5);
  });

  it('keeps a chosen cover that resolves this report\'s identity, and scrubs only its absent labels', () => {
    // The same cover with the property's address on it IS this report's
    // cover: the author's design fronts the document it can name. The
    // addressee alone is not identity — `client.name` resolving would keep a
    // "Your First Property" cover on an Investment report prepared for the
    // same person.
    const identified = {
      ...firstHomeBuyer,
      pages: [
        {
          ...firstHomeBuyer.pages[0],
          blocks: [{
            id: 'c',
            type: 'cover',
            props: {
              mark: '{{org.markMono}}',
              subtitle: 'Prepared for {{client.name}}',
              title: 'Portfolio Analysis',
              footnote: '{{property.address}}',
            },
          }],
        },
        ...firstHomeBuyer.pages.slice(1),
      ],
    };
    const result = composeTemplateWithDonor(identified, master, investmentData)!;
    expect(result.coverFrom).toBe('chosen');
    expect(result.kept.map((p) => p.name)).toEqual(['Cover', 'Important information']);
    const pages = result.schema.pages as Array<{ id: string; blocks: Array<{ props: Record<string, unknown> }> }>;
    expect(pages[0].id).toBe('seed-page-2');
    // "Prepared for {{client.name}}" binds only an absence: blank, never "Prepared for".
    expect(pages[0].blocks[0].props.subtitle).toBe('');
    expect(pages[0].blocks[0].props.title).toBe('Portfolio Analysis');
    expect(pages[0].blocks[0].props.footnote).toBe('{{property.address}}');
    expect(result.bodyPages).toBe(4);

    const addressee = {
      ...identified,
      pages: [
        { ...identified.pages[0], blocks: [{ id: 'c', type: 'cover', props: { mark: '{{org.markMono}}', subtitle: 'Prepared for {{client.name}}', title: 'Your First Property' } }] },
        ...identified.pages.slice(1),
      ],
    };
    const withClient = { ...investmentData, client: { name: 'Jordan Example' } };
    const result2 = composeTemplateWithDonor(addressee, master, withClient)!;
    expect(result2.coverFrom).toBe('donor');
    expect(result2.dropped.map((p) => p.kind)).toContain('cover');
  });

  it('draws the body in the chosen palette, with the donor filling any token the chosen template does not declare', () => {
    const result = composeTemplateWithDonor(firstHomeBuyer, master, investmentData)!;
    const t = result.schema.tokens as { colors: Record<string, string>; fonts: Record<string, string> };
    expect(t.colors.primary).toBe('gold');
    expect(t.colors.bg).toBe('cocoa');
    expect(t.colors.info).toBe('sky');
    expect(t.fonts.heading).toBe('Fraunces, serif');
    expect(result.schema.name).toBe('First-Home Buyer Report');
    // Donor-level structure travels with the donor's pages.
    expect(Object.keys(result.schema.slots as object)).toEqual(['runningHead']);
    expect(Object.keys(result.schema.pageMasters as object)).toEqual(['std']);
  });

  it('carries the donor pages untouched — their bindings and conditionals are never rewritten', () => {
    const result = composeTemplateWithDonor(firstHomeBuyer, master, investmentData)!;
    const pages = result.schema.pages as Array<{ id: string; blocks: Array<{ props: Record<string, unknown> }> }>;
    const donorNarrative = pages.find((p) => p.id === 'm-narr-0')!;
    expect(donorNarrative.blocks[0].props.source).toBe('{{narrative.source}}');
    const donorCover = pages.find((p) => p.id === 'm-cover')!;
    expect(donorCover.blocks[1].props.heading).toBe('{{report.address}}');
  });

  it('keeps the donor cover when the chosen template has none, and the donor closing page when it has none', () => {
    const coverless = { ...firstHomeBuyer, pages: firstHomeBuyer.pages.slice(1, 3) };
    const result = composeTemplateWithDonor(coverless, master, investmentData)!;
    const names = (result.schema.pages as Array<{ name: string }>).map((p) => p.name);
    expect(names[0]).toBe('Cover');
    expect(names[names.length - 1]).toBe('Important information');
    expect(result.kept).toEqual([]);
    expect(result.coverFrom).toBe('donor');
  });

  it('composes nothing when the chosen template resolves content of its own, binds nothing at all, or the donor resolves nothing', () => {
    expect(composeTemplateWithDonor(master, master, investmentData)).toBeNull();
    expect(composeTemplateWithDonor(firstHomeBuyer, firstHomeBuyer, investmentData)).toBeNull();
    const brochure = { ...firstHomeBuyer, pages: [firstHomeBuyer.pages[0], { id: 'static', name: 'About us', blocks: [{ id: 's', type: 'text-block', props: { heading: 'About us', body: 'Static prose.' } }] }] };
    expect(measureBindingCoverage(brochure, investmentData).needsComposition).toBe(false);
    expect(composeTemplateWithDonor(brochure, master, investmentData)).toBeNull();
  });

  it('is not the rule for a template that resolves even one content field — that document is the author\'s', () => {
    const snapshot = {
      ...firstHomeBuyer,
      pages: [firstHomeBuyer.pages[0], { id: 'snap', name: 'Snapshot', blocks: [{ id: 'k', type: 'kpi-grid', props: { items: [{ label: 'Bedrooms', value: '{{property.bedrooms}}' }] } }] }, firstHomeBuyer.pages[1]],
    };
    const cov = measureBindingCoverage(snapshot, investmentData);
    expect(cov.carriesContent).toBe(true);
    expect(cov.needsComposition).toBe(false);
    expect(composeTemplateWithDonor(snapshot, master, investmentData)).toBeNull();
  });

  it('keeps a static page of the chosen template in front of the body, behind whichever cover leads', () => {
    const withStatic = {
      ...firstHomeBuyer,
      pages: [firstHomeBuyer.pages[0], { id: 'static', name: 'How to read this', blocks: [{ id: 's', type: 'text-block', props: { heading: 'How to read this', body: 'Static prose.' } }] }, ...firstHomeBuyer.pages.slice(1)],
    };
    const result = composeTemplateWithDonor(withStatic, master, investmentData)!;
    expect(result.kept.map((p) => p.name)).toEqual(['How to read this', 'Important information']);
    expect(result.dropped.map((p) => p.name)).toEqual(['Cover', 'What you can do', 'The real cost']);
    // The donor's cover still LEADS: a kept front page never prints before page 1.
    const names = (result.schema.pages as Array<{ name: string }>).map((p) => p.name);
    expect(names.slice(0, 2)).toEqual(['Cover', 'How to read this']);
  });

  it('never leaves two pages with one id', () => {
    // The donor's contents page arrives wearing the kept closing page's id.
    const clash = { ...master, pages: master.pages.map((p) => (p.id === 'm-contents' ? { ...p, id: 'seed-page-n' } : p)) };
    const result = composeTemplateWithDonor(firstHomeBuyer, clash, investmentData)!;
    const ids = (result.schema.pages as Array<{ id: string }>).map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('seed-page-n-chosen');
  });
});

describe('mergeTokens', () => {
  it('merges objects one level deep and lets the chosen scalar win', () => {
    expect(mergeTokens({ colors: { a: '1', b: '2' }, fontFaces: [{ family: 'X' }] }, { colors: { b: '3' }, fontFaces: [] }))
      .toEqual({ colors: { a: '1', b: '3' }, fontFaces: [] });
  });
});

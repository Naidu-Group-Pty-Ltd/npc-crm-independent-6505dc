/**
 * One number per part, wherever the page prints it.
 *
 * The 23 Sep 2026 Compass for 97 Poole Road ran its section openers 01, 03,
 * 04, 07, 09 — numbers counted at compose time over pages a conditional later
 * dropped — under running heads the renderer had already healed to Part 01 to
 * Part 06, so its Method page read "Part 06 · Sources" above "09 How this
 * assessment was reached". The railed masters were never healed at all: the
 * heal read the running head's `Part marker` and not the rail's.
 *
 * And the closing page set its copy 20pt from the paper's edge while every
 * page before it sat on the master's margin.
 */
import { describe, expect, it } from 'vitest';
import { renderTemplateToHtml } from '../htmlRenderer';

const runningHead = (part: string) => [
  { id: 'pm', type: 'text-block', name: 'Part marker', props: { x: 370, y: 68, width: 157, body: part, bodySize: 6.25 } },
];
const rail = (part: string, section: string) => [
  { id: 'rm', type: 'text-block', name: 'Rail marker', props: { x: 68, y: 40, width: 459, eyebrow: part, body: section } },
];
/** The `decimal` opener: the numeral is a prefix of the heading, two spaces after it. */
const decimalOpener = (numeral: string, heading: string) => ({
  id: 'so', type: 'text-block', name: 'Section opener', props: { x: 68, y: 114, width: 459, eyebrow: 'Section', heading: `${numeral}  ${heading}` },
});
/** The `numeral` opener: a two-column block whose left heading is the numeral. */
const numeralOpener = (numeral: string, heading: string) => ({
  id: 'so', type: 'two-column', name: 'Section opener', props: { x: 68, y: 114, width: 459, leftHeading: numeral, leftBody: 'Section', rightHeading: heading, rightBody: '' },
});
const body = (id: string, text: string) => ({ id, type: 'text-block', props: { x: 68, y: 199, width: 459, body: text } });

const page = (id: string, name: string, blocks: unknown[], conditional?: string) => ({
  id, name, size: { width: 595, height: 842 }, background: { color: '#FFFFFF' }, blocks,
  ...(conditional ? { conditional } : {}),
});

type Opener = (numeral: string, heading: string) => { id: string; type: string; name: string; props: Record<string, unknown> };

const template = (furniture: (part: string, label: string) => unknown[], opener: Opener) => ({
  version: 1,
  name: 'Probe',
  tokens: { colors: { ink: '#111', surface: '#fff', primary: '#2F4858', text: '#111', muted: '#666', border: '#ddd', bg: '#eee', line: '#ccc' }, fonts: {}, spacing: {} },
  slots: {},
  pages: [
    page('p1', 'Contents', [...furniture('Part 01 · Contents', 'Contents'), opener('01', 'Contents'), body('b1', 'Contents text.')]),
    // Two pages the tier drops, as the Compass drops Financials and Cash flow.
    page('p2', 'Financials', [...furniture('Part 02 · Financials', 'Financials'), opener('02', 'What it costs'), body('b2', 'Costs.')], 'show.money'),
    page('p3', 'Cash flow', [...furniture('Part 03 · Cash flow', 'Cash flow'), opener('03', 'What it earns'), body('b3', 'Flows.')], 'show.money'),
    page('p4', 'Risk', [...furniture('Part 04 · Risk', 'Risk'), opener('04', 'Manageable with verification'), body('b4', 'Risks.')]),
    page('p5', 'Sources', [...furniture('Part 05 · Sources', 'Sources'), opener('05', 'How this assessment was reached'), body('b5', 'Method.')]),
  ],
});

const render = (t: unknown) => renderTemplateToHtml(t as never, { data: { show: { money: false } } }).html;

describe('the section numeral follows the part it was composed with', () => {
  it('heals a decimal opener to the number its running head now carries', () => {
    const html = render(template((p) => runningHead(p), decimalOpener));
    expect(html).toContain('Part 02 · Risk');
    expect(html).toContain('02  Manageable with verification');
    expect(html).toContain('Part 03 · Sources');
    expect(html).toContain('03  How this assessment was reached');
    expect(html).not.toContain('04  Manageable');
    expect(html).not.toContain('05  How this');
  });

  it('heals a numeral opener\'s left heading the same way', () => {
    const html = render(template((p) => runningHead(p), numeralOpener));
    expect(html).toContain('Part 03 · Sources');
    expect(html).not.toMatch(/>\s*05\s*</);
    expect(html).toMatch(/>\s*03\s*</);
  });

  it('heals a railed family, whose part is the rail marker\'s eyebrow', () => {
    const html = render(template((p, label) => rail(p, label), decimalOpener));
    expect(html).toContain('Part 02 · Risk');
    expect(html).toContain('Part 03 · Sources');
    expect(html).not.toContain('Part 04 · Risk');
    expect(html).toContain('03  How this assessment was reached');
  });

  it('changes nothing where no page was dropped', () => {
    const full = renderTemplateToHtml(template((p) => runningHead(p), decimalOpener) as never, { data: { show: { money: true } } }).html;
    expect(full).toContain('Part 05 · Sources');
    expect(full).toContain('05  How this assessment was reached');
  });

  it('leaves a numeral that is not the page\'s part number alone', () => {
    const t = template((p) => runningHead(p), decimalOpener);
    (t.pages[3].blocks as Array<{ id: string; props: Record<string, unknown> }>)
      .find((b) => b.id === 'so')!.props.heading = '12  A number an author typed';
    const html = render(t);
    expect(html).toContain('12  A number an author typed');
  });
});

describe('the closing page sits on the master\'s margin', () => {
  const closing = (props: Record<string, unknown>) => ({
    version: 1,
    name: 'Probe',
    tokens: { colors: { ink: '#111', surface: '#fff', primary: '#2F4858', text: '#111', muted: '#666', border: '#ddd', bg: '#eee', line: '#ccc' }, fonts: {}, spacing: {} },
    slots: {},
    pages: [page('pe', 'Important information', [{ id: 'd1', type: 'disclaimer', props: { disclaimerText: 'General advice only.', ...props } }])],
  });

  it('takes the margin a master passes', () => {
    const html = renderTemplateToHtml(closing({ margin: 45 }) as never, { data: {} }).html;
    expect(html).toContain('padding:45pt;');
  });

  it('keeps its own inset where a template passes none', () => {
    const html = renderTemplateToHtml(closing({}) as never, { data: {} }).html;
    expect(html).toContain('padding:40pt 20pt;');
  });
});

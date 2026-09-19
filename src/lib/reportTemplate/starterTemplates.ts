/**
 * Starter page presets — drop a pre-composed page (cover, KPI dashboard,
 * disclaimer, etc.) into the active template in one click.
 *
 * Each preset returns a fresh `Page` (with new UUIDs) so it can be inserted
 * multiple times safely.
 */
import type { Block, Page } from './templateSchema';

export interface StarterPagePreset {
  id: string;
  label: string;
  description: string;
  build: () => Page;
}

const newId = () => crypto.randomUUID();

const block = (type: string, props: Record<string, unknown>, overlays: Block['overlays'] = []): Block => ({
  id: newId(), type, props, overlays,
});

export const STARTER_PAGE_PRESETS: StarterPagePreset[] = [
  {
    id: 'cover-hero',
    label: 'Cover — Hero',
    description: 'Full-bleed cover with eyebrow, title, accent bar, and footnote.',
    build: () => ({
      id: newId(),
      name: 'Cover',
      size: { width: 595, height: 842 },
      background: { color: 'token:bg' },
      blocks: [
        block('cover', {
          eyebrow: 'Investment Report',
          title: '{{property.address}}',
          subtitle: 'Prepared for {{client.name}}',
          footnote: '{{reportType | upper}}',
          bg: 'token:bg',
          accent: 'token:primary',
          titleSize: 44,
        }),
      ],
    }),
  },
  {
    id: 'toc-page',
    label: 'Table of contents',
    description: 'Auto-generated TOC listing all visible pages in the template.',
    build: () => ({
      id: newId(),
      name: 'Contents',
      size: { width: 595, height: 842 },
      background: { color: 'token:bg' },
      blocks: [
        block('toc', { x: 32, y: 80, width: 531, title: 'Contents', titleSize: 28, size: 12, lineHeight: 22, color: 'token:text', indexColor: 'token:primary' }),
        block('footer', { text: '{{client.name}} — {{reportType}}', bg: 'token:bg', color: 'token:muted', align: 'center', height: 28 }),
      ],
    }),
  },
  {
    id: 'kpi-dashboard',
    label: 'KPI Dashboard',
    description: 'Hero + 4-up KPI grid + chart + footer — instant exec summary.',
    build: () => ({
      id: newId(),
      name: 'Snapshot',
      size: { width: 595, height: 842 },
      background: { color: 'token:bg' },
      blocks: [
        block('hero', {
          title: '{{property.address}}',
          subtitle: '{{property.suburb}} — Snapshot',
          align: 'left',
          x: 0, y: 0, width: 595, height: 220,
          titleSize: 26, subtitleSize: 12,
          tint: 'token:primary',
        }),
        block('kpi-grid', {
          x: 24, y: 248, width: 547, height: 110, columns: 4, gap: 12,
          tileBg: 'token:surface', accent: 'token:primary',
          items: [
            { label: 'Weekly rent', value: '{{financials.weeklyRent | currency}}' },
            { label: 'Purchase price', value: '{{financials.purchasePrice | currency}}' },
            { label: 'Yield', value: '{{financials.yield | percent}}' },
            { label: 'Tier', value: '{{tier | upper}}' },
          ],
        }),
        block('chart', {
          x: 24, y: 380, width: 547, height: 240,
          chartUrl: 'https://quickchart.io/chart?c={type:%27line%27,data:{labels:[%27Y1%27,%27Y2%27,%27Y3%27,%27Y4%27,%27Y5%27],datasets:[{label:%27Equity%27,data:[100,140,190,260,340]}]}}',
          caption: '5-year projected equity (sample).',
        }),
        block('footer', { text: 'Page {{pageNumber}} of {{pageCount}}', bg: 'token:bg', color: 'token:muted', align: 'center', height: 28 }),
      ],
    }),
  },
  {
    id: 'two-column-narrative',
    label: 'Two-column narrative',
    description: 'Heading + side-by-side body copy + callout.',
    build: () => ({
      id: newId(),
      name: 'Narrative',
      size: { width: 595, height: 842 },
      background: { color: 'token:bg' },
      blocks: [
        block('text-block', { x: 24, y: 64, width: 547, heading: 'Why this property', body: 'Edit this body copy in the inspector. Bindings like {{property.address}} resolve from the sample data.', headingSize: 22, bodySize: 11, color: 'token:text' }),
        block('two-column', {
          x: 24, y: 200, width: 547, gap: 20, ratio: 0.5,
          leftHeading: 'Strengths',
          leftBody: '• Strong rental demand\n• Low vacancy\n• Established infrastructure',
          rightHeading: 'Risks',
          rightBody: '• Interest rate sensitivity\n• Construction overhang\n• Tenant turnover',
        }),
        block('callout', {
          x: 24, y: 460, width: 547,
          variant: 'info',
          title: 'Verdict',
          body: 'Suited to long-term hold investors with a 7+ year horizon.',
          accent: 'token:primary',
        }),
      ],
    }),
  },
  {
    id: 'gallery-page',
    label: 'Photo gallery',
    description: '3-up image gallery with captions and footer.',
    build: () => ({
      id: newId(),
      name: 'Gallery',
      size: { width: 595, height: 842 },
      background: { color: 'token:bg' },
      blocks: [
        block('text-block', { x: 24, y: 56, width: 547, heading: 'Property gallery', body: '', headingSize: 22, bodySize: 10, color: 'token:text' }),
        block('gallery', {
          x: 24, y: 110, width: 547, height: 600, columns: 2, gap: 12,
          items: [
            { src: '{{property.imageUrl}}', caption: 'Front facade' },
            { src: '{{property.imageUrl}}', caption: 'Living room' },
            { src: '{{property.imageUrl}}', caption: 'Kitchen' },
            { src: '{{property.imageUrl}}', caption: 'Master bedroom' },
          ],
        }),
        block('footer', { text: '{{client.name}} — Gallery', bg: 'token:bg', color: 'token:muted', align: 'center', height: 28 }),
      ],
    }),
  },
  {
    id: 'disclaimer-page',
    label: 'Disclaimer page',
    description: 'Legal / general-advice disclaimer using brand contact details.',
    build: () => ({
      id: newId(),
      name: 'Disclaimer',
      size: { width: 595, height: 842 },
      background: { color: 'token:bg' },
      blocks: [
        block('disclaimer', {
          companyName: 'Property Consulting',
          website: 'example.com.au',
          email: 'hello@example.com.au',
          phone: '+61 0 0000 0000',
          address: 'Sydney, NSW 2000',
          abn: '00 000 000 000',
          disclaimerText: 'This document is general information only and does not constitute financial advice. Past performance is not indicative of future results.',
        }),
      ],
    }),
  },
  {
    id: 'signoff',
    label: 'Sign-off page',
    description: 'Signature line, date, contact card.',
    build: () => ({
      id: newId(),
      name: 'Sign-off',
      size: { width: 595, height: 842 },
      background: { color: 'token:bg' },
      blocks: [
        block('text-block', { x: 32, y: 80, width: 531, heading: 'Acknowledgement', body: 'By signing below, you acknowledge receipt of this report and agree to its disclaimers.', headingSize: 22, bodySize: 11, color: 'token:text' }),
        block('signature', { x: 32, y: 360, width: 240, signerName: '{{client.name}}', signerRole: 'Client signature', dateLabel: 'Date: ____________', lineColor: 'token:text' }),
        block('signature', { x: 320, y: 360, width: 240, signerName: 'Adviser', signerRole: 'Adviser signature', dateLabel: 'Date: ____________', lineColor: 'token:text' }),
        block('qr', { x: 32, y: 540, size: 110, data: '{{client.portalUrl | default:https://example.com}}', caption: 'Scan to view live report', color: 'token:muted' }),
      ],
    }),
  },
];

export function getStarterPreset(id: string): StarterPagePreset | undefined {
  return STARTER_PAGE_PRESETS.find((p) => p.id === id);
}

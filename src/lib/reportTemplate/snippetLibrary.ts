/**
 * Snippet library — pre-built, opinionated `Block` snippets organised by
 * category and tags. Surfaced through the Snippet Picker dialog and the
 * command palette.
 *
 * Each snippet is a thunk returning a fresh `Block` (with a new id) so
 * callers can insert it directly into the active page.
 */
import type { Block } from './templateSchema';

export type SnippetCategory =
  | 'Text'
  | 'Layout'
  | 'Data'
  | 'Marketing'
  | 'Legal'
  | 'Media'
  | 'Navigation';

export interface Snippet {
  id: string;
  label: string;
  description: string;
  category: SnippetCategory;
  tags: string[];
  build: () => Block;
}

const newId = () => crypto.randomUUID();

export const SNIPPETS: Snippet[] = [
  // ── Text ──────────────────────────────────────────────────────────────────
  {
    id: 'text-section-heading',
    label: 'Section heading + body',
    description: 'Standard H2 + paragraph block.',
    category: 'Text',
    tags: ['heading', 'paragraph', 'copy'],
    build: () => ({
      id: newId(), type: 'text-block', overlays: [],
      props: {
        x: 24, y: 320, width: 547,
        heading: 'Section heading',
        body: 'Open with a clear, scannable summary so the reader gets the point in one breath.',
        headingSize: 18, bodySize: 10,
      },
    }),
  },
  {
    id: 'text-pullquote',
    label: 'Pull quote',
    description: 'Highlight a customer quote or insight.',
    category: 'Text',
    tags: ['quote', 'testimonial'],
    build: () => ({
      id: newId(), type: 'callout', overlays: [],
      props: {
        x: 24, y: 320, width: 547, variant: 'quote',
        title: 'A quotable line from the strategist',
        body: 'Use this for testimonials, key insights or chapter intros.',
        accent: 'token:primary',
      },
    }),
  },

  // ── Layout ────────────────────────────────────────────────────────────────
  {
    id: 'layout-two-column',
    label: 'Two-column write-up',
    description: 'Side-by-side narrative with headings.',
    category: 'Layout',
    tags: ['columns', 'split'],
    build: () => ({
      id: newId(), type: 'two-column', overlays: [],
      props: {
        x: 24, y: 320, width: 547, gap: 16, ratio: 0.5,
        leftHeading: 'Why this property',
        leftBody: 'Three to five lines explaining the case.',
        rightHeading: 'Risk profile',
        rightBody: 'Counter-balance with the risks and mitigations.',
      },
    }),
  },
  {
    id: 'layout-divider',
    label: 'Section divider',
    description: 'Soft horizontal rule.',
    category: 'Layout',
    tags: ['rule', 'separator'],
    build: () => ({
      id: newId(), type: 'divider', overlays: [],
      props: { x: 24, y: 200, width: 547, thickness: 1, color: 'token:muted', style: 'solid' },
    }),
  },
  {
    id: 'layout-spacer',
    label: 'Vertical spacer',
    description: 'Whitespace between blocks.',
    category: 'Layout',
    tags: ['gap', 'whitespace'],
    build: () => ({
      id: newId(), type: 'spacer', overlays: [],
      props: { x: 24, y: 200, width: 547, height: 32, showGuide: false },
    }),
  },

  // ── Data ──────────────────────────────────────────────────────────────────
  {
    id: 'data-kpi-trio',
    label: 'KPI trio (rent / price / yield)',
    description: 'Three-tile financial KPI summary.',
    category: 'Data',
    tags: ['kpi', 'metrics', 'financial'],
    build: () => ({
      id: newId(), type: 'kpi-grid', overlays: [],
      props: {
        x: 24, y: 320, width: 547, height: 90, columns: 3, gap: 12,
        items: [
          { label: 'Weekly rent', value: '{{financials.weeklyRent | currency}}' },
          { label: 'Purchase price', value: '{{financials.purchasePrice | currency}}' },
          { label: 'Gross yield', value: '{{financials.yield | percent}}' },
        ],
      },
    }),
  },
  {
    id: 'data-property-table',
    label: 'Property summary table',
    description: 'Address, suburb, rent — two-column rows.',
    category: 'Data',
    tags: ['table', 'summary'],
    build: () => ({
      id: newId(), type: 'data-table', overlays: [],
      props: {
        x: 24, y: 440, width: 547, rowHeight: 22,
        headers: ['Field', 'Value'],
        rows: [
          { cells: ['Address', '{{property.address}}'] },
          { cells: ['Suburb', '{{property.suburb}}'] },
          { cells: ['Weekly rent', '{{financials.weeklyRent | currency}}'] },
          { cells: ['Purchase price', '{{financials.purchasePrice | currency}}'] },
        ],
      },
    }),
  },
  {
    id: 'data-yield-chart',
    label: 'Quarterly yield chart',
    description: 'QuickChart bar chart placeholder.',
    category: 'Data',
    tags: ['chart', 'yield', 'graph'],
    build: () => ({
      id: newId(), type: 'chart', overlays: [],
      props: {
        x: 24, y: 320, width: 547, height: 240,
        chartUrl: 'https://quickchart.io/chart?c={type:%27bar%27,data:{labels:[%27Q1%27,%27Q2%27,%27Q3%27,%27Q4%27],datasets:[{label:%27Yield%27,data:[3.2,3.5,3.8,4.1]}]}}',
        caption: 'Projected gross yield by quarter.',
      },
    }),
  },

  // ── Marketing ────────────────────────────────────────────────────────────
  {
    id: 'marketing-hero',
    label: 'Hero banner',
    description: 'Full-bleed cover with title + subtitle.',
    category: 'Marketing',
    tags: ['hero', 'banner', 'cover'],
    build: () => ({
      id: newId(), type: 'hero', overlays: [],
      props: {
        title: '{{property.address}}', subtitle: '{{property.suburb}}',
        align: 'left', x: 0, y: 0, width: 595, height: 280,
        titleSize: 28, subtitleSize: 14,
      },
    }),
  },
  {
    id: 'marketing-badges',
    label: 'Highlight badges',
    description: 'Pill tags for selling points.',
    category: 'Marketing',
    tags: ['badges', 'tags'],
    build: () => ({
      id: newId(), type: 'badge-list', overlays: [],
      props: {
        x: 24, y: 320, width: 547,
        items: ['Investor ready', 'Sub-3% vacancy', 'High yield'],
        bg: 'token:primary', color: '#FFFFFF',
      },
    }),
  },
  {
    id: 'marketing-callout-info',
    label: 'Info callout',
    description: 'Highlighted info / takeaway block.',
    category: 'Marketing',
    tags: ['callout', 'note'],
    build: () => ({
      id: newId(), type: 'callout', overlays: [],
      props: {
        x: 24, y: 320, width: 547, variant: 'info',
        title: 'Why it matters',
        body: 'One sentence explaining the takeaway in plain language.',
      },
    }),
  },

  // ── Media ────────────────────────────────────────────────────────────────
  {
    id: 'media-image',
    label: 'Single image',
    description: 'Full-width image with caption.',
    category: 'Media',
    tags: ['image', 'photo'],
    build: () => ({
      id: newId(), type: 'image', overlays: [],
      props: {
        x: 24, y: 320, width: 547, height: 220,
        src: '{{property.imageUrl}}', caption: '',
      },
    }),
  },
  {
    id: 'media-gallery-3up',
    label: '3-up image gallery',
    description: 'Three thumbnails in a row.',
    category: 'Media',
    tags: ['gallery', 'images'],
    build: () => ({
      id: newId(), type: 'gallery', overlays: [],
      props: {
        x: 24, y: 320, width: 547, height: 180, columns: 3, gap: 8,
        items: [
          { src: '{{property.imageUrl}}', caption: 'Front' },
          { src: '{{property.imageUrl}}', caption: 'Side' },
          { src: '{{property.imageUrl}}', caption: 'Rear' },
        ],
      },
    }),
  },
  {
    id: 'media-qr-portal',
    label: 'QR to client portal',
    description: 'QR code linking to portal.',
    category: 'Media',
    tags: ['qr', 'link'],
    build: () => ({
      id: newId(), type: 'qr', overlays: [],
      props: {
        x: 24, y: 600, size: 120,
        data: '{{client.portalUrl}}', caption: 'Scan to open your portal',
      },
    }),
  },

  // ── Legal ────────────────────────────────────────────────────────────────
  {
    id: 'legal-disclaimer',
    label: 'Compliance disclaimer',
    description: 'Boilerplate disclaimer block.',
    category: 'Legal',
    tags: ['disclaimer', 'compliance'],
    build: () => ({
      id: newId(), type: 'disclaimer', overlays: [],
      props: {
        companyName: 'Property Consulting',
        website: 'example.com.au',
        email: 'hello@example.com.au',
        phone: '+61 0 0000 0000',
        address: 'Sydney, NSW 2000',
        abn: '00 000 000 000',
        disclaimerText:
          'This document is general information only and does not constitute financial advice. Consider your own circumstances before acting on any information presented.',
      },
    }),
  },
  {
    id: 'legal-signature',
    label: 'Signature block',
    description: 'Name + role + date line.',
    category: 'Legal',
    tags: ['signature', 'sign'],
    build: () => ({
      id: newId(), type: 'signature', overlays: [],
      props: {
        x: 24, y: 720, width: 240,
        signerName: '{{client.name}}',
        signerRole: 'Buyer signature',
        dateLabel: 'Date: ____________',
      },
    }),
  },

  // ── Navigation ───────────────────────────────────────────────────────────
  {
    id: 'nav-toc',
    label: 'Table of contents',
    description: 'Auto-built TOC from page names.',
    category: 'Navigation',
    tags: ['toc', 'index'],
    build: () => ({
      id: newId(), type: 'toc', overlays: [],
      props: { x: 24, y: 80, width: 547, title: 'Contents', titleSize: 22, size: 11, lineHeight: 18 },
    }),
  },
  {
    id: 'nav-page-number',
    label: 'Page number footer',
    description: '"Page X of Y" — auto-resolved.',
    category: 'Navigation',
    tags: ['pagenum', 'footer'],
    build: () => ({
      id: newId(), type: 'page-number', overlays: [],
      props: { text: 'Page {{pageNumber}} of {{pageCount}}', align: 'center', size: 8 },
    }),
  },
  {
    id: 'nav-footer-bar',
    label: 'Branded footer bar',
    description: 'Coloured footer with client name.',
    category: 'Navigation',
    tags: ['footer'],
    build: () => ({
      id: newId(), type: 'footer', overlays: [],
      props: {
        text: '{{client.name}} — {{reportType}}',
        bg: 'token:primary', color: '#FFFFFF', align: 'center', height: 28,
      },
    }),
  },
];

export const SNIPPET_CATEGORIES: SnippetCategory[] = [
  'Text', 'Layout', 'Data', 'Marketing', 'Media', 'Legal', 'Navigation',
];

export function searchSnippets(query: string, category?: SnippetCategory | null): Snippet[] {
  const q = query.trim().toLowerCase();
  return SNIPPETS.filter((s) => {
    if (category && s.category !== category) return false;
    if (!q) return true;
    return (
      s.label.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.category.toLowerCase().includes(q) ||
      s.tags.some((t) => t.toLowerCase().includes(q))
    );
  });
}

export function getSnippet(id: string): Snippet | null {
  return SNIPPETS.find((s) => s.id === id) ?? null;
}

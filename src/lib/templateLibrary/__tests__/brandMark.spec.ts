/**
 * The brand mark, across the whole library.
 *
 * `REPORT_RULES.md` §5 allows a mark on exactly two surfaces — the cover and
 * the contact/disclaimer page — and explicitly **none** in a running header, a
 * chapter opener or a footer, because "a repeated image in a page-margin box is
 * fragile across 40 pages" and "repeating the mark cheapens it".
 *
 * The rule that carries the most risk is which *file* may be used. Only
 * `npc-logo-monogram.png` is a clean mark; every other "logo" in the repo is an
 * email-signature banner with the director's personal mobile number burned into
 * the pixels, and the PWA icons are the same banner letterboxed. Putting one of
 * those on a generated document prints his mobile on every client PDF — so the
 * last describe below asserts a template can never name one, whatever else
 * changes.
 *
 * Nothing here bakes an asset in. A template binds `org.mark` / `org.markMono`
 * and the deployment supplies the bytes, because a tenant who has uploaded no
 * mark must get **no mark, not ours**.
 */
import { describe, it, expect } from 'vitest';
import { renderTemplateToHtml } from '@/lib/reportTemplate/htmlRenderer';
import { SEED_TEMPLATES } from '../../../../scripts/template-library/templates';
import { INVESTMENT_COMPASS_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/templates';
import { BORROWING_CAPACITY_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/borrowingCapacity';
import { PORTFOLIO_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/portfolio';
import { COMPARISON_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/comparison';
import { CASH_FLOW_COMPASS_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/cashFlow';
import { CLIENT_DETAILS_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/clientDetails';
import { CASH_FLOW_COMPARISON_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/cashFlowComparison';
import { REPORT_QA_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/reportQa';
import { COMMERCIAL_CAPACITY_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/commercialCapacity';
import { MARKET_INTELLIGENCE_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/marketIntelligence';

const ALL: any[] = [
  ...(SEED_TEMPLATES as any[]),
  ...(INVESTMENT_COMPASS_TEMPLATES as any[]),
  ...(BORROWING_CAPACITY_TEMPLATES as any[]),
  ...(PORTFOLIO_TEMPLATES as any[]),
  ...(COMPARISON_TEMPLATES as any[]),
  ...(CASH_FLOW_COMPASS_TEMPLATES as any[]),
  ...(CLIENT_DETAILS_TEMPLATES as any[]),
  ...(CASH_FLOW_COMPARISON_TEMPLATES as any[]),
  ...(REPORT_QA_TEMPLATES as any[]),
  ...(COMMERCIAL_CAPACITY_TEMPLATES as any[]),
  ...(MARKET_INTELLIGENCE_TEMPLATES as any[]),
];

/** A 1x1 PNG. What is measured is whether a mark reaches the page, not which. */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwC'
  + 'AAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const coverOf = (t: any) => JSON.stringify(t.schema.pages[0] ?? {});
const disclaimerOf = (t: any) => (t.schema.pages as any[])
  .flatMap((p) => (p.blocks ?? []) as any[])
  .find((b) => b.type === 'disclaimer');

describe('every template carries the mark, on both surfaces', () => {
  it('covers the whole library', () => {
    expect(ALL).toHaveLength(543);
  });

  it('binds a mark on every cover', () => {
    for (const t of ALL) {
      expect(coverOf(t), `${t.slug} cover binds no mark`).toMatch(/\{\{org\.mark(Mono)?\}\}/);
    }
  });

  it('binds the mono mark on every contact page', () => {
    for (const t of ALL) {
      const block = disclaimerOf(t);
      expect(block, `${t.slug} has no disclaimer page`).toBeTruthy();
      // That page is a full-bleed obsidian ground, which is the surface §5
      // names — so it takes the mono lockup and never the paper one.
      expect(String(block.props?.mark ?? ''), `${t.slug} contact page binds no mark`)
        .toBe('{{org.markMono}}');
    }
  });
});

describe('the mark is bound, never baked', () => {
  it('embeds no image data in any template', () => {
    /*
     * A `data:` URI in a seeded schema would be the house mark travelling to
     * every tenant that uses the library — the one thing the asset module says
     * must not happen: "a tenant who has uploaded no mark gets no mark, not
     * ours." It would also put ~190 KB into each of 543 rows.
     */
    for (const t of ALL) {
      expect(JSON.stringify(t.schema), `${t.slug} bakes in an asset`).not.toContain('data:image');
    }
  });

  it('names no file, only a binding', () => {
    for (const t of ALL) {
      expect(JSON.stringify(t.schema), `${t.slug} names an asset file`).not.toMatch(/\.(png|jpe?g|webp|svg)\b/i);
    }
  });
});

describe('the marks that must never reach a client document', () => {
  /*
   * `npc-signature-logo.png` and every `icon-*.png` are the same email-signature
   * banner, with Rugesh Naidu's name, title, mobile number and email address
   * burned into the pixels. The assets README says to read that twice before
   * shipping a report cover.
   */
  const BANNED = [
    'npc-signature-logo', 'icon-192', 'icon-512', 'icon-maskable',
    'apple-touch-icon', 'og-image', 'npc-og-logo', 'favicon',
  ];

  it('is named by no template in the library', () => {
    for (const t of ALL) {
      const schema = JSON.stringify(t.schema).toLowerCase();
      for (const banned of BANNED) {
        expect(schema, `${t.slug} references ${banned}`).not.toContain(banned);
      }
    }
  });
});

describe('what a document does when there is no mark', () => {
  const shapes: Array<[string, any]> = [
    ['a compass master', (INVESTMENT_COMPASS_TEMPLATES as any[])[0]],
    ['a voice cover', (SEED_TEMPLATES as any[]).find((t) => coverOf(t).includes('"cover"'))],
    ['a cover-less voice one-pager',
      (SEED_TEMPLATES as any[]).find((t) => t.slug === 'property-snapshot')],
  ];

  for (const [label, t] of shapes) {
    it(`${label} paints exactly two marks when one is supplied`, () => {
      const html = renderTemplateToHtml(t.schema, {
        data: { org: { name: 'NPC Services', mark: PNG, markMono: PNG } },
      }).html;
      // The cover and the contact page. §5 allows no third.
      expect((html.match(/iVBORw0KGgo/g) ?? []).length).toBe(2);
    });

    it(`${label} paints none, and no placeholder, when there is none`, () => {
      const html = renderTemplateToHtml(t.schema, {
        data: { org: { name: 'NPC Services' } },
      }).html;
      expect(html).not.toContain('iVBORw0KGgo');
      // An unbound image block with `placeholder: false` renders nothing at
      // all — not a grey "No image" rectangle on a client's report.
      expect(html).not.toContain('No image');
    });
  }
});

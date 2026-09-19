/**
 * Report Q&A **is** on the design families, and these are the conditions under
 * which that is allowed to stay true.
 *
 * This file replaces `reportQaNotOnTheFamilies.spec.ts`, which enforced the
 * opposite. That spec was correct about the vocabulary it was written against:
 * no block rendered Markdown, and 70% of the 565 stored answers carry inline
 * bold, 48% a heading, 56% a list and 19% a pipe table — so an answer bound to
 * a `text-block` printed its own source on a client's page.
 *
 * It named two things that would have to change, and both did:
 *
 *  1. a Markdown-capable block in `PRODUCTION_SAFE_BLOCK_TYPES` — which it
 *     rightly called a sanitiser decision before a rendering one;
 *  2. a way for a master to size a block whose content it has not seen.
 *
 * The first is `markdown-block`, which takes Markdown *source* and renders it
 * through the programme's escape-first renderer — so it cannot emit markup the
 * model chose, whatever is bound to it. The second is conditional pages sized
 * from `packMarkdownPages`, the same function the block uses.
 *
 * What follows guards the parts that could quietly regress.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderTemplateToHtml } from '@/lib/reportTemplate/htmlRenderer';
import { supportsProduction, getAdapter } from '@/lib/reportTemplate/adapters';
import { PRODUCTION_REPORT_TEMPLATE_TYPES, PRODUCTION_SAFE_BLOCK_TYPES }
  from '../../../../supabase/functions/_shared/productionBlockTypes';
import { DEFAULT_LINES_PER_PAGE }
  from '../../../../supabase/functions/_shared/reports/markdownPaging.pure';
import { CAPS } from '../../../../supabase/functions/_shared/reportQaProjection.pure';
import { REPORT_QA_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/reportQa';
import { MARKDOWN_LINES_PER_PAGE }
  from '../../../../scripts/template-library/investmentCompass/blocks';
import { SAMPLE_REPORT_DATA as SAMPLE } from '../sampleReportData';

const ROOT = resolve(__dirname, '../../../..');

describe('the format is production-ready rather than preview-only', () => {
  it('is a production report-template type', () => {
    expect(PRODUCTION_REPORT_TEMPLATE_TYPES.has('qa')).toBe(true);
    expect(supportsProduction('qa')).toBe(true);
  });

  it('has an adapter that names the flowing route rather than replacing it', () => {
    const adapter = getAdapter('qa');
    expect(adapter?.supportsProduction).toBe(true);
    // A template is a fixed page sequence. It carries one exchange well; it is
    // not a transcript of 70 turns, and the registry must keep saying so.
    expect(adapter?.legacyFallback?.route).toBe('render-report-qa-pdf');
    expect(adapter?.legacyFallback?.reason).toMatch(/transcript/i);
  });

  it('contributes fifty masters', () => {
    expect(REPORT_QA_TEMPLATES).toHaveLength(50);
    expect(new Set(REPORT_QA_TEMPLATES.map((t) => t.slug)).size).toBe(50);
  });
});

describe('the block is the only thing that makes this safe', () => {
  it('markdown-block is on the production allow-list and no raw-HTML block is', () => {
    expect(PRODUCTION_SAFE_BLOCK_TYPES.has('markdown-block')).toBe(true);
    for (const forbidden of ['html', 'html-block', 'raw-html', 'unsafe-html']) {
      expect(PRODUCTION_SAFE_BLOCK_TYPES.has(forbidden), `${forbidden} must not be allowed`)
        .toBe(false);
    }
  });

  it('a text-block still escapes, so nothing has been loosened to make this work', () => {
    // The original spec's central assertion, kept. The fix was to add a block
    // that renders safely — not to relax the block that escapes.
    const schema = {
      version: 1 as const,
      name: 'x',
      tokens: { colors: {}, fonts: {}, spacing: {} },
      pages: [{
        id: 'p1', name: 'P', size: { width: 595, height: 842 },
        background: { color: '#ffffff' },
        blocks: [{
          id: 'b1', type: 'text-block',
          props: { body: '{{x}}', x: 40, y: 40, width: 515 }, overlays: [],
        }],
      }],
    };
    const { html } = renderTemplateToHtml(schema as any, {
      data: { x: '<strong>b</strong><script>alert(1)</script>' },
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;strong&gt;');
  });
});

describe('the masters and the projection must agree about page count', () => {
  it('the composer uses the same lines-per-page as the paging module', () => {
    // A master makes answer page N conditional on `qa.answerPages > N` while the
    // block decides what page N holds. If these two numbers drifted, a document
    // would print a blank page or lose the end of an answer — and neither shows
    // up in any other test.
    expect(MARKDOWN_LINES_PER_PAGE).toBe(DEFAULT_LINES_PER_PAGE);
  });

  it('every answer page is conditional on the projection having that page', () => {
    const master = REPORT_QA_TEMPLATES[0];
    const answerPages = master.schema.pages.filter((p: any) => /^The answer/.test(p.name));
    expect(answerPages.length).toBeGreaterThan(1);

    // The first is conditional on there being an answer at all; the rest on the
    // count. None may be unconditional, or a short answer prints blank pages.
    for (const p of answerPages as any[]) {
      expect(p.conditional, `page "${p.name}" is unconditional`).toBeTruthy();
    }
    const continuations = (answerPages as any[]).slice(1);
    for (const [i, p] of continuations.entries()) {
      expect(p.conditional).toBe(`qa && qa.answerPages > ${i + 1}`);
    }
  });

  it('declares exactly the answer pages the projection caps at', () => {
    // `CAPS.answerPages` said 10 while the masters declared 8, so the guard the
    // composer's comment promised — "beyond it the truncation note prints" —
    // fired two pages after the tail had already stopped being drawn. Nine of
    // the 565 stored answers run past eight pages, so the gap was real.
    const master = REPORT_QA_TEMPLATES[0];
    const answerPages = master.schema.pages.filter((p: any) => /^The answer/.test(p.name));
    expect(answerPages.length).toBe(CAPS.answerPages);
  });

  it('says on a page of its own when the answer runs past the sequence', () => {
    for (const t of REPORT_QA_TEMPLATES) {
      const cut = (t.schema.pages as any[]).find((p) => p.name === 'Not the whole answer');
      expect(cut, t.slug).toBeTruthy();
      expect(cut.conditional).toBe('qa && qa.answerCutNote');
    }
  });

  it('binds the answer as source to a markdown-block, never to a text-block', () => {
    for (const master of REPORT_QA_TEMPLATES) {
      for (const page of master.schema.pages as any[]) {
        for (const block of page.blocks as any[]) {
          const props = JSON.stringify(block.props ?? {});
          if (props.includes('{{qa.answer}}')) {
            expect(block.type, `${master.slug} bound the answer to a ${block.type}`)
              .toBe('markdown-block');
          }
        }
      }
    }
  });
});

describe('the conditionals', () => {
  it('constructs every expression, because one that throws is a silently dark page', () => {
    /*
     * A conditional is JavaScript, not a binding path. `qa.turns.1` — the
     * numeric-segment SyntaxError — shipped in this catalogue's "rest of the
     * conversation" page, which was therefore dark on every conversation with
     * a second exchange until this file constructed each expression.
     */
    const seen = new Set<string>();
    for (const t of REPORT_QA_TEMPLATES.slice(0, 5)) {
      const collect = (node: any) => {
        if (!node || typeof node !== 'object') return;
        if (typeof node.conditional === 'string') seen.add(node.conditional);
        for (const v of Object.values(node)) {
          if (Array.isArray(v)) v.forEach(collect);
          else collect(v);
        }
      };
      (t.schema.pages as any[]).forEach(collect);
    }
    expect(seen.size).toBeGreaterThan(10);
    for (const cond of seen) {
      expect(
        () => new Function('qa', 'org', 'report', `return (${cond});`),
        `does not parse: ${cond}`,
      ).not.toThrow();
    }
  });

  it('draws the depth-varied tables under mutually exclusive depths', () => {
    const evalWith = (cond: string, qa: Record<string, unknown>) => {
      try { return Boolean(new Function('qa', `return (${cond});`)(qa)); }
      catch { return false; }
    };
    for (const t of REPORT_QA_TEMPLATES.slice(0, 5)) {
      for (const page of t.schema.pages as any[]) {
        // The sources table, keyed on the published count.
        const sourceConds = ((page.blocks ?? []) as any[])
          .filter((b) => b.type === 'data-table'
            && typeof b.conditional === 'string' && b.conditional.includes('sourceCount'))
          .map((b) => String(b.conditional));
        if (sourceConds.length >= 2) {
          for (let n = 1; n <= 20; n += 1) {
            const holding = sourceConds.filter((c) => evalWith(c, { sourceCount: n, sources: [{}] }));
            expect(holding.length, `${t.name} "${page.name}" sourceCount=${n}`).toBe(1);
          }
        }
        // The further-questions table, keyed on the turns the projection caps.
        const turnConds = ((page.blocks ?? []) as any[])
          .filter((b) => b.type === 'data-table'
            && typeof b.conditional === 'string' && b.conditional.includes('turns.length'))
          .map((b) => String(b.conditional));
        if (turnConds.length >= 2) {
          for (let n = 2; n <= 12; n += 1) {
            const turns = Array.from({ length: n }, () => ({}));
            const holding = turnConds.filter((c) => evalWith(c, { turns }));
            expect(holding.length, `${t.name} "${page.name}" turns=${n}`).toBe(1);
          }
        }
      }
    }
  });
});

describe('every bound path has a producer', () => {
  /**
   * The omission notes are bound but deliberately absent from a sample that
   * shows a complete document — each is proven by `reportQaProjection.spec.ts`
   * instead, the same allowance the Borrowing Capacity catalogue records for
   * its scenarios.
   */
  const ALLOWED_ABSENT = new Set([
    'qa.answerCutNote', 'qa.answerMissingNote', 'qa.omissionNote',
    'qa.truncationNote', 'qa.sourcesOmittedNote', 'qa.citationsNote',
  ]);

  it('resolves every master binding against the projection-built sample', () => {
    const paths = new Set<string>();
    for (const t of REPORT_QA_TEMPLATES) {
      for (const m of JSON.stringify(t.schema).matchAll(/\{\{\s*([a-zA-Z0-9_.]+)/g)) paths.add(m[1]);
    }
    const flat = new Set<string>();
    const walk = (value: unknown, path: string) => {
      flat.add(path);
      if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k);
      }
    };
    walk(SAMPLE.qa, 'qa');
    walk(SAMPLE.org, 'org');
    walk(SAMPLE.report, 'report');

    const missing = [...paths]
      .filter((p) => p === 'qa' || p.startsWith('qa.') || p.startsWith('org.') || p.startsWith('report.'))
      .filter((p) => !flat.has(p) && !flat.has(p.replace(/\.\d+\./g, '.0.')) && !ALLOWED_ABSENT.has(p))
      .sort();
    expect(missing).toEqual([]);
  });

  it('previews with a titled cover, which it could not before the sample existed', () => {
    // The `qa` namespace was absent from the sample entirely, so every Report
    // Q&A preview rendered a cover with no title and every page past it dark.
    const { html } = renderTemplateToHtml(REPORT_QA_TEMPLATES[0].schema as any, { data: SAMPLE });
    expect(html).toContain('Rental yield on the Leichhardt purchase');
    expect(html).toContain('Conversation transcript');
    expect(html).not.toContain('{{');
  });

  it('draws the provenance line and the citations the exporters drop', () => {
    const { html } = renderTemplateToHtml(REPORT_QA_TEMPLATES[0].schema as any, { data: SAMPLE });
    expect(html).toContain('openai · gpt-5.2');
    expect(html).toContain('p.12 · ¶3');
    expect(html).toContain('91%');
  });
});

describe('the contract still names the flowing route', () => {
  it('QA.md documents both renderers', () => {
    const contract = readFileSync(resolve(ROOT, 'docs/reports/QA.md'), 'utf8');
    expect(contract).toContain('render-report-qa-pdf');
    expect(contract).toContain('markdown.pure.ts');
  });

  it('exactly one composer declares this report type', () => {
    const dir = resolve(ROOT, 'scripts/template-library/investmentCompass');
    const declaring = readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => /reportType:\s*'qa'/.test(readFileSync(resolve(dir, f), 'utf8')));
    expect(declaring).toEqual(['reportQa.ts']);
  });
});

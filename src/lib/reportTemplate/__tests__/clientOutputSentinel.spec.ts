import { describe, expect, it } from 'vitest';
import { jsPDF } from 'jspdf';
import { renderTemplateToHtml } from '../htmlRenderer';
import { getBlockRenderer, type BlockRenderContext } from '../blocks';
import { boundValueResolved } from '../boundValuePresence';
import { applyInvestmentProjection } from '../../../../supabase/functions/_shared/reportBindingProjection.pure';
import {
  leaksTechnicalToken,
} from '../../../../supabase/functions/_shared/reports/contract/visibilityPolicy.pure';

/**
 * The client's document never states a placeholder where a value is missing.
 *
 * This is a **sentinel on the presentation's own output**, not a filter over
 * finished text. The distinction is the whole point: a
 * `.replace(/N\/A/g, '')` at the end of the pipeline would hide the defect,
 * keep the empty frame the placeholder was sitting in, and delete the word
 * from a client's prose the first time somebody legitimately wrote it. The
 * source has to omit the field; this only proves that it did.
 *
 * ## What was actually leaking
 *
 * `investment_score` on the certification record carries
 * `grade: 'N/A'` beside `policy.gradeIssued: false` — a scorer's sentinel, not
 * a grade. `reportBindingProjection` published it verbatim, every Investment
 * master binds it as
 * `'{{recommendation.grade}} · {{recommendation.score | fixed:0}} out of 100'`,
 * and all three selectable structures printed
 *
 *     Assessment grade   N/A · out of 100
 *
 * on the client's method page. Two rules now stop it, and this file checks
 * both: the projection publishes no grade its own policy did not issue, and a
 * bound field whose bindings ALL resolved to nothing is dropped rather than
 * drawn as its own punctuation.
 *
 * ## Why the scan is whole-token
 *
 * The letterhead reads "NAIDU PROPERTY CONSULTING SERVICES" and a suburb
 * called Sunnybank contains `n/a` by letters. A substring scan over report
 * text flags both. Every check here is anchored on word boundaries, and the
 * broader prose of a report is deliberately NOT scanned — this is a rule about
 * structured fields, which is where a placeholder means something is broken.
 */

/**
 * The word vocabulary a client-facing field may never be set to.
 *
 * A dash is deliberately NOT in this list, and that is a measured decision
 * rather than an omission. §1 forbids "a dash used merely as a missing-value
 * substitute" — a semantic condition no text scan can see. Scanning for one
 * finds `-webkit-print-color-adjust`, `var(--font-body)` and `SFMono-Regular`
 * in the stylesheet of every page (this test found exactly those on its first
 * run). The dash rule is enforced structurally instead, by
 * `fieldIsDashOnly` below, which asks whether a WHOLE field is nothing but a
 * dash — which is precise and has no false positive.
 */
const PLACEHOLDERS = [
  'N/A', 'NA', 'Unavailable', 'Not available', 'Unknown', 'null', 'undefined',
  'NaN', 'TBD', 'TBC', 'Not provided', 'Data unavailable', 'No data',
];

/** A whole field that is only a dash is a missing value wearing punctuation. */
function fieldIsDashOnly(value: string): boolean {
  return /^[\s\u2010-\u2015-]+$/.test(value) && value.trim().length > 0;
}

/** Text as a reader sees it: no markup, and no stylesheet or script body. */
function visibleText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]*>/g, ' ');
}

/** Whole-token containment, the same shape `leaksTechnicalToken` uses. */
function statesPlaceholder(text: string): string | null {
  for (const token of PLACEHOLDERS) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(
      `(^|[\\s>(\\[,:;|])${escaped}($|[\\s<)\\],:;|.])`,
      token === 'NaN' ? '' : 'i',
    );
    if (pattern.test(` ${text} `)) return token;
  }
  return null;
}

/** A record whose score was never issued — the shape that produced the leak. */
const UNGRADED_ROW = {
  id: 'sentinel',
  property_address: '9 Test Street, Cowra NSW 2794',
  financial_calculations: {
    income: { weeklyRent: 445 },
    keyMetrics: { lvr: 80, grossRentalYield: 4.17 },
    initialCosts: { propertyValue: 555000, deposit: 111000 },
  },
  investment_score: {
    grade: 'N/A',
    totalScore: null,
    policy: { gradeIssued: false, authority: 'unavailable' },
  },
};

function project(row: unknown): Record<string, any> {
  return applyInvestmentProjection(
    { report: {}, brand: {} } as Record<string, unknown>, row as never,
  ) as Record<string, any>;
}

describe('the client-facing output states no missing-data placeholder', () => {
  /**
   * The ungraded record as the scorer actually stores it: the policy's
   * explanation sits in `recommendation`. RS-3 published its short form,
   * "Not available — insufficient verified evidence", as the verdict headline;
   * the owner's rule (14 Sep 2026) is that neither "N/A" nor "unavailable"
   * reaches a client document, so no verdict element is published at all.
   */
  it('publishes no verdict element that says the grade was unavailable', () => {
    const data = project({
      ...UNGRADED_ROW,
      investment_score: {
        ...UNGRADED_ROW.investment_score,
        recommendation: 'An overall investment grade is only issued when sufficient verified property '
          + 'evidence is available. Available measured analysis is shown below.',
      },
    });
    expect(data.recommendation?.headline).toBeUndefined();
    expect(data.recommendation?.action).toBeUndefined();
    expect(data.recommendation?.gradedLine).toBeUndefined();
    const { sections, ...structured } = data;
    void sections;
    expect(statesPlaceholder(JSON.stringify(structured))).toBeNull();
  });

  /**
   * The projection is where both presentations get their facts, so a sentinel
   * published here reaches every one of them. §9 — the same presence decision
   * feeds all presentations.
   */
  it('publishes no grade or score the record\'s own policy did not issue', () => {
    const data = project(UNGRADED_ROW);
    expect(data.recommendation?.grade, 'a withheld grade is absent, never "N/A"')
      .toBeUndefined();
    expect(data.recommendation?.score, 'and its score goes with it').toBeUndefined();

    // Every published leaf is checked, because the rule is about the payload
    // rather than about one field anybody remembered.
    const leaves: Array<[string, unknown]> = [];
    const walk = (obj: unknown, path: string) => {
      if (obj === null || obj === undefined) return;
      if (typeof obj === 'object') {
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
          walk(v, path ? `${path}.${k}` : k);
        }
        return;
      }
      leaves.push([path, obj]);
    };
    // `sections` carries the report's own prose, which is not a structured
    // field and is deliberately out of scope — see this file's header.
    const { sections, ...structured } = data;
    void sections;
    walk(structured, '');

    for (const [path, value] of leaves) {
      if (typeof value !== 'string') continue;
      expect(
        statesPlaceholder(value),
        `${path} is a structured client-facing field set to "${value}"`,
      ).toBeNull();
      expect(leaksTechnicalToken(value), `${path} leaks a technical token`).toBeNull();
      expect(fieldIsDashOnly(value), `${path} is a dash standing in for a value`)
        .toBe(false);
    }
  });

  /**
   * A bound field that received nothing is dropped, not drawn as its own
   * boilerplate. Asked of the rule both definition-list renderers use.
   */
  it('drops a bound field whose bindings all resolved to nothing', () => {
    const ctx = {
      data: project(UNGRADED_ROW),
      tokens: { colors: {}, fonts: {}, spacing: {} },
    } as any;

    expect(
      boundValueResolved('{{recommendation.grade}} · {{recommendation.score | fixed:0}} out of 100', ctx),
      'a grade line with no grade and no score carries nothing',
    ).toBe(false);

    expect(
      boundValueResolved('{{property.address}}', ctx),
      'an address the record holds is kept',
    ).toBe(true);

    expect(
      boundValueResolved('Figures are drawn from the stored assessment.', ctx),
      'static text an author wrote is never this rule\'s business',
    ).toBe(true);
  });

  /**
   * The same record through both presentations' template path — the HTML
   * renderer that WeasyPrint would have drawn, and the jsPDF block the browser
   * draws — states no placeholder on its method page.
   */
  it('states no placeholder in either template renderer', () => {
    const data = project(UNGRADED_ROW);
    const methodPage = {
      id: 'p1',
      blocks: [{
        id: 'b1',
        type: 'definition-list',
        props: {
          x: 24, y: 60, width: 500,
          title: 'Method',
          items: [
            { term: 'Property assessed', definition: '{{property.address}}' },
            {
              term: 'Assessment grade',
              definition: '{{recommendation.grade}} · {{recommendation.score | fixed:0}} out of 100',
            },
          ],
        },
      }],
    };
    const template = {
      id: 't1', name: 'Sentinel', pages: [methodPage],
      tokens: { colors: {}, fonts: {}, spacing: {} },
    };

    const { html } = renderTemplateToHtml(template, { data });
    expect(html).toContain('Property assessed');
    expect(html, 'the ungraded item is dropped whole').not.toContain('Assessment grade');
    expect(statesPlaceholder(visibleText(html)), 'the HTML twin').toBeNull();

    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const drawnStrings: string[] = [];
    const realText = doc.text.bind(doc);
    (doc as any).text = (text: any, ...rest: any[]) => {
      if (Array.isArray(text)) drawnStrings.push(...text.map(String));
      else drawnStrings.push(String(text));
      return realText(text, ...rest);
    };
    const renderer = getBlockRenderer('definition-list');
    expect(renderer, 'the jsPDF definition-list renderer must exist').toBeTruthy();
    renderer!(methodPage.blocks[0] as any, {
      doc,
      page: { width: 595, height: 842 },
      data,
      tokens: template.tokens,
    } as unknown as BlockRenderContext);

    expect(drawnStrings.join(' ')).toContain('Property assessed');
    expect(drawnStrings.join(' '), 'the jsPDF twin drops it too')
      .not.toContain('Assessment grade');
    for (const s of drawnStrings) {
      expect(statesPlaceholder(s), `the jsPDF twin drew "${s}"`).toBeNull();
      expect(fieldIsDashOnly(s), `the jsPDF twin drew a bare dash: "${s}"`).toBe(false);
    }
  });
});

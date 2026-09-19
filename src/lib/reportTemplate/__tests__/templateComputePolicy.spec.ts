/**
 * The template invariant, mechanically (audit F13): a template FORMATS data,
 * it never COMPUTES it. Pins the rule itself, the schema walk, the publish
 * gate, the always-on runtime stop in the binding resolver — and the whole
 * seeded catalogue, so the measured fact that no shipped template computes
 * stays a fact.
 */
import { describe, expect, it } from 'vitest';

import {
  dataArithmeticIn,
  expressionComputesOverData,
  templateExpressionsOf,
  validateForPublish,
} from '../../../../supabase/functions/_shared/templateLibraryCore.pure';
import { resolveBindable } from '../bindingResolver';
import type { ResolveContext } from '../bindingResolver';

import { SEED_TEMPLATES } from '../../../../scripts/template-library/templates';
import { INVESTMENT_COMPASS_TEMPLATES, PRIVATE_BANKING_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/templates';
import { BORROWING_CAPACITY_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/borrowingCapacity';
import { CASH_FLOW_COMPASS_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/cashFlow';
import { CASH_FLOW_COMPARISON_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/cashFlowComparison';
import { CLIENT_DETAILS_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/clientDetails';
import { COMMERCIAL_CAPACITY_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/commercialCapacity';
import { COMPARISON_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/comparison';
import { MARKET_INTELLIGENCE_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/marketIntelligence';
import { PORTFOLIO_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/portfolio';
import { REPORT_QA_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/reportQa';

describe('expressionComputesOverData', () => {
  it('refuses arithmetic over a data reference', () => {
    expect(expressionComputesOverData('financials.annualNet * 1.1')).toBe(true);
    expect(expressionComputesOverData('property.landArea / 2')).toBe(true);
    expect(expressionComputesOverData('financials.deposit + financials.stampDuty')).toBe(true);
    expect(expressionComputesOverData('tenYear.equitySeries[0].value - 500')).toBe(true);
    expect(expressionComputesOverData('financials.x % 2')).toBe(true);
  });

  it('selection stays legal — templates may choose, never derive', () => {
    expect(expressionComputesOverData("financials.annualNet > 0 ? 'surplus' : 'shortfall'")).toBe(false);
    expect(expressionComputesOverData('explanation && explanation.steps')).toBe(false);
    expect(expressionComputesOverData("property.type == 'house'")).toBe(false);
    expect(expressionComputesOverData('financials.lvr >= 80')).toBe(false);
  });

  it('pure-literal arithmetic touches no data and stays legal', () => {
    expect(expressionComputesOverData('1 + 1')).toBe(false);
    expect(expressionComputesOverData("'a' + 'b'")).toBe(false);
  });

  it('operators hidden inside strings do not count; data beside them does', () => {
    expect(expressionComputesOverData("financials.ok ? 'a-b' : 'c/d'")).toBe(false);
    expect(expressionComputesOverData("financials.x - 1 ? 'a' : 'b'")).toBe(true);
  });

  it('deliberately strict: even a negative-literal comparison is refused', () => {
    // Write `>= 0`. A slightly stricter refusal beats a parser.
    expect(expressionComputesOverData('financials.annualNet > -1')).toBe(true);
  });
});

describe('templateExpressionsOf / dataArithmeticIn', () => {
  const schema = {
    tokens: { computed: [{ name: 'markup', expr: 'financials.total * 1.06' }] },
    pages: [{
      blocks: [
        { type: 'text', props: { content: 'Net: {{= financials.annualNet * 52 | money }}' } },
        { type: 'text', props: { content: '{{ financials.annualNet | money }}' } },
        { type: 'text', props: { when: "{{= financials.annualNet > 0 ? 'y' : '' }}" } },
      ],
    }],
  };

  it('collects inline expression heads (filters stripped) and computed fields', () => {
    const exprs = templateExpressionsOf(schema);
    expect(exprs).toContain('financials.annualNet * 52');
    expect(exprs).toContain('financials.total * 1.06');
    expect(exprs).toContain("financials.annualNet > 0 ? 'y' : ''");
    // A plain binding is not an expression.
    expect(exprs).not.toContain('financials.annualNet');
  });

  it('names exactly the computing expressions', () => {
    expect(dataArithmeticIn(schema).sort()).toEqual([
      'financials.annualNet * 52',
      'financials.total * 1.06',
    ]);
  });
});

describe('the publish gate refuses a computing template', () => {
  const entry = (schema: unknown) => ({
    name: 'T', slug: 't', schema,
  });

  it('names the offence and the expressions', () => {
    const problem = validateForPublish(entry({
      pages: [{ blocks: [{ type: 'text', props: { content: '{{= financials.x * 1.1 }}' } }] }],
    }));
    expect(problem?.code).toBe('library_template_computes');
    expect(problem?.detail).toEqual(['financials.x * 1.1']);
  });

  it('a formatting-only template still publishes', () => {
    const problem = validateForPublish(entry({
      pages: [{ blocks: [{ type: 'text', props: { content: '{{ financials.x | money }}' } }] }],
    }));
    expect(problem).toBeNull();
  });
});

describe('the runtime stop in the binding resolver', () => {
  const ctx: ResolveContext = {
    data: { financials: { annualNet: -54858, x: 100 } },
    tokens: { colors: {}, fonts: {}, spacing: {}, computed: [] },
  } as unknown as ResolveContext;

  it('an activated schema that computes resolves to nothing, never to an invented figure', () => {
    expect(resolveBindable('{{= financials.x * 1.1 }}', ctx)).toBe('');
  });

  it('selection over the same data still evaluates', () => {
    expect(resolveBindable("{{= financials.annualNet > 0 ? 'surplus' : 'shortfall' }}", ctx)).toBe('shortfall');
  });

  it('plain bindings and literal arithmetic are untouched', () => {
    expect(resolveBindable('{{ financials.x }}', ctx)).toBe('100');
    expect(resolveBindable('{{= 1 + 1 }}', ctx)).toBe('2');
  });
});

describe('the whole seeded catalogue formats and never computes', () => {
  const COLLECTIONS: Array<[string, Array<{ name?: string; schema: unknown }>]> = [
    ['voice seed', SEED_TEMPLATES as never],
    ['investment compass', INVESTMENT_COMPASS_TEMPLATES as never],
    ['private banking', PRIVATE_BANKING_TEMPLATES as never],
    ['borrowing capacity', BORROWING_CAPACITY_TEMPLATES as never],
    ['cash flow', CASH_FLOW_COMPASS_TEMPLATES as never],
    ['cash flow comparison', CASH_FLOW_COMPARISON_TEMPLATES as never],
    ['client details', CLIENT_DETAILS_TEMPLATES as never],
    ['commercial capacity', COMMERCIAL_CAPACITY_TEMPLATES as never],
    ['comparison', COMPARISON_TEMPLATES as never],
    ['market intelligence', MARKET_INTELLIGENCE_TEMPLATES as never],
    ['portfolio', PORTFOLIO_TEMPLATES as never],
    ['report qa', REPORT_QA_TEMPLATES as never],
  ];

  it.each(COLLECTIONS)('%s: no template computes over data', (_label, templates) => {
    expect(templates.length).toBeGreaterThan(0);
    for (const template of templates) {
      const computing = dataArithmeticIn(template.schema);
      expect(computing, `${template.name ?? 'template'} computes: ${computing.join('; ')}`).toEqual([]);
    }
  });
});

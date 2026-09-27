/**
 * Every standard route draws in the design it was asked for, and says so.
 *
 * The pieces are proven elsewhere — the request parsers (`designRequest.spec.ts`),
 * the read (`resolveRequestedDesign`), the renderers under every design
 * (`templateDesignParity.spec.ts`) — and none of that is worth anything if a
 * handler forgets to join them: a route that parses a design and never hands it
 * to its renderer draws the house design while the browser believes the choice
 * was honoured. Edge handlers do not run under vitest, so their wiring is read
 * from the source, the way `builderPortalUiMounted.spec.ts` reads its mounts.
 *
 * For each of the nine routes: it resolves the design the request named, for
 * its own report type, for the person who asked; it passes the result to the
 * renderer that draws the document; and it echoes what happened on the
 * response.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const FUNCTIONS = resolve(__dirname, '../../../../supabase/functions');

const ROUTES: ReadonlyArray<readonly [route: string, reportType: string, render: string]> = [
  ['render-borrowing-capacity-pdf', 'borrowing_capacity', 'renderSnapshotFromBrand'],
  ['render-cash-flow-pdf', 'cashflow', 'renderCashFlowFromBrand'],
  ['render-cash-flow-comparison-pdf', 'cash_flow_comparison', 'renderComparisonFromBrand'],
  ['render-client-details-pdf', 'client_details', 'renderClientDetailsFromBrand'],
  ['render-commercial-capacity-pdf', 'commercial_capacity', 'renderCapacityFromBrand'],
  ['render-market-intelligence-pdf', 'market_intelligence', 'renderMarketIntelligenceFromBrand'],
  ['render-portfolio-review-pdf', 'portfolio', 'renderPortfolioFromBrand'],
  ['render-property-comparison-pdf', 'comparison', 'renderComparisonFromBrand'],
  ['render-report-qa-pdf', 'qa', 'renderReportQaFromBrand'],
];

/** The text of one call — from `name(` to its matching `)`. */
function callText(source: string, name: string): string {
  const start = source.indexOf(`${name}(`);
  if (start < 0) return '';
  let depth = 0;
  for (let i = start + name.length; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1;
    else if (source[i] === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return '';
}

/** The text of the response object literal the route answers with. */
function responseText(source: string): string {
  const m = /const response: \w+RenderResponse = \{[\s\S]*?\n {4}\};/.exec(source);
  return m ? m[0] : '';
}

describe.each(ROUTES)('%s', (route, reportType, render) => {
  const source = readFileSync(resolve(FUNCTIONS, route, 'index.ts'), 'utf8');

  it('resolves the design the request named, for its own report type', () => {
    const resolveCall = callText(source, 'resolveRequestedDesign');
    expect(resolveCall, 'no resolveRequestedDesign call').not.toBe('');
    expect(resolveCall).toMatch(new RegExp(`reportType: '${reportType}'`));
    expect(resolveCall).toMatch(/reference: (request\.design|designReference)/);
    // For the person who asked — never a bare service identity.
    expect(resolveCall).toMatch(/actor: /);
  });

  it('resolves it after the caller has been authenticated', () => {
    const authAt = source.search(/verifyAuth(OrNativeUser)?\(/);
    const resolveAt = source.indexOf('resolveRequestedDesign(supabase');
    expect(authAt).toBeGreaterThan(-1);
    expect(resolveAt).toBeGreaterThan(authAt);
  });

  it('hands the design to the renderer that draws the document', () => {
    const renderCall = callText(source, render);
    expect(renderCall, `no ${render} call`).not.toBe('');
    expect(renderCall).toMatch(/\n\s+design,\n/);
  });

  it('says on the response what became of the design', () => {
    expect(responseText(source)).toMatch(/design: designEcho,/);
  });
});

describe('the one render nobody is watching', () => {
  it('reads its owner\'s choice when the scheduled send renders on their behalf', () => {
    const source = readFileSync(resolve(FUNCTIONS, 'render-market-intelligence-pdf', 'index.ts'), 'utf8');
    expect(source).toMatch(/request\.design\s*\?\?\s*\(auth\.userId === 'service_role'/);
    expect(callText(source, 'chosenDesignReference')).toMatch(/userId: actorId/);
  });
});

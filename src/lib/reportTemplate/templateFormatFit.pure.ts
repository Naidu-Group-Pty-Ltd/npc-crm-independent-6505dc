/**
 * Whether a library template can carry a format's report — asked before the
 * document is made, not after.
 *
 * ## The defect this exists to end
 *
 * A chosen template that binds none of a report's content is not refused. It
 * is **composed**: its cover and closing pages are kept where they name this
 * report, its blank content pages are dropped, and another published
 * template's body pages are spliced in under its palette
 * (`templateComposition.pure.ts`). That is the right behaviour at render time
 * — an empty five-page document is worse — but the person who picked the
 * design is told about it by a `toast` raised *after* the PDF already exists,
 * on a surface where it has usually already downloaded. Where no donor can be
 * found the route refuses outright, with the same timing.
 *
 * The picker could see it coming and did not look. `required_bindings` is
 * already selected into the library list and already carried on every entry
 * (`useTemplateLibrary.ts:50`) and nothing read it.
 *
 * Measured over the seeded library: the 500 Investment Compass family masters
 * are generated against each format's own adapter vocabulary and fit by
 * construction. The 43 voice templates were authored against a sample preset,
 * and six of them bind a vocabulary no adapter publishes — the First-Home
 * Buyer report's `grants.fhog` / `steps.0` on the Investment format, and all
 * five Client Details voice designs, whose only non-furniture namespaces are
 * `brief.*`, `risk.*`, `engagement.*`, `inspection.*` and `onboarding.*`.
 *
 * ## The rules
 *
 * 1. **A caveat is drawn only where it is certain.** An entry that declares no
 *    `required_bindings`, or a format this module does not know, answers
 *    `unknown` and is offered exactly as before. A false caveat on a good
 *    design costs more than a missing one, because it teaches people to
 *    dismiss the warning.
 * 2. **Furniture is not content.** A template binding only `org.*`, `brand.*`,
 *    `report.*`, `meta.*`, `tier.*`, `variant.*` or `client.*` is a letterhead
 *    around nothing, and that is the same finding — the namespaces are the
 *    ones `templateBindingCoverage.pure.ts` already uses, restated here and
 *    pinned equal by a test, because that module is Deno-side.
 * 3. **This measures the DECLARATION, not the record.** `measureBindingCoverage`
 *    resolves real paths against real data at render time and stays the
 *    authority. This is the cheap question a picker can ask with no report in
 *    hand: does this design speak a vocabulary this format publishes at all?
 */

/** The namespaces a format's adapter and projection publish. */
export const FORMAT_PUBLISHED_NAMESPACES: Readonly<Record<string, readonly string[]>> = {
  // `investmentReportAdapter` + `applyInvestmentProjection` + the organisation
  // projection. Pinned by `templateFormatFit.spec.ts` against the projection's
  // own output for a production-shaped row, so a renamed key fails a test.
  investment: [
    'report', 'property', 'financials', 'scores', 'demographics', 'economic',
    'location', 'sections', 'sources', 'overrides', 'tier', 'variant', 'brand',
    'org', 'meta', 'client', 'summary', 'recommendation', 'assumptions',
    'risks', 'narrative', 'scorecard', 'nextSteps', 'assessment', 'opportunities',
    'equitySeries',
  ],
  borrowing_capacity: ['report', 'org', 'brand', 'client', 'capacity', 'meta', 'tier', 'variant'],
  portfolio: ['report', 'org', 'brand', 'client', 'portfolio', 'meta', 'tier', 'variant'],
  comparison: ['report', 'org', 'brand', 'client', 'comparison', 'meta', 'tier', 'variant'],
  cashflow: ['report', 'org', 'brand', 'client', 'cashflow', 'property', 'financials', 'assumptions', 'meta', 'tier', 'variant'],
  cash_flow_comparison: ['report', 'org', 'brand', 'client', 'cashFlowComparison', 'meta', 'tier', 'variant'],
  client_details: ['report', 'org', 'brand', 'client', 'record', 'clientDetails', 'meta', 'tier', 'variant'],
  qa: ['report', 'org', 'brand', 'client', 'qa', 'meta', 'tier', 'variant'],
  market_intelligence: ['report', 'org', 'brand', 'client', 'marketIntel', 'meta', 'tier', 'variant'],
  commercial_industrial: ['report', 'org', 'brand', 'client', 'capacity', 'commercial', 'meta', 'tier', 'variant'],
};

/**
 * Namespaces that dress a page rather than carry a report.
 *
 * The same set `templateBindingCoverage.pure.ts` uses. It is restated here
 * rather than imported because this module is browser-side and that one is a
 * Deno edge module; `templateFormatFit.spec.ts` asserts the two are equal, so
 * a change to either fails rather than diverging silently.
 */
export const FURNITURE_ONLY_NAMESPACES: readonly string[] = [
  'org', 'brand', 'report', 'meta', 'tier', 'variant', 'client',
];

export type TemplateFormatFit =
  /** It binds at least one namespace this format publishes. */
  | 'carries'
  /** It binds content, and none of it is a vocabulary this format publishes. */
  | 'foreign_vocabulary'
  /** It binds only page furniture — a letterhead around nothing. */
  | 'furniture_only'
  /** Not enough is declared to say. Offered unchanged. */
  | 'unknown';

/** `financials.annualRent` → `financials`. A bare token is its own namespace. */
function namespaceOf(binding: string): string {
  const cleaned = binding.trim().replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '');
  const head = cleaned.split(/[.|\s[]/)[0];
  return head ?? '';
}

export interface TemplateFitReading {
  fit: TemplateFormatFit;
  /** The namespaces it binds that this format does not publish. */
  foreign: string[];
}

/**
 * What a template's declared bindings say about this format.
 *
 * Rule 1 throughout: every uncertain case answers `unknown`, which draws
 * nothing and asks for nothing.
 */
export function assessTemplateFit(
  requiredBindings: readonly string[] | null | undefined,
  reportFormat: string | null | undefined,
): TemplateFitReading {
  const published = reportFormat ? FORMAT_PUBLISHED_NAMESPACES[reportFormat] : undefined;
  if (!published || !Array.isArray(requiredBindings) || requiredBindings.length === 0) {
    return { fit: 'unknown', foreign: [] };
  }
  const furniture = new Set(FURNITURE_ONLY_NAMESPACES);
  const publishedSet = new Set(published);

  const namespaces = [...new Set(requiredBindings.map(namespaceOf).filter((n) => n !== ''))];
  if (namespaces.length === 0) return { fit: 'unknown', foreign: [] };

  const content = namespaces.filter((n) => !furniture.has(n));
  if (content.length === 0) return { fit: 'furniture_only', foreign: [] };

  const carried = content.filter((n) => publishedSet.has(n));
  if (carried.length > 0) return { fit: 'carries', foreign: content.filter((n) => !publishedSet.has(n)) };
  return { fit: 'foreign_vocabulary', foreign: content };
}

/**
 * The caveat a tile draws, or null where there is nothing certain to say.
 *
 * Written as a fact about the template rather than a verdict on the person's
 * taste, and it names what happens next — because the substitution is what
 * they are being asked to consent to.
 */
export function templateFitCaveat(reading: TemplateFitReading, formatLabel: string): string | null {
  if (reading.fit === 'carries' || reading.fit === 'unknown') return null;
  if (reading.fit === 'furniture_only') {
    return `This design binds only page furniture — a letterhead and a running foot — and none of a ${formatLabel} report's content. `
      + 'Choosing it means the report body is drawn from another published design in this one’s palette.';
  }
  const named = reading.foreign.slice(0, 3).join(', ');
  return `This design was authored for a different report: it binds ${named}${reading.foreign.length > 3 ? ' and others' : ''}, `
    + `which a ${formatLabel} report does not publish. Choosing it means its empty pages are left out and the report body is `
    + 'drawn from another published design in this one’s palette.';
}

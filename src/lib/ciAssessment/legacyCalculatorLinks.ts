/**
 * Where an old "calculators" link goes now.
 *
 * ## What was retired, and why
 *
 * `/calculators` served a second workspace over the very same assessment
 * records — the "Standalone calculators" button on the module landing opened
 * it. It listed the same assessments ("Untitled assessment · Draft"), created
 * the same records under another name ("Untitled analysis"), and edited them
 * through a second, differently ordered set of stages. Two editors for one
 * record, and nothing to tell a user which one they were meant to be in.
 *
 * Its only capability the assessment lacked — the valuation and the forecast —
 * is now a step of the assessment itself, and starting from a register property
 * is part of "New assessment". So the route is a redirect: every link that has
 * ever pointed at it lands somewhere that does what the link meant.
 *
 * | Arrival | Lands on |
 * | --- | --- |
 * | `?workspace=<id>[&stage=<s>]` | that assessment, at the matching step |
 * | `?propertyId=<id>[&domain=<d>]` | that building's own page, whose "New assessment" starts one of it |
 * | anything else | the module's assessment list |
 *
 * **A link never creates a record.** It used to: every "Send to Calculators"
 * click minted an "Untitled analysis". A "New assessment" BUTTON creates one
 * now (`useStartAssessment`), because pressing it is somebody asking for one.
 * A link is not. It is followed again by a refresh, the Back button and every
 * bookmark, so a link that created would create each time. A property link
 * therefore lands on the building's page, one click away.
 *
 * The pre-workspace suite at `/calculators/classic` is a separate route and is
 * untouched by this.
 */

import { registerPropertyPath } from './registerProperty';

export interface LegacyCalculatorParams {
  workspace: string | null;
  stage: string | null;
  domain: string | null;
  propertyId: string | null;
}

/**
 * The analysis workspace's stages, mapped to the assessment step that now
 * holds the same fields. `context` named the analysis and chose the
 * transaction type, which is the Type step; `report` generated the document,
 * which is done from Results.
 */
const STAGE_TO_STEP: Readonly<Record<string, string>> = {
  context: 'type',
  property: 'property',
  income: 'lease',
  ownership: 'ownership',
  lending: 'loan',
  valuation: 'analysis',
  forecast: 'analysis',
  results: 'results',
  report: 'results',
};

/**
 * The query parameter of a "New assessment" link: `?new=assessment`, with
 * `&domain=…&propertyId=…` when it names a building.
 *
 * Nothing in the app writes one any more; the buttons create directly. The
 * links already out there (this landing opened a "New assessment" dialog from
 * them) are still read, so each lands where it meant: on the building it
 * names, or on the list.
 */
export const NEW_ASSESSMENT_PARAM = 'new';
export const NEW_ASSESSMENT_VALUE = 'assessment';

/** What a "New assessment" link asks for: a new assessment, and optionally the building. */
export interface NewAssessmentLink {
  property: { domain: 'commercial' | 'industrial'; propertyId: string } | null;
}

/**
 * Read a "New assessment" link off the landing's URL — `null` when the URL is
 * not one. A building is named only when both halves are present and the
 * register is one the module has; anything else names no building rather than
 * guessing which register was meant.
 */
export function readNewAssessmentLink(params: URLSearchParams): NewAssessmentLink | null {
  if (params.get(NEW_ASSESSMENT_PARAM) !== NEW_ASSESSMENT_VALUE) return null;
  const domain = params.get('domain');
  const propertyId = params.get('propertyId')?.trim();
  return {
    property: propertyId && (domain === 'commercial' || domain === 'industrial') ? { domain, propertyId } : null,
  };
}

/** The same URL without the request — what the landing replaces it with. */
export function withoutNewAssessmentLink(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete(NEW_ASSESSMENT_PARAM);
  next.delete('domain');
  next.delete('propertyId');
  return next;
}

export function legacyCalculatorRedirect(params: LegacyCalculatorParams): string {
  const workspace = params.workspace?.trim();
  if (workspace) {
    const step = params.stage ? STAGE_TO_STEP[params.stage] : undefined;
    return `/commercial/assessments/${encodeURIComponent(workspace)}${step ? `?step=${step}` : ''}`;
  }

  const propertyId = params.propertyId?.trim();
  if (propertyId) {
    return registerPropertyPath({ domain: params.domain === 'industrial' ? 'industrial' : 'commercial', propertyId });
  }

  return '/commercial?tab=assessments';
}

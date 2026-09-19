/**
 * What `/calculators` should do when it opens.
 *
 * The page has three kinds of visitor, and the old one served only the third:
 *
 *  - somebody returning to an analysis they were working on yesterday;
 *  - somebody arriving from a property page, on a link that has existed for a
 *    long time — `/calculators?domain=industrial&propertyId=…`;
 *  - somebody starting from scratch.
 *
 * Those links must keep working, which is the whole reason this is a pure
 * function rather than a tangle of effects: the mapping from query string to
 * intent is testable, and a bookmark from six months ago is a test case rather
 * than a hope.
 *
 * The workspace identity itself is an **assessment id**. There is no separate
 * "calculator session" record, because an analysis and an assessment are the
 * same object seen from two ends — the calculator suite simply had no durable
 * end. `?workspace=<id>` is the new canonical link.
 */

export type WorkspaceDomain = 'commercial' | 'industrial';

export interface BootstrapParams {
  /** `?workspace=` — an analysis to resume. */
  workspace: string | null;
  /** `?domain=` — legacy, and still how the two suites were told apart. */
  domain: string | null;
  /** `?propertyId=` — legacy deep link from a property page. */
  propertyId: string | null;
}

export type BootstrapPlan =
  /** Open this analysis. Nothing is created. */
  | { kind: 'open'; assessmentId: string; propertyId: string | null }
  /**
   * Start one. A property deep-link is honoured by creating the analysis
   * *around* that property rather than dead-ending on a page that cannot hold
   * it — the old link's intent was "analyse this building".
   */
  | { kind: 'create'; domain: WorkspaceDomain; propertyId: string | null; reason: 'property_link' | 'fresh' }
  /** Nothing was asked for. Offer the recent analyses and a way to start one. */
  | { kind: 'choose'; domain: WorkspaceDomain };

const DOMAINS: readonly string[] = ['commercial', 'industrial'];

export function normaliseDomain(value: string | null | undefined): WorkspaceDomain {
  return value && DOMAINS.includes(value) ? (value as WorkspaceDomain) : 'commercial';
}

/**
 * Decide what the page does on arrival.
 *
 * Order matters and is deliberate: an explicit workspace wins over everything
 * (it is the thing the user asked for), a property link creates around that
 * property, and a bare visit chooses rather than creating — a page that
 * silently creates a record every time somebody clicks the nav item fills the
 * list with empty analyses nobody wanted.
 */
export function planBootstrap(params: BootstrapParams): BootstrapPlan {
  const domain = normaliseDomain(params.domain);
  const propertyId = params.propertyId?.trim() || null;

  if (params.workspace?.trim()) {
    return { kind: 'open', assessmentId: params.workspace.trim(), propertyId };
  }
  if (propertyId) {
    return { kind: 'create', domain, propertyId, reason: 'property_link' };
  }
  return { kind: 'choose', domain };
}

/** The assessment type a fresh analysis starts as, given the domain. */
export function initialAssessmentType(domain: WorkspaceDomain): 'commercial_investment' | 'industrial_investment' {
  return domain === 'industrial' ? 'industrial_investment' : 'commercial_investment';
}

/** The canonical link to an analysis, for anything that needs to point at one. */
export function workspacePath(assessmentId: string, stage?: string): string {
  const stagePart = stage ? `&stage=${encodeURIComponent(stage)}` : '';
  return `/calculators?workspace=${encodeURIComponent(assessmentId)}${stagePart}`;
}

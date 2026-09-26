/**
 * Major public projects recorded from their publisher's own pages.
 *
 * ── Why this exists beside the structured registers ──────────────────────
 *
 * `investmentProgramme.pure.ts` reads Queensland's QTRIP, which is a machine-
 * readable feed. Its own `PROGRAMME_PUBLISHERS` table records that seven of
 * the eight jurisdictions publish their forward programme as a PUBLICATION —
 * budget papers, agency project pages, council delivery programs — and marks
 * them `ingested: false`. That is honest, and on its own it means a report for
 * a New South Wales property carries no infrastructure project at all, however
 * large the works a kilometre down the road.
 *
 * On 48 Redfern Street, Cowra that is a $110.2 million hospital 1.09 km away
 * that opened while the report was being written. No register this platform
 * reads holds it. Health Infrastructure NSW published every fact about it, on
 * dated pages, under its own name.
 *
 * So the evidence travels, and it travels LABELLED. A row here is
 * `recorded from an official publication`, never `retrieved from a register` —
 * the same distinction `operator_stated` already draws one level down, for the
 * same reason: a reader is entitled to know whether a machine read a feed or a
 * person read a page, because the two fail differently.
 *
 * ── The rule that shapes the type ────────────────────────────────────────
 *
 * **One project is one investment figure, and its stages are stages of it.**
 *
 * The Cowra project has four published milestones across three pages: a
 * completion announcement, an open day, an opening date, and a demolition and
 * car-park stage with its own start and end. Every one of those pages says
 * "$110.2 million". A register that stored them as four items would invite the
 * arithmetic that turns one hospital into $440.8 million of regional
 * investment — which is the failure §5 names, and which `unconfirmedDuplicateOf`
 * already guards against one layer down for the same reason.
 *
 * So `investment` sits on the PROJECT and the stages carry none. There is no
 * field for a stage-level amount, because a field that cannot be summed
 * wrongly is better than a rule saying not to.
 *
 * ── What a row must carry ────────────────────────────────────────────────
 *
 * The six things §5 asks of every material project, plus the two a reader
 * needs and no register publishes: what is actually DELIVERED, and what the
 * evidence does NOT establish. The second is required rather than optional,
 * because the whole class of error this replaces is an infrastructure sentence
 * that implies an effect on prices nobody measured.
 *
 * Deno-compatible: its one import is the pure adviser-voice module, which
 * decides where each limitation is explained (`DISCLOSURE_HOMES`).
 */

import { elsewhereOnly, inHomeSection } from '../reports/adviserVoice.pure.ts';

/** A published milestone of one project, with the date of the STATEMENT. */
export interface ProjectStage {
  /** What this stage is, plainly. */
  stage: string;
  /**
   * The publisher's own status words for it. Verbatim — a paraphrase of a
   * status is a status nobody published.
   */
  publishedStatus: string;
  /** The date the publisher gave that status. Never today's date. */
  statusDate: string;
  /**
   * When the stage happens or happened, in the publisher's own words —
   * `9 December 2025`, `5 January 2026 to mid-2026`. Kept as text because
   * "mid-2026" is an estimate and rendering it as a date asserts a precision
   * the publisher did not claim.
   */
  timing: string | null;
  /** The page this stage was read from. */
  sourceUrl: string;
  /** The date that page carries. */
  published: string;
}

export interface PublishedProject {
  /** The project's own name, as its publisher writes it. */
  name: string;
  /** The agency responsible for delivering it. */
  authority: string;
  /** Any delivery partner the publisher names. */
  partners: string[];
  /** The head contractor, where the publisher names one. */
  contractor: string | null;
  /**
   * The project's stated investment — ONE figure for the whole project.
   *
   * There is deliberately no per-stage amount. See the header.
   */
  investment: { amount: number; currency: 'AUD'; statedAs: string } | null;
  /** Where it is. */
  latitude: number;
  longitude: number;
  /** The locality it serves, in ordinary words. */
  locality: string;
  state: string;
  /** Published milestones, oldest first. */
  stages: ProjectStage[];
  /** What the completed project actually provides. */
  delivers: string[];
  /** Disruption the publisher itself states, with its window. */
  disruption: string[];
  /**
   * What this evidence does NOT establish. Required, not optional.
   *
   * Every sentence here is about the limits of the evidence, never a hedge on
   * a conclusion — because the conclusion a reader wants ("this will lift
   * prices") is one nothing here supports and nothing here may imply.
   */
  doesNotEstablish: string[];
  /** When this deployment last checked the publisher's pages. */
  recordedAt: string;
}

/** How a row reached the report. Never a register reading. */
export const PUBLISHED_PROJECT_BASIS =
  'Recorded from the responsible authority’s own published pages.';

/**
 * The register.
 *
 * Small and explicit on purpose. A project earns a row by being large enough
 * to matter to a property decision and by being documented on the responsible
 * authority's own dated pages — not by appearing in a news article, a listing
 * portal or a search result, none of which is a retrieval.
 */
export const PUBLISHED_PROJECTS: readonly PublishedProject[] = [
  {
    name: 'Cowra Hospital Redevelopment',
    authority: 'Health Infrastructure NSW',
    partners: ['Western NSW Local Health District'],
    contractor: 'Richard Crookes Constructions',
    investment: { amount: 110_200_000, currency: 'AUD', statedAs: '$110.2 million' },
    latitude: -33.831558,
    longitude: 148.692496,
    locality: 'Cowra',
    state: 'NSW',
    stages: [
      {
        stage: 'Construction of the new hospital',
        publishedStatus: 'Construction of the $110.2 million Cowra Hospital Redevelopment is now complete',
        statusDate: '2025-11-11',
        timing: 'Complete as at 11 November 2025',
        sourceUrl: 'https://www.nsw.gov.au/departments-and-agencies/health-infrastructure/news/cowra-hospital-redevelopment-reaches-completion-milestone',
        published: '2025-11-11',
      },
      {
        stage: 'Community open day',
        publishedStatus: 'Held — almost 600 people attended guided tours',
        statusDate: '2025-11-29',
        timing: '29 November 2025',
        sourceUrl: 'https://www.nsw.gov.au/departments-and-agencies/health-infrastructure/news/cowra-hospital-redevelopment-reaches-completion-milestone',
        published: '2025-11-11',
      },
      {
        stage: 'Services move into the new building',
        publishedStatus: 'Open and operating — emergency, inpatient and outpatient services including maternity, surgical and oncology',
        statusDate: '2025-12-08',
        timing: '9 December 2025',
        sourceUrl: 'https://www.health.nsw.gov.au/news/Pages/20251208_00.aspx',
        published: '2025-12-08',
      },
      {
        stage: 'Demolition of the former hospital, then civil works, car park and landscaping',
        publishedStatus: 'Scheduled works — demolition followed by civil and landscaping work to deliver new parking',
        statusDate: '2025-12-18',
        timing: '5 January 2026 to mid-2026; asbestos-containing material removal 12 January to late March 2026',
        sourceUrl: 'https://www.nsw.gov.au/departments-and-agencies/health-infrastructure/news/cowra-hospital-redevelopment-works-notice-5-january-2026-to-mid-2026',
        published: '2025-12-18',
      },
    ],
    delivers: [
      'An emergency department',
      'A general medical and surgical inpatient ward',
      'A perioperative service',
      'A maternity unit with a dedicated nursery',
      'Ambulatory care, a dental clinic, renal dialysis and oncology',
      'Community health, mental health, and drug and alcohol services',
      'The hospital’s first CT scanner',
    ],
    disruption: [
      'On-street parking on the northern side of Liverpool Street is unavailable until mid-2026',
      'Demolition works run 7.00am–6.00pm Monday to Friday and 8.00am–1.00pm Saturday, with no Sunday or public holiday work',
    ],
    doesNotEstablish: [
      'Any effect on property values, rents or demand in Cowra — no such effect is claimed and none is measured here',
      'Employment numbers, at the hospital or during construction',
      'That the final stage has finished: "mid-2026" is the publisher’s own estimate for its end, and no later statement confirming completion was found',
    ],
    recordedAt: '2026-09-19',
  },
];

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const R_EARTH_KM = 6371;

/** Great-circle distance in kilometres. */
export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.sqrt(h));
}

export interface NearbyProject {
  project: PublishedProject;
  /** Straight-line, which is what this measures and what it must be called. */
  distanceKm: number;
}

/**
 * Projects within `radiusKm` of a coordinate, nearest first.
 *
 * Distance is straight-line and is labelled as such everywhere it is printed:
 * a road journey is longer, and a figure whose basis is not stated is the
 * defect the derived-figures rule already covers.
 */
export function projectsNear(
  latitude: number,
  longitude: number,
  radiusKm: number,
  register: readonly PublishedProject[] = PUBLISHED_PROJECTS,
): NearbyProject[] {
  return register
    .map((project) => ({
      project,
      distanceKm: distanceKm(latitude, longitude, project.latitude, project.longitude),
    }))
    .filter((p) => p.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

/**
 * The reading a project supports about its own delivery state.
 *
 * Derived from the STAGES rather than stored, because a stored status goes
 * stale silently while a stage list carries the date of every statement in it.
 * Where the last stage's timing is an estimate that has passed, the reading
 * says the estimate has passed and NOT that the work finished — "mid-2026"
 * was a forecast and a calendar is not a publisher.
 */
export type ProjectReading =
  | 'operational_with_works_continuing'
  | 'operational'
  | 'under_way'
  | 'announced';

export function readProjectState(project: PublishedProject): ProjectReading {
  const said = project.stages.map((s) => s.publishedStatus.toLowerCase());
  const open = said.some((s) => /\bopen(ed|ing)?\b|\boperating\b/.test(s));
  const scheduled = said.some((s) => /\bscheduled\b|\bwill\b|\bto deliver\b/.test(s));
  const built = said.some((s) => /\bcomplete\b/.test(s));
  if (open && scheduled) return 'operational_with_works_continuing';
  if (open) return 'operational';
  if (built || scheduled) return 'under_way';
  return 'announced';
}

const READING_SENTENCE: Readonly<Record<ProjectReading, string>> = {
  operational_with_works_continuing:
    'Open and operating, with a further published stage of works under way on the same site.',
  operational: 'Open and operating.',
  under_way: 'Under way — built or scheduled, and not yet reported as open.',
  announced: 'Announced.',
};

/**
 * Render the projects for a report section.
 *
 * Composed here rather than asked of a model, for the reason the planning
 * table is: every fact in it is either published or absent, and neither is a
 * writing task. The prose a model writes around it is governed by
 * `publishedProjectRules` below.
 */
/**
 * Whether this register was actually consulted for this property.
 *
 * An empty result used to be one thing: `renderPublishedProjects([])` returned
 * the empty STRING and `publishedProjectRules([])` told the model "no major
 * public project near this property is recorded in this platform's register".
 * That sentence asserts a search happened. It was returned identically when no
 * coordinate had resolved and no search was possible — which, measured over the
 * 105 stored reports in the verification corpus, was every one of them.
 *
 * The two absences are different sentences, and it is the same rule
 * `planningConstraints` answers to: a register asked HERE that holds nothing
 * here is a fact about the property; never having asked is a fact about us.
 * So the caller states which, and there is no default — a caller that forgets
 * would otherwise get the assertive reading, which is the unsafe direction.
 */
export type RegisterSearch =
  | {
      searched: true;
      /** The radius actually swept, in kilometres. */
      radiusKm: number;
      /** How the coordinate it was swept around was obtained. */
      coordinateSource: 'enrichment' | 'geocode_recovery';
    }
  | {
      searched: false;
      /**
       * One sentence: why no search could be made. It is the OPERATOR's — the
       * acquisition ledger records it — and neither the page nor the writer is
       * handed it: "none was usable — the geocoder answered at locality
       * precision" is true, and it describes how the report was made rather
       * than the property (`adviserVoice.pure.ts`).
       */
      reason: string;
    };

export function renderPublishedProjects(
  near: readonly NearbyProject[],
  search: RegisterSearch,
): string {
  if (!near.length) {
    // A blank section is indistinguishable from a register nobody consulted,
    // and a reader cannot see the prompt rules. So the page says which.
    if (!search.searched) {
      return [
        '**Major public projects were not checked.** We track major public projects from the responsible '
        + 'authorities\' own published pages, and the property\'s location could not be confirmed closely enough '
        + 'to measure what lies near it.',
        '',
        'Nothing follows from that about what is or is not planned near this property. The state\'s infrastructure '
        + 'agency and the local council publish their current projects.',
        '',
      ].join('\n');
    }
    return [
      `**No major public project recorded nearby.** None of the major public projects we track lies within `
      + `${search.radiusKm} km of the property.`,
      '',
      'That describes what has been RECORDED, not a finding about the area — what these records cover is set '
      + 'out below.',
      '',
    ].join('\n');
  }
  const lines: string[] = [];
  for (const { project: p, distanceKm: d } of near) {
    lines.push(`### ${p.name}`, '');
    const who = [`**Responsible authority:** ${p.authority}`];
    if (p.partners.length) who.push(`**With:** ${p.partners.join(', ')}`);
    if (p.contractor) who.push(`**Head contractor:** ${p.contractor}`);
    who.push(`**Distance:** ${d.toFixed(1)} km straight-line from the property (a road journey is longer)`);
    lines.push(who.join(' · '), '');

    lines.push(`**State of delivery.** ${READING_SENTENCE[readProjectState(p)]}`, '');

    if (p.investment) {
      lines.push(
        `**Investment.** ${p.investment.statedAs}, stated by ${p.authority} for the project as a whole. `
        + 'The milestones below are stages of that one project and of that one figure; they are not separate '
        + 'investments and must not be added together.',
        '',
      );
    }

    lines.push('| Stage | Published status | Stated on | Timing |');
    lines.push('|---|---|---|---|');
    for (const s of p.stages) {
      lines.push(`| ${s.stage} | ${s.publishedStatus} | ${auDate(s.statusDate)} | ${s.timing ?? '—'} |`);
    }
    lines.push('');

    if (p.delivers.length) {
      lines.push('**What it delivers.** ' + p.delivers.join('; ') + '.', '');
    }
    if (p.disruption.length) {
      lines.push('**Disruption on the record.** ' + p.disruption.join('. ') + '.', '');
    }
    lines.push(
      '**What this evidence does not establish.** ' + p.doesNotEstablish.join('. ') + '.',
      '',
    );
    const urls = [...new Set(p.stages.map((s) => s.sourceUrl))];
    lines.push(
      `Source: ${p.authority}, ${urls.length === 1 ? 'published page' : `${urls.length} published pages`} `
      + `dated ${[...new Set(p.stages.map((s) => auDate(s.published)))].join(', ')}; `
      + `last checked ${auDate(p.recordedAt)}. ${PUBLISHED_PROJECT_BASIS}`,
      '',
    );
  }
  return lines.join('\n');
}

function auDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
}

/**
 * What the prose may say about these projects.
 *
 * Every rule here exists because the sentence it forbids is the one a model
 * writes by default about a new hospital near a house.
 */
export function publishedProjectRules(
  near: readonly NearbyProject[],
  search: RegisterSearch,
): string {
  if (!near.length && !search.searched) {
    return 'PUBLISHED PROJECT RULES — major public projects near this property could NOT be checked for this '
      + 'report. You therefore know nothing about major public projects near it. Do not write that there are '
      + 'none, do not rate the area’s infrastructure outlook, and do not fill the gap from a live web search, '
      + `a news article or a listing portal. ${inHomeSection('infrastructure')} say once that major public `
      + `projects nearby could not be checked for this report, and stop there. ${elsewhereOnly('infrastructure')}`;
  }
  if (!near.length) {
    return 'PUBLISHED PROJECT RULES — no major public project near this property is recorded among the projects '
      + 'we track from the responsible authorities’ own published pages. That is a statement about what has been '
      + 'RECORDED, not about the area: do not write that there is no infrastructure investment nearby, '
      + 'do not rate the area’s infrastructure outlook from it, and do not fill the gap from a live '
      + `web search, a news article or a listing portal. ${inHomeSection('infrastructure')} say once what these `
      + `records cover and what they do not. ${elsewhereOnly('infrastructure')}`;
  }
  const names = near.map((n) => n.project.name).join('; ');
  return [
    'PUBLISHED PROJECT RULES — they override any example elsewhere in this prompt.',
    `1. The project block above is supplied complete for: ${names}. Reproduce its table exactly. `
    + 'Do not add a project, a figure, a date or a stage to it, and do not name a project that is not in it.',
    '2. ONE project is ONE investment figure. The stages are stages of the same project and the same money. '
    + 'Never add them together, never present a stage as a separate investment, and never total the projects '
    + 'in this section into a regional investment figure.',
    '3. A published timing is the publisher’s own estimate and is written as one. "Mid-2026" is not a '
    + 'completion, a date that has passed is not evidence the work finished, and only a later statement from '
    + 'the authority itself can say a stage is done.',
    '4. Do NOT state or imply an effect on property values, rents, yields, demand, days on market or capital '
    + 'growth from any project here. No such effect is measured and none may be asserted, suggested, hinted at '
    + 'or expressed as a likelihood. Describe what is delivered and what changes for a resident or a tenant, '
    + 'and stop there.',
    '5. Do NOT rate the area’s infrastructure outlook, pipeline or momentum from this section — not Low, '
    + 'not Strong, not Favourable, not a score. A list of recorded publications is not a survey of the area, '
    + 'and its coverage is stated with it.',
    '6. This evidence was recorded from the authority’s own published pages. Where the section names its basis, '
    + 'name that one — the authority and its page, never "a register".',
  ].join('\n');
}

/** What a reader must be told this register does not cover. */
export const PUBLISHED_PROJECT_COVERAGE: readonly string[] = [
  'It includes major public projects recorded from the responsible authority’s own published pages, and nothing else.',
  'It does not include council capital works programmes, budget papers, private development, or projects an authority has not published a dated page about.',
  'A project missing from it has not been shown to be absent from the area — it has not been recorded here.',
];

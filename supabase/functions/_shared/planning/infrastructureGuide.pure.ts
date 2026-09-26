/**
 * What each kind of infrastructure finding MEANS — the educational half.
 *
 * S5/S6 §4: *"Complete the educational treatment inspired by Lot 20427:
 * explain what each material table or finding means, its limitations and the
 * practical next action."*
 *
 * `planningControlGuide.pure.ts` already does this for planning controls, and
 * the outlook table had the other half of the problem: a reader is handed a
 * row saying `PAN-619414 · Development application · Determined Jul 2026 ·
 * $93,180,778` and is left to work out for themselves whether that is a good
 * thing, whether it will happen, and what they should do about it. The table
 * beside it explains the vocabulary (*"an approval is not funding"*) and the
 * coverage (*"what these registers do not reach"*), which are both true and
 * neither of which is what to DO.
 *
 * ## The rule that makes this safe
 *
 * **Everything here is true of the KIND of entry, never of the property.**
 * It says what a development application IS and what a reader can and cannot
 * conclude from one; it never says this property is affected by one, never
 * quantifies an effect on value, and never rates anything. Those are readings,
 * and readings come from the registers alone. That separation is what lets
 * every word of this be written in advance and still be true on every
 * property in the country — the same rule `planningControlGuide` answers to,
 * and a spec enforces it by refusing any currency amount, percentage,
 * measurement or year in the text.
 *
 * `next` is deliberately the most valuable line, for the reason the planning
 * guide records: the single most useful paragraph in the legacy report was the
 * one telling the reader what to obtain and of whom, and that advice needs no
 * retrieval at all.
 *
 * ## And an absence is a finding too
 *
 * §9's rule — *an absence may not be rated* — has an educational counterpart
 * that this closes. A reader who is told "Not searched. No question was put to
 * this register" has been told something true and has still been given nothing
 * to do, and the honest next action there is a real one: the council and the
 * state publish what this platform does not read, and a buyer can go and read
 * it. `ABSENCE_GUIDE` says so.
 *
 * Deno-compatible: no imports.
 */

/** One kind of entry, explained. */
export interface FindingGuide {
  /** What this kind of entry IS, in one sentence a non-planner reads once. */
  what: string;
  /** What it does NOT tell a reader. Never a number, never about this property. */
  limits: string;
  /** The specific thing to obtain or ask, and of whom. */
  next: string;
}

/**
 * The kinds an entry can carry, as `buildInfrastructureEvidence` sets them.
 *
 * Keyed on the `kind` string the evidence builder writes, so a new kind that
 * nobody explains is caught by the spec rather than silently drawing nothing.
 */
export const FINDING_GUIDE: Readonly<Record<string, FindingGuide>> = {
  'Development application': {
    what: 'Somebody has asked their council for permission to build something, and the council has not '
      + 'yet decided. The register records the request, its stated cost of development and how many '
      + 'dwellings it would create.',
    limits: 'An application is not a decision and a decision is not a building. Applications are refused, '
      + 'withdrawn, amended and abandoned, and an approved one may never be built. The stated cost is the '
      + "applicant's own estimate of construction, not a valuation, not funding, and not money anyone has "
      + 'committed. Nothing in the register says when anything would be finished.',
    next: 'Look the application number up on the council’s own DA tracker, where the current status, the '
      + 'plans and any submissions are published. If what is proposed would sit near this property, the '
      + 'plans are where you see how close, how tall and how it is oriented.',
  },
  'Approved development': {
    what: 'A council has granted permission for a development. It was approved before the period this '
      + 'report looked at, so no new application for it falls inside that period.',
    limits: 'An approval permits building; it does not oblige it, fund it or date it. Approvals lapse if '
      + 'they are not acted on within the period the consent sets, and consents are commonly modified '
      + 'afterwards. The register publishes no commencement date and no completion date.',
    next: 'Ask the council whether the consent is still live, whether it has been modified, and whether a '
      + 'construction certificate has been issued — that last one is the step that usually means work '
      + 'is genuinely about to start.',
  },
  'Committed government investment': {
    what: 'A government has committed money to this project under its published investment programme, '
      + 'and the programme names which governments are contributing.',
    limits: 'A committed budget is money allocated, not work finished. The programme publishes no '
      + 'completion date for anything in it, and it covers only the years its own window names — it '
      + 'says nothing about what will be delivered after that. A project’s midpoint is one point on '
      + 'what may be a long corridor, so the distance stated is to that point rather than to the nearest '
      + 'part of the work.',
    next: 'Open the project’s own page on the delivering agency’s site, where scope, staging and '
      + 'community updates are published. If the work is close enough to matter, the construction '
      + 'management plan is what tells you about noise, access and how long.',
  },
  'Planned government investment': {
    what: 'A project the government has named in its investment programme and has not yet committed money '
      + 'to under contract. The programme states a cost band and, where it has one, the stage it has '
      + 'reached — planning, procurement, or an expected construction start.',
    limits: 'A planned project is an intention, and intentions are re-scoped, re-staged and dropped as '
      + 'budgets change. A cost band is not a committed figure and an expected construction start is a '
      + 'start rather than a finish. This is the weakest evidence in the table and should carry the least '
      + 'weight in a decision.',
    next: 'Watch the programme’s next annual edition: a project that moves from planned to '
      + 'contractually committed has passed the point where it is likely to happen. The agency’s '
      + 'project page carries the business-case stage in the meantime.',
  },
  'Priority development area': {
    what: 'An area the state has declared for coordinated development, where the state rather than the '
      + 'council usually sets what may be built and assesses applications against a scheme of its own.',
    limits: 'A declaration says an area is intended to change; it does not say what will be built, when, '
      + 'or by whom, and the development scheme for one can be amended after it is declared. The boundary '
      + 'matters — a property may sit inside it, beside it, or well away from it, and the register '
      + 'names the area rather than measuring that distance.',
    next: 'Obtain the development scheme for the area from the state agency that declared it, and check '
      + 'the mapped boundary against this property’s own lot.',
  },
  'State development area': {
    what: 'Land the state has set aside for industry and the infrastructure corridors that serve it, '
      + 'administered under a state Act rather than the local planning scheme.',
    limits: 'The declaration describes what the land is reserved FOR, not what is there now or what will '
      + 'be built. Neighbouring residential amenity is governed by separate buffers and approvals that '
      + 'this register does not publish.',
    next: 'Ask the administering state agency for the development scheme and the current land-use plan, '
      + 'and for any buffer or separation requirement that applies between the area and nearby homes.',
  },
  'Coordinated project': {
    what: 'A project the state’s coordinator-general has declared significant enough to run its own '
      + 'assessment for, usually because of its scale or its environmental effects.',
    limits: 'A declaration starts an assessment; it does not approve, fund or schedule anything, and '
      + 'assessments take years and can end in conditions that change the project substantially.',
    next: 'The coordinator-general publishes the environmental impact statement and the evaluation report '
      + 'for each declared project. Those documents are where the actual footprint, timing and conditions '
      + 'are described.',
  },
  'Infrastructure designation': {
    what: 'A site a minister has designated for infrastructure — a school, a substation, a treatment '
      + 'plant, a transport facility — which lets it be built without the development approval an '
      + 'ordinary use would need.',
    limits: 'A designation permits the use on that site; it does not say the thing has been built, funded '
      + 'or scheduled, and designations are made years before anything happens. It says nothing about '
      + 'what the facility will look like or how it will operate.',
    next: 'Ask the designating agency what stage the facility is at and whether a design has been '
      + 'published. For a school or a health facility, the delivering department usually publishes a '
      + 'project page once construction funding exists.',
  },
};

/**
 * The absence, explained.
 *
 * `not_searched` is an honest statement and a dead end for a reader. This is
 * the one entry that is about the REPORT rather than about a kind of finding,
 * and it is the only place in this module that may be true of a jurisdiction.
 */
export const ABSENCE_GUIDE: FindingGuide = {
  what: 'One or more of the sources behind this table is not covered by this report — the state does not '
    + 'publish it in a form this report can use, its licence does not allow it to be reproduced, or it could '
    + 'not be consulted when the report was prepared.',
  limits: 'Nothing about this area follows from that. A source that was not consulted holds no evidence '
    + 'either way, and a short table reflects this report’s coverage rather than a finding that nothing is '
    + 'planned nearby.',
  next: 'The council’s own development-application tracker and its adopted capital works programme, '
    + 'and the state’s budget infrastructure statement, are public and cover most of what this table '
    + 'does not. A conveyancer or buyer’s agent will read them as part of a standard search.',
};

/**
 * The line that opens the guide, named once.
 *
 * It announces the entries under it and says nothing on its own, so it is
 * only ever drawn with at least one entry beneath it. The 20 Sep 2026 Compass
 * for 97 Poole Road stored it with none — the line, then the next heading —
 * and both the Compass and the Due Diligence report forked from it printed a
 * promise the page did not keep. The composer has always pushed an entry after
 * it; the stored document lost them after composition, so
 * `dropOrphanedLeadIns` (`derivedHygiene.pure.ts`) repairs it where it is READ,
 * against this spelling — `orphanedLeadIn.spec.ts` holds the two together.
 */
export const INFRASTRUCTURE_GUIDE_LEAD_IN = 'What these findings mean, and what to do about them.';

/**
 * The guides for the kinds actually present, in the order they appear.
 *
 * Only what the table drew: a guide to an entry kind the reader is not looking
 * at is noise, and the page budget is real.
 */
export function guidesForKinds(kinds: readonly string[]): Array<[string, FindingGuide]> {
  const seen = new Set<string>();
  const out: Array<[string, FindingGuide]> = [];
  for (const raw of kinds) {
    // `kindCell` may append "· amended N times in this window"; the kind is
    // what precedes it.
    const kind = raw.split('·')[0].trim();
    if (seen.has(kind)) continue;
    seen.add(kind);
    const guide = FINDING_GUIDE[kind];
    if (guide) out.push([kind, guide]);
  }
  return out;
}

/**
 * Each section is handed the evidence its subject needs, not every register.
 *
 * ## What was wrong
 *
 * The pinned context — the registers a report may state figures from — is
 * budgeted FIRST in every section call and never trimmed, and the base prompt
 * (the rest of the evidence pack) is trimmed to what is left of a 70 KB user
 * message. By the 37 Bolin Street Compass (27 Sep 2026) the pin had grown to
 * 61,060 bytes, so every one of its sixteen section calls logged
 * `base 41964B (budget ~1800B, trimmed true)`: about FOUR per cent of the
 * evidence pack reached the model. The recorded-crime block was in the other
 * ninety-six, so the Environment section — handed a rule about crime evidence
 * and none of the evidence — wrote that "the supplied record does not provide a
 * verified local incident total" over a register that had answered for POA 2762
 * on every invocation, and described BOCSAR's release from a web search
 * instead, because the trim notice told it to "request fresh web research".
 *
 * The 100 KB message limit is the provider's, so the budget cannot simply rise,
 * and the pin exists for a reason that still holds: an authority that a byte
 * boundary can cut while its rule survives is how `450 m²` reached a client
 * document. What was wrong is that every section was handed EVERY authority.
 * The planning section does not need the national investment programme; the
 * transport section does not need the planning controls table.
 *
 * ## The rule
 *
 * The pin is composed once, as tagged groups (`pinGroup`). Each Compass
 * section keeps the groups whose subject it owns, plus the rules that bind
 * every section; the summary sections (the verdict, the risk register, the
 * recommendation) keep everything. A group left out is NAMED in one line with
 * a prohibition, because a section that does not know an authority exists will
 * look for one: it may not state a figure from it, and may not look it up. A
 * section the map does not know — every Financial-tier section, and any
 * registry id added later — keeps every group it kept before, so nothing that
 * worked changes by omission.
 *
 * Pure: a composed pin and a registry id in, the section's pin out.
 */

export type PinKey =
  | 'attributes'
  | 'planning'
  | 'infrastructure'
  | 'approvals'
  | 'forwardDemand'
  | 'population'
  | 'transport'
  | 'publishedProjects'
  | 'market'
  | 'environment'
  | 'rules';

const MARK = '\u001E';

/** Tag the start of a group. Untagged elements that follow belong to it. */
export function pinGroup(key: PinKey, text: string): string {
  return `${MARK}pin:${key}${MARK}${text}`;
}

/** What a reader of the full pin sees: the groups with the tags removed. */
export function stripPinTags(pin: string): string {
  return pin.replace(new RegExp(`${MARK}pin:[A-Za-z]+${MARK}`, 'g'), '');
}

/** Groups every section keeps: the attributes on record, and rules that bind the whole document. */
const ALWAYS: readonly PinKey[] = ['attributes', 'rules'];

/** Every group a section kept before this module existed. */
const LEGACY_ALL: readonly PinKey[] = [
  'attributes', 'planning', 'infrastructure', 'approvals', 'forwardDemand', 'population',
  'transport', 'publishedProjects', 'market', 'rules',
];
/** And the summary sections, which also state the hazard and crime readings. */
const SUMMARY: readonly PinKey[] = [...LEGACY_ALL, 'environment'];

/** Which groups each Compass section owns, keyed by its registry id. */
export const SECTION_PIN_HOMES: Readonly<Record<string, readonly PinKey[]>> = {
  'compass.cover': [],
  'compass.executiveVerdict': SUMMARY,
  'compass.propertyLocalitySnapshot': ['planning', 'population', 'transport', 'market'],
  'compass.whyLocationMatters': ['population', 'forwardDemand', 'transport'],
  'compass.infrastructure': ['infrastructure', 'publishedProjects', 'approvals'],
  'compass.demandDrivers': ['population', 'forwardDemand', 'market', 'approvals'],
  'compass.amenityAccess': ['transport'],
  'compass.transportAccess': ['transport'],
  'compass.planningConstraints': ['planning'],
  'compass.environmentSafety': ['environment', 'planning'],
  'compass.marketPositioning': ['market', 'population', 'forwardDemand'],
  'compass.supplyPipeline': ['approvals', 'infrastructure', 'publishedProjects'],
  'compass.propertyFit': ['planning', 'population', 'market'],
  'compass.riskDashboard': SUMMARY,
  'compass.dueDiligenceChecklist': ['planning', 'environment', 'infrastructure', 'publishedProjects'],
  'compass.finalRecommendation': SUMMARY,
  'compass.disclaimer': [],
};

/** How a left-out group is named to the section, where it carries no heading of its own. */
const GROUP_NAME: Readonly<Record<PinKey, string>> = {
  attributes: 'the property\'s recorded attributes',
  planning: 'the planning controls',
  infrastructure: 'the infrastructure and development outlook',
  approvals: 'approved dwelling supply',
  forwardDemand: 'the population projection',
  population: 'the measured population trend',
  transport: 'the transport reading',
  publishedProjects: 'the major public projects near the property',
  market: 'the market evidence',
  environment: 'recorded crime, climate and the hazard maps',
  rules: 'the document rules',
};

interface Group { key: PinKey; text: string }

function groupsOf(pin: string): Group[] | null {
  const re = new RegExp(`${MARK}pin:([A-Za-z]+)${MARK}`, 'g');
  const marks = [...pin.matchAll(re)];
  if (!marks.length) return null;
  const groups: Group[] = [];
  const lead = pin.slice(0, marks[0].index).trim();
  if (lead) groups.push({ key: 'rules', text: lead });
  marks.forEach((m, i) => {
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < marks.length ? marks[i + 1].index : pin.length;
    groups.push({ key: m[1] as PinKey, text: pin.slice(start, end).trim() });
  });
  return groups;
}

/**
 * The pin one section is handed.
 *
 * An untagged pin is returned unchanged, and so is the full pin (tags removed)
 * for a section the map does not name — except the environment group, which
 * no section received before and which only its homes receive.
 */
export function pinForSection(pin: string, registryId: string | null | undefined): string {
  const groups = groupsOf(pin);
  if (!groups) return pin;
  const homes = registryId ? SECTION_PIN_HOMES[registryId] : undefined;
  const keep = new Set<PinKey>([...ALWAYS, ...(homes ?? LEGACY_ALL)]);
  const kept: string[] = [];
  const left: string[] = [];
  for (const g of groups) {
    if (!g.text) continue;
    if (keep.has(g.key)) {
      kept.push(g.text);
    } else if (homes) {
      // A section the map names is told what it was not handed. One it does
      // not name is left exactly as it was, so it is told nothing new.
      const name = GROUP_NAME[g.key];
      if (!left.includes(name)) left.push(name);
    }
  }
  if (homes && left.length) {
    kept.push(
      `Handed to other sections of this report, not to this one: ${left.join('; ')}. Do not state a figure, `
      + 'control, project, reading or finding from them in this section, and do not look them up elsewhere: '
      + 'the section that owns each states it from the record.',
    );
  }
  return kept.join('\n\n');
}

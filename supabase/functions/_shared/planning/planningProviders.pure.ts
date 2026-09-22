/**
 * Which registers answer the planning and development questions, in what
 * order — and why that order is NOT a fallback chain.
 *
 * ── The shape is `AMENITY_PROVIDERS`'; the semantics are not ─────────────
 *
 * W3.4 asks for `PLANNING_PROVIDERS` / `DEVELOPMENT_PROVIDERS` *"mirroring
 * `AMENITY_PROVIDERS` and `GEOCODER_PROVIDERS`"*, and mirroring the shape is
 * right: one environment variable, a comma order, unknown names dropped
 * rather than erred (a typo must not switch a working surface off), an empty
 * value falling back to the default so the variable cannot spell "no
 * providers".
 *
 * Mirroring the SEMANTICS would be wrong, and the criterion says so in the
 * same breath: refinements are added *"above the floor — never as the only
 * answer."*
 *
 * `GEOCODER_PROVIDERS` and `AMENITY_PROVIDERS` are **first-that-answers**
 * chains. One address has one coordinate; one category has one nearest
 * hospital; a second provider is consulted only because the first could not
 * answer, and its answer REPLACES what the first would have given.
 *
 * Planning is not like that. A state overlay layer and a council amendment
 * register are not two attempts at one answer — they are different facts
 * about the same lot, and a draft amendment does not supersede the control
 * in force. So these orders are **floor plus refinements**:
 *
 *  - the FLOOR is consulted always, and cannot be removed by configuration;
 *  - every later provider ADDS to the reading rather than replacing it;
 *  - a refinement that answers nothing leaves the floor's answer standing.
 *
 * `floorOf` is what enforces the first bullet. An operator who writes
 * `PLANNING_PROVIDERS=amendment_register` gets the floor back anyway, at the
 * front, because a deployment that answered the planning question yesterday
 * must not answer it with an amendment register alone today — that would
 * print a draft control as the control in force, which is the one thing
 * `planningFacts`' `adopted` / `draft` distinction exists to prevent.
 *
 * ── What is deliberately NOT here ────────────────────────────────────────
 *
 * **The operator override is not a provider.** `planningFacts`' rule 2 is
 * that an audited operator figure outranks a layer and says so, labelled
 * `operator_stated`. That is an ORDER over answers, decided where the cells
 * are composed, and it must not become configurable: an environment variable
 * that could drop the operator override would silently overrule a person who
 * had recorded a correction.
 *
 * **No endpoint, no host, no layer id.** Those belong to the modules that
 * read them. This file decides only which KINDS of register are consulted
 * and in what order, so that adding a jurisdiction's amendment register is a
 * declaration beside the reader rather than an edit to the composer — the
 * rule `httpRequest.pure.ts` already states for the workflow catalog.
 *
 * Deno-compatible: no imports.
 */

/**
 * The planning-control registers.
 *
 * `state_layer` — the integrated state overlay and zoning services
 * (NSW/VIC/QLD/TAS today; SA/WA/NT/ACT are W3.4's extension). This is the
 * FLOOR: it is what makes a reading a retrieval rather than a guess.
 *
 * `instrument_currency` — WHICH instrument a control in force belongs to and
 * WHICH amendment of it applies. A refinement in the exact sense this file
 * means: it adds no control at all, it says which document the floor's
 * control came from and how current that document is — `planningControlGuide`'s
 * rule that *a value carries its unit, its instrument and its clause*. On its
 * own it is an instrument name with nothing under it.
 *
 * NSW answers it today, in the same response the floor is read from, and
 * until W3.4 the answer went to a `console.log`: `parseNswZoning` publishes
 * `EPI_NAME` while `parseNswInstrument` reads the amendment number and the
 * commencement date off layer 8 and threw both away. So the report printed
 * *"Muswellbrook Local Environmental Plan 2009"* over a record that knew it
 * was Amendment 12 — the first question a town planner asks, discarded one
 * line from where it was parsed.
 *
 * `amendment_register` — DRAFT and proposed instruments, where a
 * jurisdiction publishes them separately from the layers in force. Declared
 * and integrated nowhere yet. A refinement, and never the answer on its own:
 * a draft is labelled `draft` and a control in force is labelled `adopted`,
 * and printing the first as the second is a statement about what may be
 * built that nobody made.
 *
 * The two are deliberately NOT one provider. *"Amendment 12 of the LEP is in
 * force"* and *"a draft amendment is on exhibition"* are opposite statements
 * about what binds this lot, and one name for both is how the second comes to
 * be printed as the first.
 */
export type PlanningProvider = 'state_layer' | 'instrument_currency' | 'amendment_register';

/**
 * The development-activity registers.
 *
 * `da_register` — the jurisdiction's own development-application register,
 * the walk that produced 1,410 dwellings and $1.18bn for Queensland. The
 * FLOOR, and the only one of the two that counts private applications.
 *
 * `major_projects` — a state major-project register (the NSW Planning
 * Portal's major projects, Victoria's Big Build and their equivalents). A
 * refinement: it names large public works the DA register does not carry,
 * and it carries no private application at all, so on its own it would
 * describe an area's pipeline as whatever the state happens to be building.
 */
export type DevelopmentProvider = 'da_register' | 'major_projects';

export const PLANNING_PROVIDERS_ENV = 'PLANNING_PROVIDERS';
export const DEVELOPMENT_PROVIDERS_ENV = 'DEVELOPMENT_PROVIDERS';

/**
 * The defaults, floor first.
 *
 * Every refinement is listed although only `instrument_currency` is
 * integrated (NSW alone), and that is the same decision `AMENITY_PROVIDERS`
 * made for `google`: *"a register that has not had its first ingest … must degrade
 * to yesterday's behaviour, not to nulls."* A provider that cannot answer
 * contributes nothing and the floor's answer stands, so listing it costs
 * nothing today and needs no configuration change on the day it can.
 */
export const DEFAULT_PLANNING_PROVIDERS: PlanningProvider[] = [
  'state_layer', 'instrument_currency', 'amendment_register',
];
export const DEFAULT_DEVELOPMENT_PROVIDERS: DevelopmentProvider[] = ['da_register', 'major_projects'];

/** The provider that may never be configured away. */
export const PLANNING_FLOOR: PlanningProvider = 'state_layer';
export const DEVELOPMENT_FLOOR: DevelopmentProvider = 'da_register';

const KNOWN_PLANNING: readonly PlanningProvider[] = ['state_layer', 'instrument_currency', 'amendment_register'];
const KNOWN_DEVELOPMENT: readonly DevelopmentProvider[] = ['da_register', 'major_projects'];

/**
 * Parse an order, then put the floor back.
 *
 * Three behaviours, and each is a rule paid for elsewhere. Unknown names are
 * DROPPED (`osmAllowanceFor`'s rule — a typo must not switch a working
 * surface off). An empty result falls back to the default, so the variable
 * cannot spell "no providers". And the floor is PREPENDED wherever it is
 * missing, because a refinement is never the only answer.
 */
function parsePlanningOrder<T extends string>(
  raw: string | undefined,
  known: readonly T[],
  fallback: T[],
  floor: T,
): T[] {
  const listed = (raw ?? '')
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter((p): p is T => (known as readonly string[]).includes(p));
  const deduped = [...new Set(listed)];
  const order = deduped.length > 0 ? deduped : [...fallback];
  return order.includes(floor) ? order : [floor, ...order];
}

export function planningProviderOrder(env: (k: string) => string | undefined): PlanningProvider[] {
  return parsePlanningOrder(env(PLANNING_PROVIDERS_ENV), KNOWN_PLANNING, DEFAULT_PLANNING_PROVIDERS, PLANNING_FLOOR);
}

export function developmentProviderOrder(env: (k: string) => string | undefined): DevelopmentProvider[] {
  return parsePlanningOrder(
    env(DEVELOPMENT_PROVIDERS_ENV), KNOWN_DEVELOPMENT, DEFAULT_DEVELOPMENT_PROVIDERS, DEVELOPMENT_FLOOR,
  );
}

/**
 * Was the floor reached for this reading?
 *
 * A refinement answering while the floor did not is the state that must be
 * SAID rather than smoothed over: it means the reading describes whatever the
 * refinement happens to cover and nothing about the controls in force. The
 * coverage sentence a jurisdiction gets is composed from this, not from the
 * provider order — an order is a configuration, and what a report may state
 * turns on what actually answered.
 */
export interface ProviderOutcome {
  provider: string;
  answered: boolean;
}

export function floorAnswered(outcomes: readonly ProviderOutcome[], floor: string): boolean {
  return outcomes.some((o) => o.provider === floor && o.answered);
}

/**
 * Which refinements added something, given the floor did.
 *
 * Returns an empty list where the floor did not answer, because a refinement
 * cannot refine nothing — and calling it a refinement then would dress the
 * only reading available as an addition to a reading that does not exist.
 */
export function refinementsThatAnswered(
  outcomes: readonly ProviderOutcome[],
  floor: string,
): string[] {
  if (!floorAnswered(outcomes, floor)) return [];
  return outcomes.filter((o) => o.provider !== floor && o.answered).map((o) => o.provider);
}
